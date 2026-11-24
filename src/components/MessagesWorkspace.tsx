import React, { useEffect, useRef, useState } from 'react';
import { Ban, Flag, MessageSquare, Send, ShieldAlert, Trash2 } from 'lucide-react';
import { apiFetch, getInMemoryToken } from '../api';
import type { Conversation, Message, User } from '../types';

interface MessagesWorkspaceProps {
  user: User;
  activeConversationId: string | null;
  onSelectConversation: (id: string | null) => void;
  onReportTarget: (targetType: string, targetId: string, reportedUserId?: string) => void;
}

export const MessagesWorkspace: React.FC<MessagesWorkspaceProps> = ({
  user,
  activeConversationId,
  onSelectConversation,
  onReportTarget,
}) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [typingPeer, setTypingPeer] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = async () => {
    const res = await apiFetch<{ conversations: Conversation[] }>('/conversations');
    setConversations(res.conversations);
    if (!activeConversationId && res.conversations.length > 0) {
      onSelectConversation(res.conversations[0].id);
    }
  };

  const loadMessages = async (convId: string) => {
    try {
      const res = await apiFetch<{ messages: Message[] }>(`/conversations/${convId}/messages`);
      setMessages(res.messages);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load conversation.');
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
    }
  }, [activeConversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Authenticated WebSocket connection with auto-reconnect & idempotent deduplication
  useEffect(() => {
    let closedByUser = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getInMemoryToken();
      const wsUrl = `${proto}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        if (activeConversationId) {
          ws.send(JSON.stringify({ event: 'conversation:join', payload: { conversationId: activeConversationId } }));
        }
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as { event: string; payload: Record<string, unknown> };
          if (data.event === 'message:new') {
            const incoming = data.payload as unknown as Message;
            if (incoming.conversation_id === activeConversationId) {
              setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
            }
            loadConversations();
          } else if (data.event === 'typing:update') {
            if (data.payload.conversationId === activeConversationId && data.payload.userId !== user.id) {
              setTypingPeer(data.payload.isTyping ? String(data.payload.displayName || 'Member') : null);
            }
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByUser) {
          reconnectTimer = setTimeout(connect, 2500);
        }
      };
    };

    connect();
    return () => {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [activeConversationId, user.id]);

  const activeConv = conversations.find((c) => c.id === activeConversationId) || null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !draft.trim()) return;
    setError('');
    try {
      const res = await apiFetch<{ message: Message }>(`/conversations/${activeConv.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: draft }),
      });
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      setDraft('');
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ event: 'typing:stop', payload: { conversationId: activeConv.id } }));
      }
      loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    }
  };

  const handleRespondRequest = async (convId: string, decision: 'accept' | 'reject') => {
    await apiFetch(`/conversations/${convId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
    await loadConversations();
  };

  const handleBlockPeer = async (peerId: string) => {
    await apiFetch(`/users/${peerId}/block`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Blocked from direct messages' }),
    });
    onSelectConversation(null);
    await loadConversations();
  };

  const handleDeleteMessage = async (msgId: string) => {
    await apiFetch(`/messages/${msgId}`, { method: 'DELETE' });
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">Messages</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Authorized real-time direct messages & group chats · {wsConnected ? 'Live WebSocket active' : 'Reconnecting...'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden min-h-[540px]">
        {/* Conversation List */}
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 max-h-[540px] overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No conversations yet. Discover peers or join a group to start messaging.
            </div>
          ) : (
            conversations.map((c) => {
              const title = c.type === 'group' ? c.group_name || 'Group Chat' : c.peer?.display_name || 'Direct Message';
              const isSelected = c.id === activeConversationId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectConversation(c.id)}
                  className={`w-full text-left px-4 py-3.5 transition-colors ${
                    isSelected ? 'bg-blue-50/70 dark:bg-blue-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">{title}</span>
                    <span className="text-[11px] text-slate-400 shrink-0 capitalize">
                      {c.status === 'request_pending' ? 'Request' : c.type}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                    {c.lastMessage?.body || 'No messages yet'}
                  </p>
                </button>
              );
            })
          )}
        </div>

        {/* Active Chat Thread */}
        <div className="lg:col-span-8 flex flex-col justify-between h-[540px]">
          {!activeConv ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-sm text-slate-500">
              <MessageSquare className="w-8 h-8 text-slate-300 mb-2" />
              <span>Select a conversation to view messages.</span>
            </div>
          ) : (
            <>
              {/* Thread Header */}
              <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white">
                    {activeConv.type === 'group' ? activeConv.group_name : activeConv.peer?.display_name || 'Direct Chat'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {typingPeer ? `${typingPeer} is typing...` : activeConv.peer?.verification_badge_label || 'Server-authorized conversation'}
                  </p>
                </div>

                {activeConv.type === 'direct' && activeConv.peer && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onReportTarget('user', activeConv.peer!.id, activeConv.peer!.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-amber-600"
                    >
                      <Flag className="w-3.5 h-3.5" />
                      <span>Report</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBlockPeer(activeConv.peer!.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Block</span>
                    </button>
                  </div>
                )}
              </div>

              {activeConv.status === 'request_pending' && activeConv.initiated_by !== user.id && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 px-5 py-3 flex items-center justify-between gap-4 text-xs">
                  <span className="text-amber-900 dark:text-amber-200">
                    Message request from a non-connection. Accept to continue chatting, or decline/block.
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRespondRequest(activeConv.id, 'accept')}
                      className="rounded bg-[#0D9488] px-3 py-1.5 font-semibold text-white"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRespondRequest(activeConv.id, 'reject')}
                      className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-medium"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              )}

              {/* Messages Feed */}
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {messages.map((m) => {
                  const isMine = m.sender_id === user.id;
                  const signals = (() => {
                    try {
                      return JSON.parse(m.safety_signals_json || '[]') as string[];
                    } catch {
                      return [];
                    }
                  })();
                  return (
                    <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`max-w-[82%] rounded-xl px-4 py-2.5 text-sm ${
                          isMine
                            ? 'bg-[#142B5F] text-white dark:bg-[#2563EB]'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {!isMine && (
                          <p className="text-[11px] font-semibold opacity-75 mb-0.5">{m.sender_name}</p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        {signals.length > 0 && (
                          <div className="mt-2 flex items-center gap-1.5 rounded bg-amber-500/20 px-2 py-1 text-[11px]">
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                            <span>Safety reminder: Never pay upfront fees or share passport scans privately.</span>
                          </div>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                        <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {isMine ? (
                          <button type="button" onClick={() => handleDeleteMessage(m.id)} className="hover:text-red-500" aria-label="Delete message">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onReportTarget('message', m.id, m.sender_id)}
                            className="hover:text-amber-500"
                            aria-label="Report message"
                          >
                            <Flag className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {error && (
                <div className="px-5 py-2 text-xs text-red-600 bg-red-50 dark:bg-red-950/40">{error}</div>
              )}

              <form onSubmit={handleSend} className="p-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                      wsRef.current.send(
                        JSON.stringify({
                          event: e.target.value ? 'typing:start' : 'typing:stop',
                          payload: { conversationId: activeConv.id },
                        })
                      );
                    }
                  }}
                  placeholder="Write a message..."
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white min-h-[40px]"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
