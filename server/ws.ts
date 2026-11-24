import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type Database from 'better-sqlite3';
import { nowIso, uuid } from './db.ts';
import { detectSafetySignals, hashToken, parseCookies } from './security.ts';

interface AuthedSocket extends WebSocket {
  userId?: string;
  displayName?: string;
  rooms: Set<string>;
  isAlive: boolean;
}

const userSockets = new Map<string, Set<AuthedSocket>>();

export function notifyUserRealtime(userId: string, event: string, payload: unknown): void {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const serialized = JSON.stringify({ event, payload });
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

export function broadcastConversationRealtime(
  db: Database.Database,
  conversationId: string,
  event: string,
  payload: unknown,
  excludeUserId?: string
): void {
  const participants = db
    .prepare('SELECT user_id FROM conversation_participants WHERE conversation_id = ?')
    .all(conversationId) as Array<{ user_id: string }>;

  const serialized = JSON.stringify({ event, payload });
  for (const p of participants) {
    if (excludeUserId && p.user_id === excludeUserId) continue;
    const sockets = userSockets.get(p.user_id);
    if (!sockets) continue;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(serialized);
      }
    }
  }
}

export function attachWebSocketServer(httpServer: HttpServer, db: Database.Database): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const onUpgrade = (req: import('http').IncomingMessage, socket: import('stream').Duplex, head: Buffer) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  };
  httpServer.on('upgrade', onUpgrade);

  wss.on('connection', (rawWs: WebSocket, req) => {
    const ws = rawWs as AuthedSocket;
    ws.rooms = new Set();
    ws.isAlive = true;

    // Authenticate via HttpOnly cookie or ?token=
    const urlObj = new URL(req.url || '/ws', 'http://localhost');
    const queryToken = urlObj.searchParams.get('token');
    const cookies = parseCookies(req.headers.cookie);
    const token = queryToken || cookies.ac_session;

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    const tokenHash = hashToken(token);
    const sessionRow = db
      .prepare(
        `SELECT s.user_id, s.expires_at, s.revoked_at, u.display_name, u.status
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as
      | { user_id: string; expires_at: string; revoked_at: string | null; display_name: string; status: string }
      | undefined;

    if (
      !sessionRow ||
      sessionRow.revoked_at ||
      new Date(sessionRow.expires_at).getTime() <= Date.now() ||
      sessionRow.status === 'suspended' ||
      sessionRow.status === 'banned'
    ) {
      ws.close(4001, 'Invalid or expired session');
      return;
    }

    ws.userId = sessionRow.user_id;
    ws.displayName = sessionRow.display_name;

    if (!userSockets.has(ws.userId)) {
      userSockets.set(ws.userId, new Set());
    }
    userSockets.get(ws.userId)!.add(ws);

    ws.send(JSON.stringify({ event: 'ws:connected', payload: { userId: ws.userId } }));

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      if (!ws.userId) return;
      try {
        const parsed = JSON.parse(data.toString()) as { event?: string; payload?: Record<string, unknown> };
        const event = parsed.event;
        const payload = parsed.payload || {};

        if (event === 'conversation:join') {
          const convId = String(payload.conversationId || '');
          const membership = db
            .prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?')
            .get(convId, ws.userId);
          if (membership) {
            ws.rooms.add(convId);
            ws.send(JSON.stringify({ event: 'conversation:joined', payload: { conversationId: convId } }));
          } else {
            ws.send(JSON.stringify({ event: 'error', payload: { message: 'Unauthorized conversation access' } }));
          }
        } else if (event === 'typing:start' || event === 'typing:stop') {
          const convId = String(payload.conversationId || '');
          const membership = db
            .prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?')
            .get(convId, ws.userId);
          if (membership) {
            broadcastConversationRealtime(
              db,
              convId,
              'typing:update',
              {
                conversationId: convId,
                userId: ws.userId,
                displayName: ws.displayName,
                isTyping: event === 'typing:start',
              },
              ws.userId
            );
          }
        } else if (event === 'message:send') {
          const userStatusRow = db.prepare('SELECT status FROM users WHERE id = ?').get(ws.userId) as { status: string } | undefined;
          if (!userStatusRow || userStatusRow.status !== 'active') {
            ws.send(JSON.stringify({ event: 'error', payload: { message: 'Your account is currently restricted from sending messages.' } }));
            return;
          }
          const convId = String(payload.conversationId || '');
          const body = String(payload.body || '').trim();
          const clientMsgId = typeof payload.clientMessageId === 'string' ? payload.clientMessageId : null;
          if (!convId || !body || body.length > 4000) return;

          const conv = db
            .prepare('SELECT id, type, group_id, status FROM conversations WHERE id = ?')
            .get(convId) as { id: string; type: string; group_id: string | null; status: string } | undefined;
          const membership = db
            .prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?')
            .get(convId, ws.userId);
          if (!conv || !membership || conv.status === 'rejected') {
            ws.send(JSON.stringify({ event: 'error', payload: { message: 'Cannot send message to this conversation' } }));
            return;
          }

          if (conv.type === 'direct') {
            const other = db
              .prepare('SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?')
              .get(convId, ws.userId) as { user_id: string } | undefined;
            if (other) {
              const blocked = db
                .prepare(
                  'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
                )
                .get(ws.userId, other.user_id, other.user_id, ws.userId);
              if (blocked) {
                ws.send(JSON.stringify({ event: 'error', payload: { message: 'Messaging blocked between users' } }));
                return;
              }
            }
          }

          const msgId = clientMsgId && /^[a-f0-9-]{36}$/i.test(clientMsgId) ? clientMsgId : uuid();
          const existing = db.prepare('SELECT id FROM messages WHERE id = ?').get(msgId);
          if (existing) return; // idempotent guard

          const signals = detectSafetySignals(body);
          const ts = nowIso();
          db.prepare(
            `INSERT INTO messages (id, conversation_id, sender_id, body, safety_signals_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(msgId, convId, ws.userId, body, JSON.stringify(signals), ts);

          const sender = db
            .prepare('SELECT id, display_name, username, verification_badge_label FROM users WHERE id = ?')
            .get(ws.userId) as { id: string; display_name: string; username: string; verification_badge_label: string };

          broadcastConversationRealtime(db, convId, 'message:new', {
            id: msgId,
            conversation_id: convId,
            sender_id: ws.userId,
            sender_name: sender?.display_name || 'Member',
            sender_username: sender?.username || '',
            body,
            safety_signals: signals,
            is_edited: 0,
            is_deleted: 0,
            created_at: ts,
          });
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('close', () => {
      if (ws.userId && userSockets.has(ws.userId)) {
        userSockets.get(ws.userId)!.delete(ws);
        if (userSockets.get(ws.userId)!.size === 0) {
          userSockets.delete(ws.userId);
        }
      }
    });
  });

  const interval = setInterval(() => {
    for (const rawWs of wss.clients) {
      const ws = rawWs as AuthedSocket;
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
    httpServer.off('upgrade', onUpgrade);
  });
  return wss;
}
