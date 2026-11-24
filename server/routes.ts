import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { nowIso, uuid } from './db.ts';
import {
  clearSessionCookie,
  detectSafetySignals,
  generateOtpCode,
  generateSessionToken,
  hashOtp,
  hashPassword,
  hashToken,
  parseCookies,
  rateLimitMiddleware,
  safeUrl,
  setSessionCookie,
  verifyPassword,
} from './security.ts';
import { broadcastConversationRealtime, notifyUserRealtime } from './ws.ts';
import { requireFirebaseAuth, type FirebaseAuthRequest } from '../src/middleware/firebaseAuth.ts';
import {
  createUserApplication,
  createUserStudyNote,
  deleteUserApplication,
  deleteUserStudyNote,
  getOrCreateUser,
  getUserApplications,
  getUserStudyNotes,
  updateUserApplicationStatus,
} from '../src/db/users.ts';
import { streamAdvisorChat, transcribeUserAudio, type AdvisorPreset } from './ai.ts';

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string;
  username: string | null;
  preferred_language: string;
  status: string;
  verification_level: string;
  verification_badge_label: string;
  roles: string[];
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser | null;
    }
  }
}

const VALID_ROLES = new Set([
  'guest',
  'registered_member',
  'verified_member',
  'abroad_student',
  'working_professional',
  'verified_mentor',
  'group_moderator',
  'resource_editor',
  'support_agent',
  'platform_admin',
  'super_admin',
]);

function logAudit(
  db: Database.Database,
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>,
  ipAddress: string
): void {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details_json, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uuid(), actorId, action, targetType, targetId, JSON.stringify(details), ipAddress, nowIso());
}

function createNotification(
  db: Database.Database,
  userId: string,
  eventType: string,
  title: string,
  body: string,
  linkTarget = ''
): void {
  const id = uuid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO notifications (id, user_id, event_type, title, body, link_target, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(id, userId, eventType, title, body, linkTarget, ts);
  notifyUserRealtime(userId, 'notification:new', { id, event_type: eventType, title, body, link_target: linkTarget, is_read: 0, created_at: ts });
}

function calculateCompletion(profile: Record<string, unknown>, user: Record<string, unknown>): number {
  const fields = [
    user.display_name,
    user.city,
    user.bio,
    profile.highest_qualification,
    profile.degree_specialization,
    profile.english_proficiency,
    profile.primary_destination_country,
    profile.purpose,
    profile.intended_intake,
    profile.application_stage,
  ];
  const filled = fields.filter((v) => typeof v === 'string' && v.trim().length > 0).length;
  return Math.min(100, Math.max(15, Math.round((filled / fields.length) * 100)));
}

export function createApiRouter(db: Database.Database): Router {
  const router = Router();

  // Attach authUser if valid session cookie or Bearer token exists
  const attachAuth = (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    let rawToken: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      rawToken = authHeader.slice(7).trim();
    } else {
      const cookies = parseCookies(req.headers.cookie);
      rawToken = cookies.ac_session;
    }

    if (!rawToken) {
      req.authUser = null;
      next();
      return;
    }

    const tokenHash = hashToken(rawToken);
    const row = db
      .prepare(
        `SELECT s.id as session_id, s.expires_at, s.revoked_at,
                u.id, u.email, u.phone, u.display_name, u.username, u.preferred_language,
                u.status, u.verification_level, u.verification_badge_label
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as
      | {
          session_id: string;
          expires_at: string;
          revoked_at: string | null;
          id: string;
          email: string | null;
          phone: string | null;
          display_name: string;
          username: string | null;
          preferred_language: string;
          status: string;
          verification_level: string;
          verification_badge_label: string;
        }
      | undefined;

    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now() || row.status === 'banned' || row.status === 'suspended') {
      req.authUser = null;
      next();
      return;
    }

    const roleRows = db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(row.id) as Array<{ role: string }>;
    req.authUser = {
      id: row.id,
      email: row.email,
      phone: row.phone,
      display_name: row.display_name,
      username: row.username,
      preferred_language: row.preferred_language,
      status: row.status,
      verification_level: row.verification_level,
      verification_badge_label: row.verification_badge_label,
      roles: roleRows.map((r) => r.role),
      sessionId: row.session_id,
    };
    next();
  };

  router.use(attachAuth);

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    next();
  };

  const requireActiveWriter = (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.authUser.status === 'restricted') {
      res.status(403).json({ error: 'Your account is currently in read-only restriction. Contact Support to appeal.' });
      return;
    }
    next();
  };

  const requireRole = (allowedRoles: string[]) => (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const hasRole = req.authUser.roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: 'Insufficient permissions.' });
      return;
    }
    next();
  };

  // Health & OpenAPI Documentation
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'AbroadConnect India API v1', timestamp: nowIso() });
  });

  router.get('/docs', (_req, res) => {
    res.json({
      openapi: '3.0.3',
      info: {
        title: 'AbroadConnect India API',
        version: '1.0.0',
        description: 'Versioned REST API for AbroadConnect India community, country hubs, real-time messaging, opportunities, moderation, and administration.',
      },
      paths: {
        '/api/v1/auth/otp/request': { post: { summary: 'Request time-limited email or mobile OTP' } },
        '/api/v1/auth/otp/verify': { post: { summary: 'Verify OTP and establish authenticated session' } },
        '/api/v1/auth/admin/claim': { post: { summary: 'One-time first-run admin setup or passcode login' } },
        '/api/v1/countries': { get: { summary: 'List destination countries' } },
        '/api/v1/groups': { get: { summary: 'Discover public and private groups' } },
        '/api/v1/groups/recommendations': { get: { summary: 'Rule-based recommended groups for user profile' } },
        '/api/v1/posts': { post: { summary: 'Publish post or poll inside an authorized group' } },
        '/api/v1/people/discover': { get: { summary: 'Find My Abroad Buddy matching consenting members' } },
        '/api/v1/conversations': { get: { summary: 'List authorized direct and group conversations' } },
        '/api/v1/reports': { post: { summary: 'Submit safety report for content, message, or member' } },
        '/api/v1/moderation/queue': { get: { summary: 'Moderator review queue' } },
        '/api/v1/admin/overview': { get: { summary: 'Aggregate privacy-respecting platform metrics' } },
      },
    });
  });

  // ---------------------------------------------------------------------------
  // AUTHENTICATION & OTP
  // ---------------------------------------------------------------------------
  const otpRequestSchema = z.object({
    channel: z.enum(['email', 'phone']),
    identifier: z.string().trim().min(5).max(120),
  });

  router.post('/auth/otp/request', rateLimitMiddleware('otp_req', 10, 60_000), (req, res) => {
    const parsed = otpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please provide a valid email address or mobile number.' });
      return;
    }

    const { channel, identifier } = parsed.data;
    const normalized = identifier.toLowerCase();

    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (channel === 'phone' && !/^\+?[0-9\s-]{8,16}$/.test(normalized)) {
      res.status(400).json({ error: 'Please enter a valid mobile number (e.g. +91 9876543210).' });
      return;
    }

    const latest = db
      .prepare('SELECT resend_available_at FROM otp_challenges WHERE identifier = ? ORDER BY created_at DESC LIMIT 1')
      .get(normalized) as { resend_available_at: string } | undefined;

    if (latest && new Date(latest.resend_available_at).getTime() > Date.now()) {
      const waitSec = Math.ceil((new Date(latest.resend_available_at).getTime() - Date.now()) / 1000);
      res.status(429).json({ error: `Please wait ${waitSec}s before requesting another verification code.`, retryAfterSec: waitSec });
      return;
    }

    const code = generateOtpCode();
    const ts = nowIso();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const resendAt = new Date(Date.now() + 25_000).toISOString();

    db.prepare(
      `INSERT INTO otp_challenges (id, identifier, channel, code_hash, attempts, max_attempts, expires_at, resend_available_at, created_at)
       VALUES (?, ?, ?, ?, 0, 5, ?, ?, ?)`
    ).run(uuid(), normalized, channel, hashOtp(normalized, code), expiresAt, resendAt, ts);

    // Note: External SMS/SMTP gateway is not configured in preview unless secrets exist;
    // return previewOtp only when SMTP/Twilio isn't configured so testers can verify immediately.
    const hasExternalGateway = Boolean(process.env.SMTP_HOST || process.env.TWILIO_ACCOUNT_SID);
    res.json({
      message: 'If the contact details are valid, a 6-digit verification code has been issued.',
      expiresInSec: 600,
      resendCooldownSec: 25,
      previewMode: !hasExternalGateway,
      previewOtp: hasExternalGateway ? undefined : code,
    });
  });

  const otpVerifySchema = z.object({
    channel: z.enum(['email', 'phone']),
    identifier: z.string().trim().min(5).max(120),
    code: z.string().trim().regex(/^\d{6}$/),
    acceptedTerms: z.boolean().optional(),
  });

  router.post('/auth/otp/verify', rateLimitMiddleware('otp_verify', 15, 60_000), (req, res) => {
    const parsed = otpVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid verification code or identifier.' });
      return;
    }

    const { channel, identifier, code, acceptedTerms } = parsed.data;
    const normalized = identifier.toLowerCase();

    const challenge = db
      .prepare(
        `SELECT * FROM otp_challenges
         WHERE identifier = ? AND channel = ? AND verified_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(normalized, channel) as
      | {
          id: string;
          code_hash: string;
          attempts: number;
          max_attempts: number;
          expires_at: string;
        }
      | undefined;

    if (!challenge) {
      res.status(400).json({ error: 'Verification code is invalid or expired.' });
      return;
    }

    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      res.status(400).json({ error: 'Verification code is invalid or expired.' });
      return;
    }

    if (challenge.attempts >= challenge.max_attempts) {
      res.status(429).json({ error: 'Maximum verification attempts exceeded. Request a new code.' });
      return;
    }

    const expectedHash = hashOtp(normalized, code);
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    const actualBuf = Buffer.from(challenge.code_hash, 'hex');
    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      db.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id);
      res.status(400).json({ error: 'Verification code is invalid or expired.' });
      return;
    }

    const ts = nowIso();
    db.prepare('UPDATE otp_challenges SET verified_at = ? WHERE id = ?').run(ts, challenge.id);

    let user = (
      channel === 'email'
        ? db.prepare('SELECT * FROM users WHERE email = ?').get(normalized)
        : db.prepare('SELECT * FROM users WHERE phone = ?').get(normalized)
    ) as Record<string, unknown> | undefined;

    let isNewUser = false;
    if (!user) {
      if (!acceptedTerms) {
        // Allow registration flow to require ToS acceptance on step 4
        isNewUser = true;
      }
      const userId = uuid();
      const usernameBase = (channel === 'email' ? normalized.split('@')[0] : `member_${normalized.slice(-4)}`)
        .replace(/[^a-z0-9_]/gi, '_')
        .slice(0, 20);
      const uniqueUsername = `${usernameBase}_${Math.floor(100 + Math.random() * 900)}`;

      db.prepare(
        `INSERT INTO users (
          id, email, phone, display_name, username, current_country, preferred_language,
          status, email_verified, phone_verified, verification_level, verification_badge_label,
          is_demo_data, onboarding_completed, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'India', 'en', 'active', ?, ?, ?, ?, 0, 0, ?, ?)`
      ).run(
        userId,
        channel === 'email' ? normalized : null,
        channel === 'phone' ? normalized : null,
        channel === 'email' ? normalized.split('@')[0] : 'AbroadConnect Member',
        uniqueUsername,
        channel === 'email' ? 1 : 0,
        channel === 'phone' ? 1 : 0,
        channel === 'email' ? 'email' : 'phone',
        channel === 'email' ? 'Email Verified' : 'Phone Verified',
        ts,
        ts
      );

      db.prepare('INSERT INTO user_roles (user_id, role, assigned_by, created_at) VALUES (?, ?, ?, ?)').run(
        userId,
        'registered_member',
        'otp_registration',
        ts
      );

      db.prepare(
        `INSERT INTO user_profiles_extended (
          user_id, consent_tos_at, consent_privacy_at, profile_completion_pct
        ) VALUES (?, ?, ?, 20)`
      ).run(userId, acceptedTerms ? ts : null, acceptedTerms ? ts : null);

      db.prepare(
        `INSERT INTO journeys (id, user_id, destination_country, purpose, target_intake, current_stage, updated_at)
         VALUES (?, ?, 'Germany', 'Study', 'Winter 2027', 'Explore', ?)`
      ).run(uuid(), userId, ts);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
      isNewUser = true;

      createNotification(
        db,
        userId,
        'welcome',
        'Welcome to AbroadConnect India',
        'Complete your destination profile to receive transparent group and peer recommendations.',
        'onboarding'
      );
    } else {
      if (user.status === 'banned' || user.status === 'suspended') {
        res.status(403).json({ error: 'This account is currently restricted. Please contact Support & Grievance Redressal.' });
        return;
      }
      if (channel === 'email' && !user.email_verified) {
        db.prepare("UPDATE users SET email_verified = 1, verification_level = CASE WHEN verification_level = 'none' THEN 'email' ELSE verification_level END, updated_at = ? WHERE id = ?").run(ts, user.id);
      }
      if (channel === 'phone' && !user.phone_verified) {
        db.prepare("UPDATE users SET phone_verified = 1, verification_level = CASE WHEN verification_level = 'none' THEN 'phone' ELSE verification_level END, updated_at = ? WHERE id = ?").run(ts, user.id);
      }
    }

    const token = generateSessionToken();
    const sessionId = uuid();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, user.id, hashToken(token), String(req.headers['user-agent'] || '').slice(0, 200), req.ip || '', expiresAt, ts);

    setSessionCookie(res, token, req);
    logAudit(db, String(user.id), 'auth.otp_login', 'user', String(user.id), { channel, isNewUser }, req.ip || '');

    const roles = (db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(user.id) as Array<{ role: string }>).map(
      (r) => r.role
    );
    const profile = db.prepare('SELECT * FROM user_profiles_extended WHERE user_id = ?').get(user.id);

    res.json({
      token,
      isNewUser,
      user: { ...user, password_hash: undefined, roles, profile },
    });
  });

  // First-run Admin Setup / Claim & Admin Login
  router.get('/auth/admin/status', (_req, res) => {
    const adminExists = Boolean(
      db
        .prepare("SELECT 1 FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.role IN ('super_admin', 'platform_admin') AND u.password_hash IS NOT NULL LIMIT 1")
        .get()
    );
    const envPasscodeConfigured = Boolean(process.env.ADMIN_CLAIM_PASSCODE && process.env.ADMIN_CLAIM_PASSCODE.trim().length > 0);
    res.json({ adminClaimed: adminExists, envPasscodeConfigured });
  });

  const adminClaimSchema = z.object({
    email: z.string().email().max(120),
    displayName: z.string().trim().min(2).max(80).optional(),
    password: z.string().min(8).max(128),
    passcode: z.string().max(128).optional(),
  });

  router.post('/auth/admin/claim', rateLimitMiddleware('admin_claim', 10, 60_000), (req, res) => {
    const parsed = adminClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid email and password (8+ characters) are required.' });
      return;
    }
    const { email, displayName, password, passcode } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const envPasscode = process.env.ADMIN_CLAIM_PASSCODE?.trim();

    const existingAdmin = db
      .prepare("SELECT u.id, u.email, u.password_hash FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.role IN ('super_admin', 'platform_admin') AND u.password_hash IS NOT NULL LIMIT 1")
      .get() as { id: string; email: string | null; password_hash: string | null } | undefined;

    if (envPasscode) {
      const a = crypto.createHash('sha256').update(String(passcode || '')).digest();
      const b = crypto.createHash('sha256').update(envPasscode).digest();
      if (!passcode || !crypto.timingSafeEqual(a, b)) {
        res.status(403).json({ error: 'Invalid administrator passcode.' });
        return;
      }
    } else if (existingAdmin) {
      // Login path for claimed admin
      const targetUser = db
        .prepare("SELECT u.* FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE u.email = ? AND ur.role IN ('super_admin', 'platform_admin') LIMIT 1")
        .get(normalizedEmail) as Record<string, unknown> | undefined;
      if (!targetUser || typeof targetUser.password_hash !== 'string' || !verifyPassword(password, targetUser.password_hash)) {
        res.status(401).json({ error: 'Invalid administrator credentials.' });
        return;
      }
      const token = generateSessionToken();
      const ts = nowIso();
      db.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(uuid(), targetUser.id, hashToken(token), String(req.headers['user-agent'] || '').slice(0, 200), req.ip || '', new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(), ts);
      setSessionCookie(res, token, req);
      logAudit(db, String(targetUser.id), 'auth.admin_login', 'user', String(targetUser.id), {}, req.ip || '');
      const roles = (db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(targetUser.id) as Array<{ role: string }>).map((r) => r.role);
      const profile = db.prepare('SELECT * FROM user_profiles_extended WHERE user_id = ?').get(targetUser.id);
      res.json({ token, user: { ...targetUser, password_hash: undefined, roles, profile } });
      return;
    }

    // First-run atomic admin claim or env-passcode authorized admin creation
    const ts = nowIso();
    const pwdHash = hashPassword(password);
    let userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail) as Record<string, unknown> | undefined;

    if (!userRow) {
      const uid = uuid();
      const uname = `admin_${normalizedEmail.split('@')[0].replace(/[^a-z0-9_]/gi, '_').slice(0, 16)}`;
      db.prepare(
        `INSERT INTO users (
          id, email, display_name, username, current_country, preferred_language, status,
          email_verified, verification_level, verification_badge_label, password_hash,
          is_demo_data, onboarding_completed, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'India', 'en', 'active', 1, 'official_moderator', 'Platform Moderator & Admin', ?, 0, 1, ?, ?)`
      ).run(uid, normalizedEmail, displayName || 'Platform Administrator', uname, pwdHash, ts, ts);
      db.prepare(
        `INSERT INTO user_profiles_extended (user_id, primary_destination_country, purpose, intended_intake, consent_tos_at, consent_privacy_at, profile_completion_pct)
         VALUES (?, 'germany', 'Study', 'Winter 2027', ?, ?, 80)`
      ).run(uid, ts, ts);
      db.prepare(
        `INSERT INTO journeys (id, user_id, destination_country, purpose, target_intake, current_stage, updated_at)
         VALUES (?, ?, 'Germany', 'Study', 'Winter 2027', 'Explore', ?)`
      ).run(uuid(), uid, ts);
      userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as Record<string, unknown>;
    } else {
      db.prepare(
        `UPDATE users SET password_hash = ?, verification_level = 'official_moderator', verification_badge_label = 'Platform Moderator & Admin', updated_at = ? WHERE id = ?`
      ).run(pwdHash, ts, userRow.id);
    }

    for (const role of ['registered_member', 'group_moderator', 'resource_editor', 'support_agent', 'platform_admin', 'super_admin']) {
      db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role, assigned_by, created_at) VALUES (?, ?, ?, ?)').run(
        userRow.id,
        role,
        'admin_bootstrap',
        ts
      );
    }

    const token = generateSessionToken();
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(uuid(), userRow.id, hashToken(token), String(req.headers['user-agent'] || '').slice(0, 200), req.ip || '', new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(), ts);
    setSessionCookie(res, token, req);
    logAudit(db, String(userRow.id), 'auth.admin_claimed', 'user', String(userRow.id), { email: normalizedEmail }, req.ip || '');

    const roles = (db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(userRow.id) as Array<{ role: string }>).map((r) => r.role);
    const profile = db.prepare('SELECT * FROM user_profiles_extended WHERE user_id = ?').get(userRow.id);
    res.json({ token, user: { ...userRow, password_hash: undefined, roles, profile } });
  });

  router.get('/auth/me', (req, res) => {
    if (!req.authUser) {
      res.json({ authenticated: false, user: null });
      return;
    }
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.authUser.id) as Record<string, unknown>;
    const profile = db.prepare('SELECT * FROM user_profiles_extended WHERE user_id = ?').get(req.authUser.id);
    res.json({
      authenticated: true,
      user: {
        ...userRow,
        password_hash: undefined,
        roles: req.authUser.roles,
        profile,
      },
    });
  });

  router.post('/auth/logout', requireAuth, (req, res) => {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), req.authUser!.sessionId);
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  router.get('/auth/sessions', requireAuth, (req, res) => {
    const rows = db
      .prepare('SELECT id, user_agent, ip_address, expires_at, revoked_at, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(req.authUser!.id);
    res.json({ sessions: rows, currentSessionId: req.authUser!.sessionId });
  });

  router.delete('/auth/sessions/:id', requireAuth, (req, res) => {
    const target = db.prepare('SELECT id, user_id FROM sessions WHERE id = ?').get(req.params.id) as
      | { id: string; user_id: string }
      | undefined;
    if (!target || target.user_id !== req.authUser!.id) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), target.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // PROFILES, ONBOARDING, PRIVACY & DPDP DATA CONTROLS
  // ---------------------------------------------------------------------------
  router.put('/profiles/me', requireAuth, (req, res) => {
    const body = req.body as Record<string, unknown>;
    const uid = req.authUser!.id;
    const ts = nowIso();

    const currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as Record<string, unknown>;
    const currentProf = db.prepare('SELECT * FROM user_profiles_extended WHERE user_id = ?').get(uid) as Record<string, unknown>;

    const displayName = typeof body.display_name === 'string' && body.display_name.trim() ? body.display_name.trim().slice(0, 80) : String(currentUser.display_name);
    const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 500) : String(currentUser.bio || '');
    const currentCountry = typeof body.current_country === 'string' ? body.current_country.trim().slice(0, 80) : String(currentUser.current_country || 'India');
    const state = typeof body.state === 'string' ? body.state.trim().slice(0, 80) : String(currentUser.state || '');
    const city = typeof body.city === 'string' ? body.city.trim().slice(0, 80) : String(currentUser.city || '');
    const preferredLang = typeof body.preferred_language === 'string' && ['en', 'hi', 'ta'].includes(body.preferred_language) ? body.preferred_language : String(currentUser.preferred_language || 'en');
    const onboardingCompleted = body.onboarding_completed === true ? 1 : Number(currentUser.onboarding_completed || 0);

    db.prepare(
      `UPDATE users SET display_name = ?, bio = ?, current_country = ?, state = ?, city = ?, preferred_language = ?, onboarding_completed = ?, updated_at = ? WHERE id = ?`
    ).run(displayName, bio, currentCountry, state, city, preferredLang, onboardingCompleted, ts, uid);

    const nextProf = {
      highest_qualification: typeof body.highest_qualification === 'string' ? body.highest_qualification.trim().slice(0, 100) : String(currentProf.highest_qualification || ''),
      degree_specialization: typeof body.degree_specialization === 'string' ? body.degree_specialization.trim().slice(0, 100) : String(currentProf.degree_specialization || ''),
      graduation_year: typeof body.graduation_year === 'string' ? body.graduation_year.trim().slice(0, 12) : String(currentProf.graduation_year || ''),
      institution: typeof body.institution === 'string' ? body.institution.trim().slice(0, 120) : String(currentProf.institution || ''),
      academic_score_private: typeof body.academic_score_private === 'string' ? body.academic_score_private.trim().slice(0, 40) : String(currentProf.academic_score_private || ''),
      english_proficiency: typeof body.english_proficiency === 'string' ? body.english_proficiency.trim().slice(0, 60) : String(currentProf.english_proficiency || ''),
      other_language_proficiency: typeof body.other_language_proficiency === 'string' ? body.other_language_proficiency.trim().slice(0, 60) : String(currentProf.other_language_proficiency || ''),
      employment_status: typeof body.employment_status === 'string' ? body.employment_status.trim().slice(0, 60) : String(currentProf.employment_status || ''),
      industry: typeof body.industry === 'string' ? body.industry.trim().slice(0, 80) : String(currentProf.industry || ''),
      skills_json: Array.isArray(body.skills) ? JSON.stringify(body.skills.slice(0, 20).map(String)) : String(currentProf.skills_json || '[]'),
      experience_level: typeof body.experience_level === 'string' ? body.experience_level.trim().slice(0, 40) : String(currentProf.experience_level || ''),
      primary_destination_country: typeof body.primary_destination_country === 'string' ? body.primary_destination_country.trim().toLowerCase().slice(0, 60) : String(currentProf.primary_destination_country || ''),
      secondary_countries_json: Array.isArray(body.secondary_countries) ? JSON.stringify(body.secondary_countries.slice(0, 5).map(String)) : String(currentProf.secondary_countries_json || '[]'),
      purpose: typeof body.purpose === 'string' ? body.purpose.trim().slice(0, 40) : String(currentProf.purpose || ''),
      intended_intake: typeof body.intended_intake === 'string' ? body.intended_intake.trim().slice(0, 40) : String(currentProf.intended_intake || ''),
      budget_range_private: typeof body.budget_range_private === 'string' ? body.budget_range_private.trim().slice(0, 60) : String(currentProf.budget_range_private || ''),
      application_stage: typeof body.application_stage === 'string' ? body.application_stage.trim().slice(0, 40) : String(currentProf.application_stage || 'Explore'),
      interested_cities_json: Array.isArray(body.interested_cities) ? JSON.stringify(body.interested_cities.slice(0, 10).map(String)) : String(currentProf.interested_cities_json || '[]'),
      wants_mentor: typeof body.wants_mentor === 'boolean' ? (body.wants_mentor ? 1 : 0) : Number(currentProf.wants_mentor || 0),
      discoverable_buddy: typeof body.discoverable_buddy === 'boolean' ? (body.discoverable_buddy ? 1 : 0) : Number(currentProf.discoverable_buddy ?? 1),
      profile_visibility: typeof body.profile_visibility === 'string' && ['public', 'members', 'connections'].includes(body.profile_visibility) ? body.profile_visibility : String(currentProf.profile_visibility || 'members'),
      messaging_permission: typeof body.messaging_permission === 'string' && ['anyone', 'connections_only', 'none'].includes(body.messaging_permission) ? body.messaging_permission : String(currentProf.messaging_permission || 'anyone'),
      show_online_presence: typeof body.show_online_presence === 'boolean' ? (body.show_online_presence ? 1 : 0) : Number(currentProf.show_online_presence ?? 1),
      show_read_receipts: typeof body.show_read_receipts === 'boolean' ? (body.show_read_receipts ? 1 : 0) : Number(currentProf.show_read_receipts ?? 1),
      consent_tos_at: body.accept_terms === true ? (currentProf.consent_tos_at || ts) : currentProf.consent_tos_at,
      consent_privacy_at: body.accept_terms === true ? (currentProf.consent_privacy_at || ts) : currentProf.consent_privacy_at,
    };

    const pct = calculateCompletion(nextProf, { display_name: displayName, city, bio });
    db.prepare(
      `UPDATE user_profiles_extended SET
        highest_qualification = ?, degree_specialization = ?, graduation_year = ?, institution = ?,
        academic_score_private = ?, english_proficiency = ?, other_language_proficiency = ?,
        employment_status = ?, industry = ?, skills_json = ?, experience_level = ?,
        primary_destination_country = ?, secondary_countries_json = ?, purpose = ?, intended_intake = ?,
        budget_range_private = ?, application_stage = ?, interested_cities_json = ?, wants_mentor = ?,
        discoverable_buddy = ?, profile_visibility = ?, messaging_permission = ?,
        show_online_presence = ?, show_read_receipts = ?, consent_tos_at = ?, consent_privacy_at = ?,
        profile_completion_pct = ?
       WHERE user_id = ?`
    ).run(
      nextProf.highest_qualification,
      nextProf.degree_specialization,
      nextProf.graduation_year,
      nextProf.institution,
      nextProf.academic_score_private,
      nextProf.english_proficiency,
      nextProf.other_language_proficiency,
      nextProf.employment_status,
      nextProf.industry,
      nextProf.skills_json,
      nextProf.experience_level,
      nextProf.primary_destination_country,
      nextProf.secondary_countries_json,
      nextProf.purpose,
      nextProf.intended_intake,
      nextProf.budget_range_private,
      nextProf.application_stage,
      nextProf.interested_cities_json,
      nextProf.wants_mentor,
      nextProf.discoverable_buddy,
      nextProf.profile_visibility,
      nextProf.messaging_permission,
      nextProf.show_online_presence,
      nextProf.show_read_receipts,
      nextProf.consent_tos_at,
      nextProf.consent_privacy_at,
      pct,
      uid
    );

    if (nextProf.primary_destination_country) {
      db.prepare('UPDATE journeys SET destination_country = ?, purpose = ?, target_intake = ?, current_stage = ?, updated_at = ? WHERE user_id = ?').run(
        nextProf.primary_destination_country,
        nextProf.purpose || 'Study',
        nextProf.intended_intake || 'Winter 2027',
        nextProf.application_stage || 'Explore',
        ts,
        uid
      );
    }

    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as Record<string, unknown>;
    const updatedProf = db.prepare('SELECT * FROM user_profiles_extended WHERE user_id = ?').get(uid);
    res.json({ user: { ...updatedUser, password_hash: undefined, roles: req.authUser!.roles, profile: updatedProf } });
  });

  // DPDP Data Export
  router.get('/users/me/export', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const user = db.prepare('SELECT id, email, phone, display_name, username, bio, current_country, state, city, preferred_language, verification_level, created_at FROM users WHERE id = ?').get(uid);
    const profile = db.prepare('SELECT * FROM user_profiles_extended WHERE user_id = ?').get(uid);
    const posts = db.prepare('SELECT id, group_id, post_type, title, body, created_at FROM posts WHERE author_id = ?').all(uid);
    const comments = db.prepare('SELECT id, post_id, body, created_at FROM comments WHERE author_id = ?').all(uid);
    const journeys = db.prepare('SELECT * FROM journeys WHERE user_id = ?').all(uid);
    const tasks = db.prepare('SELECT * FROM journey_tasks WHERE user_id = ?').all(uid);
    const applications = db.prepare('SELECT * FROM university_applications WHERE user_id = ?').all(uid);
    logAudit(db, uid, 'user.data_export', 'user', uid, {}, req.ip || '');
    res.json({ exported_at: nowIso(), user, profile, posts, comments, journeys, tasks, applications });
  });

  // DPDP Account Deletion
  router.delete('/users/me', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    logAudit(db, uid, 'user.account_deleted', 'user', uid, {}, req.ip || '');
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    clearSessionCookie(res, req);
    res.json({ ok: true, message: 'Account and associated personal records deleted.' });
  });

  // ---------------------------------------------------------------------------
  // COUNTRIES
  // ---------------------------------------------------------------------------
  router.get('/countries', (_req, res) => {
    const countries = db.prepare('SELECT * FROM countries WHERE is_active = 1 ORDER BY name ASC').all();
    res.json({ countries });
  });

  router.get('/countries/:slug', (req, res) => {
    const country = db.prepare('SELECT * FROM countries WHERE slug = ? AND is_active = 1').get(req.params.slug);
    if (!country) {
      res.status(404).json({ error: 'Country hub not found.' });
      return;
    }
    const groups = db
      .prepare('SELECT id, slug, name, category, privacy, description FROM groups WHERE country_slug = ? AND is_archived = 0')
      .all(req.params.slug);
    const universities = db.prepare('SELECT * FROM universities WHERE country_slug = ?').all(req.params.slug);
    const scholarships = db.prepare('SELECT * FROM scholarships WHERE country_slug = ?').all(req.params.slug);
    const jobs = db.prepare('SELECT * FROM jobs WHERE country_slug = ?').all(req.params.slug);
    const apprenticeships = db.prepare('SELECT * FROM apprenticeships WHERE country_slug = ?').all(req.params.slug);
    const mentors = db
      .prepare(
        `SELECT m.*, u.display_name, u.username, u.verification_badge_label, u.is_demo_data
         FROM mentors m JOIN users u ON u.id = m.user_id
         WHERE LOWER(m.current_country) = LOWER((SELECT name FROM countries WHERE slug = ?))
           AND m.verification_status = 'approved' AND m.is_suspended = 0`
      )
      .all(req.params.slug);
    const resources = db.prepare("SELECT * FROM resources WHERE country_slug = ? OR country_slug = 'all'").all(req.params.slug);
    const discussions = db
      .prepare(
        `SELECT p.id, p.title, p.post_type, p.created_at, g.name as group_name, g.slug as group_slug, u.display_name as author_name
         FROM posts p
         JOIN groups g ON g.id = p.group_id
         JOIN users u ON u.id = p.author_id
         WHERE g.country_slug = ? AND g.privacy = 'public' AND p.is_hidden = 0
         ORDER BY p.created_at DESC LIMIT 8`
      )
      .all(req.params.slug);

    res.json({ country, groups, universities, scholarships, jobs, apprenticeships, mentors, resources, discussions });
  });

  // ---------------------------------------------------------------------------
  // GROUPS, RECOMMENDATIONS & DISCUSSIONS
  // ---------------------------------------------------------------------------
  router.get('/groups', (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const country = typeof req.query.country === 'string' ? req.query.country : '';
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    let sql = `
      SELECT g.*,
        (SELECT COUNT(*) FROM group_memberships gm WHERE gm.group_id = g.id) as member_count,
        (SELECT COUNT(*) FROM posts p WHERE p.group_id = g.id AND p.is_hidden = 0) as post_count
      FROM groups g
      WHERE g.is_archived = 0
    `;
    const params: unknown[] = [];
    if (category && category !== 'all') {
      sql += ' AND g.category = ?';
      params.push(category);
    }
    if (country && country !== 'all') {
      sql += ' AND g.country_slug = ?';
      params.push(country);
    }
    if (search) {
      sql += ' AND (g.name LIKE ? OR g.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY member_count DESC, g.name ASC';

    const groups = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    const uid = req.authUser?.id;
    const myMemberships = new Set<string>();
    const myPending = new Set<string>();
    if (uid) {
      for (const m of db.prepare('SELECT group_id FROM group_memberships WHERE user_id = ?').all(uid) as Array<{ group_id: string }>) {
        myMemberships.add(m.group_id);
      }
      for (const r of db.prepare("SELECT group_id FROM group_join_requests WHERE user_id = ? AND status = 'pending'").all(uid) as Array<{ group_id: string }>) {
        myPending.add(r.group_id);
      }
    }

    res.json({
      groups: groups.map((g) => ({
        ...g,
        is_member: myMemberships.has(String(g.id)),
        join_request_pending: myPending.has(String(g.id)),
      })),
    });
  });

  // Rule-based recommendations (transparent explanation, zero expensive AI)
  router.get('/groups/recommendations', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const profile = db.prepare('SELECT * FROM user_profiles_extended WHERE user_id = ?').get(uid) as Record<string, unknown> | undefined;
    const dest = String(profile?.primary_destination_country || 'germany').toLowerCase();
    const purpose = String(profile?.purpose || 'Study').toLowerCase();
    const intake = String(profile?.intended_intake || 'Winter 2027').toLowerCase();

    const groups = db
      .prepare(
        `SELECT g.*, (SELECT COUNT(*) FROM group_memberships gm WHERE gm.group_id = g.id) as member_count
         FROM groups g WHERE g.is_archived = 0`
      )
      .all() as Array<Record<string, unknown>>;

    const myMemberships = new Set(
      (db.prepare('SELECT group_id FROM group_memberships WHERE user_id = ?').all(uid) as Array<{ group_id: string }>).map(
        (m) => m.group_id
      )
    );

    const scored = groups.map((g) => {
      const reasons: string[] = [];
      let score = 0;
      if (g.country_slug && String(g.country_slug).toLowerCase() === dest) {
        score += 5;
        reasons.push(`Matches your target country (${dest})`);
      }
      if (g.purpose && String(g.purpose).toLowerCase() === purpose) {
        score += 4;
        reasons.push(`Matches your ${profile?.purpose || 'Study'} goal`);
      }
      if (intake && String(g.name).toLowerCase().includes(intake.split(' ')[0].toLowerCase())) {
        score += 3;
        reasons.push(`Matches your ${profile?.intended_intake} timeline`);
      }
      if (String(g.slug).includes('scam-watch') || String(g.slug).includes('ielts')) {
        score += 1;
        reasons.push('Recommended foundational preparation & safety group');
      }
      return {
        ...g,
        is_member: myMemberships.has(String(g.id)),
        match_score: score,
        match_reason: reasons.length > 0 ? reasons.join(' · ') : 'Active peer community',
      };
    });

    scored.sort((a, b) => b.match_score - a.match_score);
    res.json({ recommendations: scored.slice(0, 6) });
  });

  // Group detail + strict private group authorization!
  router.get('/groups/:idOrSlug', (req, res) => {
    const group = db
      .prepare('SELECT * FROM groups WHERE (id = ? OR slug = ?) AND is_archived = 0')
      .get(req.params.idOrSlug, req.params.idOrSlug) as Record<string, unknown> | undefined;

    if (!group) {
      res.status(404).json({ error: 'Community group not found.' });
      return;
    }

    const uid = req.authUser?.id;
    const isAdmin = Boolean(req.authUser?.roles.some((r) => ['platform_admin', 'super_admin'].includes(r)));
    const membership = uid
      ? (db.prepare('SELECT role, is_muted FROM group_memberships WHERE group_id = ? AND user_id = ?').get(group.id, uid) as
          | { role: string; is_muted: number }
          | undefined)
      : undefined;
    const pendingReq = uid
      ? db.prepare("SELECT id FROM group_join_requests WHERE group_id = ? AND user_id = ? AND status = 'pending'").get(group.id, uid)
      : undefined;

    const memberCount = (db.prepare('SELECT COUNT(*) as c FROM group_memberships WHERE group_id = ?').get(group.id) as { c: number }).c;

    if (group.privacy !== 'public' && !membership && !isAdmin) {
      // Do NOT expose posts, member directory, or private chat! Return metadata shell only.
      res.json({
        group: {
          id: group.id,
          slug: group.slug,
          name: group.name,
          category: group.category,
          country_slug: group.country_slug,
          purpose: group.purpose,
          privacy: group.privacy,
          description: group.description,
          rules_json: group.rules_json,
          member_count: memberCount,
        },
        accessGranted: false,
        isMember: false,
        joinRequestPending: Boolean(pendingReq),
        posts: [],
        members: [],
        joinRequests: [],
      });
      return;
    }

    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
    const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    let postSql = `
      SELECT p.*, u.display_name as author_name, u.username as author_username,
             u.verification_badge_label as author_badge, u.is_demo_data as author_is_demo,
             (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.is_hidden = 0) as comment_count,
             (SELECT COUNT(*) FROM post_reactions pr WHERE pr.post_id = p.id) as reaction_count
      FROM posts p
      JOIN users u ON u.id = p.author_id
      WHERE p.group_id = ? AND p.is_hidden = 0
    `;
    const postParams: unknown[] = [group.id];
    if (filter === 'unanswered') {
      postSql += " AND p.post_type = 'question' AND p.is_answered = 0 AND (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.is_hidden = 0) = 0";
    }
    if (q) {
      postSql += ' AND (p.title LIKE ? OR p.body LIKE ?)';
      postParams.push(`%${q}%`, `%${q}%`);
    }
    if (sort === 'active') {
      postSql += ' ORDER BY p.is_pinned DESC, comment_count DESC, reaction_count DESC, p.created_at DESC';
    } else {
      postSql += ' ORDER BY p.is_pinned DESC, p.created_at DESC';
    }

    const posts = db.prepare(postSql).all(...postParams) as Array<Record<string, unknown>>;
    const enrichedPosts = posts.map((p) => {
      const comments = db
        .prepare(
          `SELECT c.*, u.display_name as author_name, u.username as author_username, u.verification_badge_label as author_badge
           FROM comments c JOIN users u ON u.id = c.author_id
           WHERE c.post_id = ? AND c.is_hidden = 0 ORDER BY c.created_at ASC`
        )
        .all(p.id);
      const pollOptions =
        p.post_type === 'poll'
          ? db
              .prepare(
                `SELECT po.id, po.label, (SELECT COUNT(*) FROM poll_votes pv WHERE pv.option_id = po.id) as votes
                 FROM poll_options po WHERE po.post_id = ?`
              )
              .all(p.id)
          : [];
      const userReacted = uid ? Boolean(db.prepare('SELECT 1 FROM post_reactions WHERE post_id = ? AND user_id = ?').get(p.id, uid)) : false;
      const userSaved = uid ? Boolean(db.prepare("SELECT 1 FROM saved_items WHERE user_id = ? AND item_type = 'post' AND item_id = ?").get(uid, p.id)) : false;
      return { ...p, comments, pollOptions, userReacted, userSaved };
    });

    const members = db
      .prepare(
        `SELECT u.id, u.display_name, u.username, u.city, u.current_country, u.verification_badge_label, gm.role as group_role, gm.joined_at
         FROM group_memberships gm JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ? ORDER BY gm.role DESC, gm.joined_at ASC LIMIT 50`
      )
      .all(group.id);

    const canModerate = membership?.role === 'moderator' || isAdmin || Boolean(req.authUser?.roles.includes('group_moderator'));
    const joinRequests = canModerate
      ? db
          .prepare(
            `SELECT jr.*, u.display_name, u.username, u.city
             FROM group_join_requests jr JOIN users u ON u.id = jr.user_id
             WHERE jr.group_id = ? AND jr.status = 'pending' ORDER BY jr.created_at ASC`
          )
          .all(group.id)
      : [];

    const groupConv = db.prepare("SELECT id FROM conversations WHERE type = 'group' AND group_id = ?").get(group.id) as { id: string } | undefined;

    res.json({
      group: { ...group, member_count: memberCount, conversation_id: groupConv?.id || null },
      accessGranted: true,
      isMember: Boolean(membership),
      groupRole: membership?.role || null,
      isMuted: Boolean(membership?.is_muted),
      canModerate,
      joinRequestPending: Boolean(pendingReq),
      posts: enrichedPosts,
      members,
      joinRequests,
    });
  });

  // Join public group or request private group access
  router.post('/groups/:id/join', requireAuth, (req, res) => {
    const group = db.prepare('SELECT * FROM groups WHERE id = ? AND is_archived = 0').get(req.params.id) as Record<string, unknown> | undefined;
    if (!group) {
      res.status(404).json({ error: 'Group not found.' });
      return;
    }

    const uid = req.authUser!.id;
    const existing = db.prepare('SELECT 1 FROM group_memberships WHERE group_id = ? AND user_id = ?').get(group.id, uid);
    if (existing) {
      res.json({ status: 'member', message: 'You are already a member of this group.' });
      return;
    }

    const ts = nowIso();
    if (group.privacy === 'public') {
      db.prepare('INSERT INTO group_memberships (group_id, user_id, role, is_muted, joined_at) VALUES (?, ?, ?, 0, ?)').run(
        group.id,
        uid,
        'member',
        ts
      );
      const conv = db.prepare("SELECT id FROM conversations WHERE type = 'group' AND group_id = ?").get(group.id) as { id: string } | undefined;
      if (conv) {
        db.prepare('INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, last_read_at, is_muted) VALUES (?, ?, ?, 0)').run(
          conv.id,
          uid,
          ts
        );
      }
      res.json({ status: 'joined', message: `Joined ${group.name}.` });
      return;
    }

    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
    const existingReq = db.prepare("SELECT id FROM group_join_requests WHERE group_id = ? AND user_id = ? AND status = 'pending'").get(group.id, uid);
    if (!existingReq) {
      db.prepare('INSERT INTO group_join_requests (id, group_id, user_id, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        uuid(),
        group.id,
        uid,
        note,
        'pending',
        ts
      );
    }
    res.json({ status: 'requested', message: 'Your request to join this private group has been sent to group moderators.' });
  });

  router.post('/groups/:id/leave', requireAuth, (req, res) => {
    db.prepare('DELETE FROM group_memberships WHERE group_id = ? AND user_id = ?').run(req.params.id, req.authUser!.id);
    const conv = db.prepare("SELECT id FROM conversations WHERE type = 'group' AND group_id = ?").get(req.params.id) as { id: string } | undefined;
    if (conv) {
      db.prepare('DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?').run(conv.id, req.authUser!.id);
    }
    res.json({ ok: true });
  });

  router.post('/groups/:id/mute', requireAuth, (req, res) => {
    const muted = req.body?.muted ? 1 : 0;
    db.prepare('UPDATE group_memberships SET is_muted = ? WHERE group_id = ? AND user_id = ?').run(muted, req.params.id, req.authUser!.id);
    res.json({ ok: true, is_muted: Boolean(muted) });
  });

  // Moderator approves or rejects private group join request
  router.post('/groups/:groupId/requests/:requestId', requireAuth, (req, res) => {
    const decision = req.body?.decision === 'approved' ? 'approved' : 'rejected';
    const uid = req.authUser!.id;
    const isAdminOrGlobalMod = req.authUser!.roles.some((r) => ['group_moderator', 'platform_admin', 'super_admin'].includes(r));
    const groupMod = db
      .prepare("SELECT 1 FROM group_memberships WHERE group_id = ? AND user_id = ? AND role = 'moderator'")
      .get(req.params.groupId, uid);

    if (!isAdminOrGlobalMod && !groupMod) {
      res.status(403).json({ error: 'Only group moderators or administrators can review join requests.' });
      return;
    }

    const jr = db.prepare('SELECT * FROM group_join_requests WHERE id = ? AND group_id = ?').get(req.params.requestId, req.params.groupId) as
      | { id: string; user_id: string; group_id: string }
      | undefined;
    if (!jr) {
      res.status(404).json({ error: 'Join request not found.' });
      return;
    }

    const ts = nowIso();
    db.prepare('UPDATE group_join_requests SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run(decision, uid, ts, jr.id);
    if (decision === 'approved') {
      db.prepare('INSERT OR IGNORE INTO group_memberships (group_id, user_id, role, is_muted, joined_at) VALUES (?, ?, ?, 0, ?)').run(
        jr.group_id,
        jr.user_id,
        'member',
        ts
      );
      const conv = db.prepare("SELECT id FROM conversations WHERE type = 'group' AND group_id = ?").get(jr.group_id) as { id: string } | undefined;
      if (conv) {
        db.prepare('INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, last_read_at, is_muted) VALUES (?, ?, ?, 0)').run(
          conv.id,
          jr.user_id,
          ts
        );
      }
      createNotification(db, jr.user_id, 'group_approved', 'Private Group Access Approved', 'Your request to join the cohort has been approved.', `group:${jr.group_id}`);
    }
    logAudit(db, uid, `group.join_request_${decision}`, 'group_join_request', jr.id, { groupId: jr.group_id, applicantId: jr.user_id }, req.ip || '');
    res.json({ ok: true, status: decision });
  });

  // ---------------------------------------------------------------------------
  // POSTS, POLLS & COMMENTS
  // ---------------------------------------------------------------------------
  const postCreateSchema = z.object({
    group_id: z.string().min(1),
    post_type: z.enum(['discussion', 'question', 'experience', 'poll', 'announcement']).default('discussion'),
    title: z.string().trim().min(3).max(180),
    body: z.string().trim().min(3).max(6000),
    tags: z.array(z.string().trim().max(30)).max(5).optional(),
    link_url: z.string().max(500).optional().nullable(),
    poll_options: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
  });

  router.post('/posts', requireActiveWriter, (req, res) => {
    const parsed = postCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please include a valid title and post body.' });
      return;
    }

    const { group_id, post_type, title, body, tags, link_url, poll_options } = parsed.data;
    const uid = req.authUser!.id;
    const group = db.prepare('SELECT * FROM groups WHERE id = ? AND is_archived = 0').get(group_id) as Record<string, unknown> | undefined;
    if (!group) {
      res.status(404).json({ error: 'Group not found.' });
      return;
    }

    const membership = db.prepare('SELECT role FROM group_memberships WHERE group_id = ? AND user_id = ?').get(group_id, uid) as
      | { role: string }
      | undefined;
    const isAdmin = req.authUser!.roles.some((r) => ['platform_admin', 'super_admin'].includes(r));
    if (!membership && !isAdmin) {
      res.status(403).json({ error: 'Please join the group before publishing posts.' });
      return;
    }

    const validatedLink = link_url ? safeUrl(link_url) : null;
    if (link_url && !validatedLink) {
      res.status(400).json({ error: 'Links must start with http:// or https://.' });
      return;
    }

    const signals = detectSafetySignals(`${title}\n${body}`);
    const postId = uuid();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO posts (
        id, group_id, author_id, post_type, title, body, tags_json, link_url,
        is_pinned, is_hidden, is_answered, safety_signals_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`
    ).run(postId, group_id, uid, post_type, title, body, JSON.stringify(tags || []), validatedLink, JSON.stringify(signals), ts, ts);

    if (post_type === 'poll' && poll_options && poll_options.length >= 2) {
      const insertOpt = db.prepare('INSERT INTO poll_options (id, post_id, label) VALUES (?, ?, ?)');
      for (const opt of poll_options) {
        insertOpt.run(uuid(), postId, opt);
      }
    }

    // Automatically surface high-risk review signals in moderation queue
    if (signals.length > 0) {
      db.prepare(
        `INSERT INTO reports (
          id, reporter_id, target_type, target_id, reported_user_id, group_id, category, details,
          safety_signals_json, priority, status, created_at, updated_at
        ) VALUES (?, NULL, 'post', ?, ?, ?, 'Scam', ?, ?, 'high', 'open', ?, ?)`
      ).run(
        uuid(),
        postId,
        uid,
        group_id,
        `Automated safety signal detected for human review: ${signals.join('; ')}`,
        JSON.stringify(signals),
        ts,
        ts
      );
    }

    const created = db
      .prepare(
        `SELECT p.*, u.display_name as author_name, u.username as author_username, u.verification_badge_label as author_badge
         FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`
      )
      .get(postId);

    res.status(201).json({ post: created, safetySignalsFlagged: signals });
  });

  router.patch('/posts/:id', requireActiveWriter, (req, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!post) {
      res.status(404).json({ error: 'Post not found.' });
      return;
    }
    if (post.author_id !== req.authUser!.id) {
      res.status(403).json({ error: 'You can only edit your own posts.' });
      return;
    }
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 180) : String(post.title);
    const body = typeof req.body?.body === 'string' && req.body.body.trim() ? req.body.body.trim().slice(0, 6000) : String(post.body);
    db.prepare('UPDATE posts SET title = ?, body = ?, updated_at = ? WHERE id = ?').run(title, body, nowIso(), post.id);
    res.json({ ok: true });
  });

  router.delete('/posts/:id', requireAuth, (req, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!post) {
      res.status(404).json({ error: 'Post not found.' });
      return;
    }
    const uid = req.authUser!.id;
    const isMod = req.authUser!.roles.some((r) => ['group_moderator', 'platform_admin', 'super_admin'].includes(r));
    if (post.author_id !== uid && !isMod) {
      res.status(403).json({ error: 'Unauthorized to delete this post.' });
      return;
    }
    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
    if (post.author_id !== uid) {
      logAudit(db, uid, 'post.deleted_by_moderator', 'post', String(post.id), { authorId: post.author_id }, req.ip || '');
    }
    res.json({ ok: true });
  });

  router.post('/posts/:id/comments', requireActiveWriter, (req, res) => {
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const parentId = typeof req.body?.parent_id === 'string' ? req.body.parent_id : null;
    if (!body || body.length > 3000) {
      res.status(400).json({ error: 'Comment text must be between 1 and 3000 characters.' });
      return;
    }
    const post = db
      .prepare('SELECT p.*, g.privacy FROM posts p JOIN groups g ON g.id = p.group_id WHERE p.id = ?')
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!post) {
      res.status(404).json({ error: 'Post not found.' });
      return;
    }
    const uid = req.authUser!.id;
    if (post.privacy !== 'public') {
      const mem = db.prepare('SELECT 1 FROM group_memberships WHERE group_id = ? AND user_id = ?').get(post.group_id, uid);
      if (!mem) {
        res.status(403).json({ error: 'Private group membership required to comment.' });
        return;
      }
    }
    const cid = uuid();
    const ts = nowIso();
    db.prepare('INSERT INTO comments (id, post_id, parent_id, author_id, body, is_hidden, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
      cid,
      post.id,
      parentId,
      uid,
      body,
      ts
    );
    if (post.post_type === 'question') {
      db.prepare('UPDATE posts SET is_answered = 1 WHERE id = ?').run(post.id);
    }
    if (post.author_id !== uid) {
      createNotification(db, String(post.author_id), 'post_reply', 'New reply to your post', body.slice(0, 100), `group:${post.group_id}`);
    }
    const created = db
      .prepare(
        `SELECT c.*, u.display_name as author_name, u.username as author_username, u.verification_badge_label as author_badge
         FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`
      )
      .get(cid);
    res.status(201).json({ comment: created });
  });

  router.post('/posts/:id/react', requireActiveWriter, (req, res) => {
    const uid = req.authUser!.id;
    const post = db
      .prepare('SELECT p.id, p.group_id, g.privacy FROM posts p JOIN groups g ON g.id = p.group_id WHERE p.id = ?')
      .get(req.params.id) as { id: string; group_id: string; privacy: string } | undefined;
    if (!post) {
      res.status(404).json({ error: 'Post not found.' });
      return;
    }
    if (post.privacy !== 'public') {
      const mem = db.prepare('SELECT 1 FROM group_memberships WHERE group_id = ? AND user_id = ?').get(post.group_id, uid);
      if (!mem) {
        res.status(403).json({ error: 'Private group membership required.' });
        return;
      }
    }
    const existing = db.prepare('SELECT 1 FROM post_reactions WHERE post_id = ? AND user_id = ?').get(req.params.id, uid);
    if (existing) {
      db.prepare('DELETE FROM post_reactions WHERE post_id = ? AND user_id = ?').run(req.params.id, uid);
      res.json({ reacted: false });
    } else {
      db.prepare('INSERT INTO post_reactions (post_id, user_id, reaction_type) VALUES (?, ?, ?)').run(req.params.id, uid, 'helpful');
      res.json({ reacted: true });
    }
  });

  router.post('/posts/:id/vote', requireActiveWriter, (req, res) => {
    const uid = req.authUser!.id;
    const post = db
      .prepare('SELECT p.id, p.group_id, g.privacy FROM posts p JOIN groups g ON g.id = p.group_id WHERE p.id = ?')
      .get(req.params.id) as { id: string; group_id: string; privacy: string } | undefined;
    if (!post) {
      res.status(404).json({ error: 'Post not found.' });
      return;
    }
    if (post.privacy !== 'public') {
      const mem = db.prepare('SELECT 1 FROM group_memberships WHERE group_id = ? AND user_id = ?').get(post.group_id, uid);
      if (!mem) {
        res.status(403).json({ error: 'Private group membership required.' });
        return;
      }
    }
    const optionId = String(req.body?.option_id || '');
    const opt = db.prepare('SELECT id FROM poll_options WHERE id = ? AND post_id = ?').get(optionId, req.params.id);
    if (!opt) {
      res.status(400).json({ error: 'Invalid poll option.' });
      return;
    }
    db.prepare('INSERT OR REPLACE INTO poll_votes (post_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(
      req.params.id,
      optionId,
      uid,
      nowIso()
    );
    res.json({ ok: true });
  });

  router.post('/saved', requireAuth, (req, res) => {
    const itemType = String(req.body?.item_type || '');
    const itemId = String(req.body?.item_id || '');
    if (!['post', 'university', 'job', 'apprenticeship', 'scholarship', 'resource'].includes(itemType) || !itemId) {
      res.status(400).json({ error: 'Invalid item to save.' });
      return;
    }
    const uid = req.authUser!.id;
    if (itemType === 'post') {
      const post = db
        .prepare('SELECT p.id, p.group_id, g.privacy FROM posts p JOIN groups g ON g.id = p.group_id WHERE p.id = ?')
        .get(itemId) as { id: string; group_id: string; privacy: string } | undefined;
      if (!post) {
        res.status(404).json({ error: 'Post not found.' });
        return;
      }
      if (post.privacy !== 'public') {
        const mem = db.prepare('SELECT 1 FROM group_memberships WHERE group_id = ? AND user_id = ?').get(post.group_id, uid);
        if (!mem) {
          res.status(403).json({ error: 'Private group membership required.' });
          return;
        }
      }
    }
    const existing = db.prepare('SELECT 1 FROM saved_items WHERE user_id = ? AND item_type = ? AND item_id = ?').get(uid, itemType, itemId);
    if (existing) {
      db.prepare('DELETE FROM saved_items WHERE user_id = ? AND item_type = ? AND item_id = ?').run(uid, itemType, itemId);
      res.json({ saved: false });
    } else {
      db.prepare('INSERT INTO saved_items (user_id, item_type, item_id, created_at) VALUES (?, ?, ?, ?)').run(uid, itemType, itemId, nowIso());
      res.json({ saved: true });
    }
  });

  router.get('/saved', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const items = db.prepare('SELECT item_type, item_id, created_at FROM saved_items WHERE user_id = ? ORDER BY created_at DESC').all(uid) as Array<{
      item_type: string;
      item_id: string;
      created_at: string;
    }>;
    const resolved = items.map((item) => {
      let detail: unknown = null;
      if (item.item_type === 'post') {
        detail = db
          .prepare(
            `SELECT p.id, p.title, p.group_id, g.name as group_name
             FROM posts p JOIN groups g ON g.id = p.group_id
             WHERE p.id = ? AND p.is_hidden = 0
               AND (g.privacy = 'public' OR EXISTS (SELECT 1 FROM group_memberships gm WHERE gm.group_id = g.id AND gm.user_id = ?))`
          )
          .get(item.item_id, uid);
      } else if (item.item_type === 'university') {
        detail = db.prepare('SELECT id, name, city, country_slug FROM universities WHERE id = ?').get(item.item_id);
      } else if (item.item_type === 'job') {
        detail = db.prepare('SELECT id, title, employer, country_slug FROM jobs WHERE id = ?').get(item.item_id);
      } else if (item.item_type === 'apprenticeship') {
        detail = db.prepare('SELECT id, title, training_provider, country_slug FROM apprenticeships WHERE id = ?').get(item.item_id);
      } else if (item.item_type === 'scholarship') {
        detail = db.prepare('SELECT id, title, provider, country_slug, funding_type FROM scholarships WHERE id = ?').get(item.item_id);
      } else if (item.item_type === 'resource') {
        detail = db.prepare('SELECT id, title, category, country_slug, source_type FROM resources WHERE id = ?').get(item.item_id);
      }
      return { ...item, detail };
    }).filter((x) => Boolean(x.detail));
    res.json({ saved: resolved });
  });

  // ---------------------------------------------------------------------------
  // DISCOVER PEOPLE ("FIND MY ABROAD BUDDY") & NETWORKING
  // ---------------------------------------------------------------------------
  router.get('/people/discover', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const myProf = db.prepare('SELECT * FROM user_profiles_extended WHERE user_id = ?').get(uid) as Record<string, unknown> | undefined;

    const countryFilter = typeof req.query.country === 'string' ? req.query.country.toLowerCase() : '';
    const purposeFilter = typeof req.query.purpose === 'string' ? req.query.purpose.toLowerCase() : '';
    const intakeFilter = typeof req.query.intake === 'string' ? req.query.intake.toLowerCase() : '';
    const buddyMode = req.query.buddy === '1';

    // Never return private fields (email, phone, academic_score_private, budget_range_private)
    const candidates = db
      .prepare(
        `SELECT u.id, u.display_name, u.username, u.bio, u.current_country, u.state, u.city,
                u.preferred_language, u.verification_level, u.verification_badge_label, u.is_demo_data,
                p.highest_qualification, p.degree_specialization, p.industry, p.skills_json,
                p.primary_destination_country, p.purpose, p.intended_intake, p.application_stage,
                p.interested_cities_json, p.messaging_permission
         FROM users u
         JOIN user_profiles_extended p ON p.user_id = u.id
         WHERE u.id != ?
           AND u.status = 'active'
           AND p.discoverable_buddy = 1
           AND u.id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
           AND u.id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)`
      )
      .all(uid, uid, uid) as Array<Record<string, unknown>>;

    const connections = db
      .prepare('SELECT requester_id, addressee_id, status FROM connections WHERE requester_id = ? OR addressee_id = ?')
      .all(uid, uid) as Array<{ requester_id: string; addressee_id: string; status: string }>;

    const connMap = new Map<string, string>();
    for (const c of connections) {
      const otherId = c.requester_id === uid ? c.addressee_id : c.requester_id;
      connMap.set(otherId, c.status === 'pending' && c.addressee_id === uid ? 'incoming_pending' : c.status);
    }

    const myDest = String(myProf?.primary_destination_country || '').toLowerCase();
    const myPurpose = String(myProf?.purpose || '').toLowerCase();
    const myIntake = String(myProf?.intended_intake || '').toLowerCase();

    const results = candidates
      .filter((c) => {
        if (countryFilter && countryFilter !== 'all' && String(c.primary_destination_country || '').toLowerCase() !== countryFilter) return false;
        if (purposeFilter && purposeFilter !== 'all' && String(c.purpose || '').toLowerCase() !== purposeFilter) return false;
        if (intakeFilter && intakeFilter !== 'all' && String(c.intended_intake || '').toLowerCase() !== intakeFilter) return false;
        return true;
      })
      .map((c) => {
        const shared: string[] = [];
        let score = 0;
        if (myDest && String(c.primary_destination_country || '').toLowerCase() === myDest) {
          score += 5;
          shared.push(String(c.primary_destination_country).replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()));
        }
        if (myPurpose && String(c.purpose || '').toLowerCase() === myPurpose) {
          score += 4;
          shared.push(`${c.purpose} track`);
        }
        if (myIntake && String(c.intended_intake || '').toLowerCase() === myIntake) {
          score += 3;
          shared.push(String(c.intended_intake));
        }

        const matchExplanation =
          shared.length > 0
            ? `Both of you are targeting ${shared.join(', ')}.`
            : 'Active community member open to peer connections.';

        return {
          ...c,
          connection_status: connMap.get(String(c.id)) || 'none',
          match_score: score,
          match_explanation: matchExplanation,
        };
      });

    if (buddyMode) {
      results.sort((a, b) => b.match_score - a.match_score);
    }
    res.json({ people: results });
  });

  router.post('/connections/request', requireActiveWriter, (req, res) => {
    const addresseeId = String(req.body?.user_id || '');
    const uid = req.authUser!.id;
    if (!addresseeId || addresseeId === uid) {
      res.status(400).json({ error: 'Invalid member selected.' });
      return;
    }

    const blocked = db
      .prepare('SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
      .get(uid, addresseeId, addresseeId, uid);
    if (blocked) {
      res.status(403).json({ error: 'Cannot connect with this account.' });
      return;
    }

    const existing = db
      .prepare('SELECT id, status FROM connections WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)')
      .get(uid, addresseeId, addresseeId, uid) as { id: string; status: string } | undefined;
    if (existing) {
      res.json({ status: existing.status, id: existing.id });
      return;
    }

    const cid = uuid();
    const ts = nowIso();
    db.prepare('INSERT INTO connections (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      cid,
      uid,
      addresseeId,
      'pending',
      ts,
      ts
    );
    createNotification(db, addresseeId, 'connection_request', 'New connection request', `${req.authUser!.display_name} wants to connect with you.`, 'people');
    res.status(201).json({ id: cid, status: 'pending' });
  });

  router.post('/connections/:id/respond', requireAuth, (req, res) => {
    const decision = req.body?.decision === 'accepted' ? 'accepted' : 'declined';
    const uid = req.authUser!.id;
    const conn = db
      .prepare('SELECT * FROM connections WHERE (id = ? OR requester_id = ?) AND addressee_id = ?')
      .get(req.params.id, req.params.id, uid) as { id: string; requester_id: string; addressee_id: string } | undefined;
    if (!conn) {
      res.status(404).json({ error: 'Connection request not found.' });
      return;
    }
    db.prepare('UPDATE connections SET status = ?, updated_at = ? WHERE id = ?').run(decision, nowIso(), conn.id);
    if (decision === 'accepted') {
      createNotification(db, conn.requester_id, 'connection_accepted', 'Connection accepted', `${req.authUser!.display_name} accepted your connection request.`, 'people');
    }
    res.json({ ok: true, status: decision });
  });

  router.post('/users/:id/block', requireAuth, (req, res) => {
    const blockedId = req.params.id;
    const uid = req.authUser!.id;
    if (blockedId === uid) {
      res.status(400).json({ error: 'Cannot block yourself.' });
      return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
    db.prepare('INSERT OR REPLACE INTO user_blocks (blocker_id, blocked_id, reason, created_at) VALUES (?, ?, ?, ?)').run(
      uid,
      blockedId,
      reason,
      nowIso()
    );
    db.prepare('DELETE FROM connections WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)').run(
      uid,
      blockedId,
      blockedId,
      uid
    );
    logAudit(db, uid, 'user.blocked', 'user', blockedId, {}, req.ip || '');
    res.json({ ok: true });
  });

  router.delete('/users/:id/block', requireAuth, (req, res) => {
    db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.authUser!.id, req.params.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // MESSAGING (DIRECT & GROUP CHAT)
  // ---------------------------------------------------------------------------
  router.get('/conversations', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const rows = db
      .prepare(
        `SELECT c.*, cp.is_muted, cp.last_read_at,
                g.name as group_name, g.slug as group_slug, g.moderator_only_chat
         FROM conversations c
         JOIN conversation_participants cp ON cp.conversation_id = c.id
         LEFT JOIN groups g ON g.id = c.group_id
         WHERE cp.user_id = ? AND c.status != 'rejected'
         ORDER BY c.created_at DESC`
      )
      .all(uid) as Array<Record<string, unknown>>;

    const enriched = rows.map((c) => {
      const lastMsg = db
        .prepare('SELECT body, created_at, sender_id FROM messages WHERE conversation_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1')
        .get(c.id) as { body: string; created_at: string; sender_id: string } | undefined;

      let peer: Record<string, unknown> | null = null;
      if (c.type === 'direct') {
        peer =
          (db
            .prepare(
              `SELECT u.id, u.display_name, u.username, u.verification_badge_label, p.show_online_presence
               FROM conversation_participants cp
               JOIN users u ON u.id = cp.user_id
               LEFT JOIN user_profiles_extended p ON p.user_id = u.id
               WHERE cp.conversation_id = ? AND cp.user_id != ?`
            )
            .get(c.id, uid) as Record<string, unknown> | undefined) || null;
      }

      return { ...c, lastMessage: lastMsg || null, peer };
    });

    res.json({ conversations: enriched });
  });

  router.post('/conversations/direct', requireActiveWriter, (req, res) => {
    const targetUserId = String(req.body?.user_id || '');
    const uid = req.authUser!.id;
    if (!targetUserId || targetUserId === uid) {
      res.status(400).json({ error: 'Select a valid member to message.' });
      return;
    }

    const blocked = db
      .prepare('SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
      .get(uid, targetUserId, targetUserId, uid);
    if (blocked) {
      res.status(403).json({ error: 'Messaging is blocked between these accounts.' });
      return;
    }

    const targetProf = db
      .prepare('SELECT messaging_permission FROM user_profiles_extended WHERE user_id = ?')
      .get(targetUserId) as { messaging_permission: string } | undefined;
    if (!targetProf) {
      res.status(404).json({ error: 'Member not found.' });
      return;
    }
    if (targetProf.messaging_permission === 'none') {
      res.status(403).json({ error: 'This member has disabled incoming direct messages.' });
      return;
    }

    const isConnected = Boolean(
      db
        .prepare("SELECT 1 FROM connections WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)) AND status = 'accepted'")
        .get(uid, targetUserId, targetUserId, uid)
    );
    if (targetProf.messaging_permission === 'connections_only' && !isConnected) {
      res.status(403).json({ error: 'This member accepts messages from accepted connections only.' });
      return;
    }

    // Check existing DM
    const existing = db
      .prepare(
        `SELECT c.id FROM conversations c
         JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = ?
         JOIN conversation_participants p2 ON p2.conversation_id = c.id AND p2.user_id = ?
         WHERE c.type = 'direct'`
      )
      .get(uid, targetUserId) as { id: string } | undefined;

    if (existing) {
      res.json({ conversationId: existing.id });
      return;
    }

    const convId = uuid();
    const ts = nowIso();
    const status = isConnected ? 'active' : 'request_pending';
    db.prepare('INSERT INTO conversations (id, type, status, initiated_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
      convId,
      'direct',
      status,
      uid,
      ts
    );
    db.prepare('INSERT INTO conversation_participants (conversation_id, user_id, last_read_at, is_muted) VALUES (?, ?, ?, 0)').run(
      convId,
      uid,
      ts
    );
    db.prepare('INSERT INTO conversation_participants (conversation_id, user_id, last_read_at, is_muted) VALUES (?, ?, NULL, 0)').run(
      convId,
      targetUserId
    );

    if (status === 'request_pending') {
      createNotification(db, targetUserId, 'message_request', 'New message request', `${req.authUser!.display_name} sent you a message request.`, `messages:${convId}`);
    }

    res.status(201).json({ conversationId: convId, status });
  });

  router.post('/conversations/:id/respond', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const conv = db
      .prepare(
        `SELECT c.* FROM conversations c
         JOIN conversation_participants cp ON cp.conversation_id = c.id
         WHERE c.id = ? AND cp.user_id = ?`
      )
      .get(req.params.id, uid) as { id: string; initiated_by: string | null } | undefined;
    if (!conv || conv.initiated_by === uid) {
      res.status(403).json({ error: 'Unauthorized action on message request.' });
      return;
    }
    const nextStatus = req.body?.decision === 'accept' ? 'active' : 'rejected';
    db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(nextStatus, conv.id);
    res.json({ ok: true, status: nextStatus });
  });

  router.get('/conversations/:id/messages', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const participant = db
      .prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?')
      .get(req.params.id, uid);
    if (!participant) {
      res.status(403).json({ error: 'Unauthorized conversation access.' });
      return;
    }
    const msgs = db
      .prepare(
        `SELECT m.*, u.display_name as sender_name, u.username as sender_username
         FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ? AND m.is_deleted = 0
         ORDER BY m.created_at ASC LIMIT 200`
      )
      .all(req.params.id);

    db.prepare('UPDATE conversation_participants SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(
      nowIso(),
      req.params.id,
      uid
    );
    res.json({ messages: msgs });
  });

  router.post('/conversations/:id/messages', requireActiveWriter, rateLimitMiddleware('msg_send', 40, 60_000), (req, res) => {
    const uid = req.authUser!.id;
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const replyToId = typeof req.body?.reply_to_id === 'string' ? req.body.reply_to_id : null;
    if (!body || body.length > 4000) {
      res.status(400).json({ error: 'Message text must be between 1 and 4000 characters.' });
      return;
    }

    const conv = db
      .prepare(
        `SELECT c.* FROM conversations c
         JOIN conversation_participants cp ON cp.conversation_id = c.id
         WHERE c.id = ? AND cp.user_id = ?`
      )
      .get(req.params.id, uid) as { id: string; type: string; group_id: string | null; status: string } | undefined;

    if (!conv || conv.status === 'rejected') {
      res.status(403).json({ error: 'Unauthorized conversation access.' });
      return;
    }

    if (conv.type === 'direct') {
      const other = db
        .prepare('SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?')
        .get(conv.id, uid) as { user_id: string } | undefined;
      if (other) {
        const blocked = db
          .prepare('SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
          .get(uid, other.user_id, other.user_id, uid);
        if (blocked) {
          res.status(403).json({ error: 'Messaging blocked between users.' });
          return;
        }
        createNotification(db, other.user_id, 'new_message', 'New direct message', `${req.authUser!.display_name}: ${body.slice(0, 80)}`, `messages:${conv.id}`);
      }
    }

    const msgId = uuid();
    const ts = nowIso();
    const signals = detectSafetySignals(body);
    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, reply_to_id, body, safety_signals_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(msgId, conv.id, uid, replyToId, body, JSON.stringify(signals), ts);

    const payload = {
      id: msgId,
      conversation_id: conv.id,
      sender_id: uid,
      sender_name: req.authUser!.display_name,
      sender_username: req.authUser!.username || '',
      reply_to_id: replyToId,
      body,
      safety_signals_json: JSON.stringify(signals),
      is_edited: 0,
      is_deleted: 0,
      created_at: ts,
    };

    broadcastConversationRealtime(db, conv.id, 'message:new', payload);
    res.status(201).json({ message: payload });
  });

  router.delete('/messages/:id', requireAuth, (req, res) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as { id: string; sender_id: string } | undefined;
    if (!msg) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    if (msg.sender_id !== req.authUser!.id) {
      res.status(403).json({ error: 'You can only delete your own messages.' });
      return;
    }
    db.prepare('UPDATE messages SET is_deleted = 1 WHERE id = ?').run(msg.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // MENTORS & SESSIONS
  // ---------------------------------------------------------------------------
  router.get('/mentors', (req, res) => {
    const country = typeof req.query.country === 'string' ? req.query.country : '';
    let sql = `
      SELECT m.*, u.display_name, u.username, u.verification_badge_label, u.is_demo_data
      FROM mentors m
      JOIN users u ON u.id = m.user_id
      WHERE m.verification_status = 'approved' AND m.is_suspended = 0
    `;
    const params: unknown[] = [];
    if (country && country !== 'all') {
      sql += ' AND LOWER(m.current_country) = LOWER(?)';
      params.push(country.replace(/-/g, ' '));
    }
    sql += ' ORDER BY m.years_experience DESC';
    const mentors = db.prepare(sql).all(...params);
    res.json({ mentors });
  });

  router.post('/mentors/apply', requireAuth, (req, res) => {
    const body = req.body as Record<string, unknown>;
    const mentorType = typeof body.mentor_type === 'string' ? body.mentor_type.trim() : '';
    const currentCountry = typeof body.current_country === 'string' ? body.current_country.trim() : '';
    const currentCity = typeof body.current_city === 'string' ? body.current_city.trim() : '';
    const evidenceSummary = typeof body.evidence_summary === 'string' ? body.evidence_summary.trim() : '';
    if (!mentorType || !currentCountry || !evidenceSummary) {
      res.status(400).json({ error: 'Mentor category, current country, and verification evidence summary are required.' });
      return;
    }
    const id = uuid();
    db.prepare(
      `INSERT INTO mentor_applications (
        id, user_id, mentor_type, current_country, current_city, institution_or_employer,
        evidence_summary, expertise_json, languages_json, years_experience, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(
      id,
      req.authUser!.id,
      mentorType,
      currentCountry,
      currentCity,
      String(body.institution_or_employer || '').slice(0, 120),
      evidenceSummary.slice(0, 1200),
      JSON.stringify(Array.isArray(body.expertise) ? body.expertise : []),
      JSON.stringify(Array.isArray(body.languages) ? body.languages : ['English']),
      Number(body.years_experience || 1),
      nowIso()
    );
    res.status(201).json({ id, status: 'pending', message: 'Application submitted for private administrative review.' });
  });

  router.get('/mentors/sessions/me', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const sessions = db
      .prepare(
        `SELECT ms.*, m.mentor_type, m.current_country, u.display_name as mentor_name
         FROM mentor_sessions ms
         JOIN mentors m ON m.id = ms.mentor_id
         JOIN users u ON u.id = m.user_id
         WHERE ms.mentee_id = ? OR m.user_id = ?
         ORDER BY ms.created_at DESC`
      )
      .all(uid, uid);
    res.json({ sessions });
  });

  router.post('/mentors/:id/sessions', requireAuth, (req, res) => {
    const mentor = db.prepare("SELECT * FROM mentors WHERE id = ? AND verification_status = 'approved' AND is_suspended = 0").get(req.params.id) as
      | { id: string; user_id: string }
      | undefined;
    if (!mentor) {
      res.status(404).json({ error: 'Verified mentor not found.' });
      return;
    }
    const topic = String(req.body?.topic || '').trim().slice(0, 140);
    const slot = String(req.body?.scheduled_slot || '').trim().slice(0, 80);
    const question = String(req.body?.question || '').trim().slice(0, 1000);
    if (!topic || !slot || !question) {
      res.status(400).json({ error: 'Topic, preferred time slot, and question are required.' });
      return;
    }
    const sid = uuid();
    db.prepare(
      `INSERT INTO mentor_sessions (id, mentor_id, mentee_id, topic, scheduled_slot, question, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'requested', ?)`
    ).run(sid, mentor.id, req.authUser!.id, topic, slot, question, nowIso());
    createNotification(db, mentor.user_id, 'mentor_request', 'New free mentorship request', `${req.authUser!.display_name}: ${topic}`, 'mentors');
    res.status(201).json({ id: sid, status: 'requested' });
  });

  // ---------------------------------------------------------------------------
  // UNIVERSITIES, JOBS, APPRENTICESHIPS, SCHOLARSHIPS, RESOURCES
  // ---------------------------------------------------------------------------
  router.get('/universities', (req, res) => {
    const country = typeof req.query.country === 'string' ? req.query.country : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let sql = 'SELECT * FROM universities WHERE 1=1';
    const params: unknown[] = [];
    if (country && country !== 'all') {
      sql += ' AND country_slug = ?';
      params.push(country);
    }
    if (q) {
      sql += ' AND (name LIKE ? OR city LIKE ? OR programs_json LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY name ASC';
    res.json({ universities: db.prepare(sql).all(...params) });
  });

  router.get('/jobs', (req, res) => {
    const country = typeof req.query.country === 'string' ? req.query.country : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let sql = 'SELECT * FROM jobs WHERE 1=1';
    const params: unknown[] = [];
    if (country && country !== 'all') {
      sql += ' AND country_slug = ?';
      params.push(country);
    }
    if (q) {
      sql += ' AND (title LIKE ? OR employer LIKE ? OR skills_json LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    res.json({ jobs: db.prepare(sql).all(...params) });
  });

  router.get('/apprenticeships', (req, res) => {
    const country = typeof req.query.country === 'string' ? req.query.country : '';
    let sql = 'SELECT * FROM apprenticeships WHERE 1=1';
    const params: unknown[] = [];
    if (country && country !== 'all') {
      sql += ' AND country_slug = ?';
      params.push(country);
    }
    res.json({ apprenticeships: db.prepare(sql).all(...params) });
  });

  router.get('/scholarships', (req, res) => {
    const country = typeof req.query.country === 'string' ? req.query.country : '';
    const funding = typeof req.query.funding_type === 'string' ? req.query.funding_type : '';
    let sql = 'SELECT * FROM scholarships WHERE 1=1';
    const params: unknown[] = [];
    if (country && country !== 'all') {
      sql += ' AND country_slug = ?';
      params.push(country);
    }
    if (funding && funding !== 'all') {
      sql += ' AND funding_type = ?';
      params.push(funding);
    }
    res.json({ scholarships: db.prepare(sql).all(...params) });
  });

  router.get('/resources', (req, res) => {
    const country = typeof req.query.country === 'string' ? req.query.country : '';
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    let sql = 'SELECT * FROM resources WHERE 1=1';
    const params: unknown[] = [];
    if (country && country !== 'all') {
      sql += " AND (country_slug = ? OR country_slug = 'all')";
      params.push(country);
    }
    if (category && category !== 'all') {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY last_reviewed DESC';
    res.json({ resources: db.prepare(sql).all(...params) });
  });

  // ---------------------------------------------------------------------------
  // PERSONALIZED JOURNEY & PRIVATE APPLICATION TRACKER
  // ---------------------------------------------------------------------------
  router.get('/journeys/me', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    let journey = db.prepare('SELECT * FROM journeys WHERE user_id = ?').get(uid) as Record<string, unknown> | undefined;
    if (!journey) {
      const jid = uuid();
      const ts = nowIso();
      db.prepare('INSERT INTO journeys (id, user_id, destination_country, purpose, target_intake, current_stage, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        jid,
        uid,
        'Germany',
        'Study',
        'Winter 2027',
        'Explore',
        ts
      );
      journey = db.prepare('SELECT * FROM journeys WHERE id = ?').get(jid) as Record<string, unknown>;
    }
    const tasks = db.prepare('SELECT * FROM journey_tasks WHERE user_id = ? ORDER BY is_completed ASC, created_at DESC').all(uid);
    const applications = db
      .prepare(
        `SELECT ua.*, u.name as university_name, u.city as university_city, u.country_slug
         FROM university_applications ua
         JOIN universities u ON u.id = ua.university_id
         WHERE ua.user_id = ? ORDER BY ua.updated_at DESC`
      )
      .all(uid);
    res.json({ journey, tasks, applications });
  });

  router.put('/journeys/me', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const stage = typeof req.body?.current_stage === 'string' ? req.body.current_stage.trim().slice(0, 60) : 'Explore';
    const dest = typeof req.body?.destination_country === 'string' ? req.body.destination_country.trim().slice(0, 60) : 'Germany';
    const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose.trim().slice(0, 40) : 'Study';
    const intake = typeof req.body?.target_intake === 'string' ? req.body.target_intake.trim().slice(0, 40) : 'Winter 2027';
    db.prepare('UPDATE journeys SET current_stage = ?, destination_country = ?, purpose = ?, target_intake = ?, updated_at = ? WHERE user_id = ?').run(
      stage,
      dest,
      purpose,
      intake,
      nowIso(),
      uid
    );
    res.json({ ok: true });
  });

  router.post('/journeys/tasks', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const title = String(req.body?.title || '').trim().slice(0, 180);
    if (!title) {
      res.status(400).json({ error: 'Task title is required.' });
      return;
    }
    const journey = db.prepare('SELECT id FROM journeys WHERE user_id = ?').get(uid) as { id: string } | undefined;
    const jid = journey?.id || uuid();
    if (!journey) {
      db.prepare('INSERT INTO journeys (id, user_id, updated_at) VALUES (?, ?, ?)').run(jid, uid, nowIso());
    }
    const tid = uuid();
    db.prepare(
      `INSERT INTO journey_tasks (id, journey_id, user_id, title, category, stage, due_date, is_completed, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      tid,
      jid,
      uid,
      title,
      String(req.body?.category || 'General').slice(0, 40),
      String(req.body?.stage || 'Prepare').slice(0, 40),
      String(req.body?.due_date || '').slice(0, 30),
      String(req.body?.notes || '').slice(0, 400),
      nowIso()
    );
    const created = db.prepare('SELECT * FROM journey_tasks WHERE id = ?').get(tid);
    res.status(201).json({ task: created });
  });

  router.patch('/journeys/tasks/:id', requireAuth, (req, res) => {
    const task = db.prepare('SELECT * FROM journey_tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.authUser!.id) as
      | Record<string, unknown>
      | undefined;
    if (!task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }
    const completed = typeof req.body?.is_completed === 'boolean' ? (req.body.is_completed ? 1 : 0) : Number(task.is_completed);
    db.prepare('UPDATE journey_tasks SET is_completed = ? WHERE id = ?').run(completed, task.id);
    res.json({ ok: true, is_completed: Boolean(completed) });
  });

  router.delete('/journeys/tasks/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM journey_tasks WHERE id = ? AND user_id = ?').run(req.params.id, req.authUser!.id);
    res.json({ ok: true });
  });

  router.post('/applications', requireAuth, (req, res) => {
    const uid = req.authUser!.id;
    const universityId = String(req.body?.university_id || '');
    const programName = String(req.body?.program_name || '').trim().slice(0, 140);
    const allowedStatuses = new Set([
      'Researching',
      'Shortlisted',
      'Preparing Documents',
      'Applied',
      'Interview Scheduled',
      'Offer Received',
      'Offer Accepted',
      'Visa / Loan Stage',
      'Waitlisted / Rejected',
      'Withdrawn',
    ]);
    const requestedStatus = String(req.body?.status || 'Researching').slice(0, 40);
    const status = allowedStatuses.has(requestedStatus) ? requestedStatus : 'Researching';
    const deadline = String(req.body?.deadline || '').slice(0, 40);
    const notes = String(req.body?.notes || '').slice(0, 800);
    if (!universityId || !programName) {
      res.status(400).json({ error: 'University and program name are required.' });
      return;
    }
    const uniExists = db.prepare('SELECT 1 FROM universities WHERE id = ?').get(universityId);
    if (!uniExists) {
      res.status(404).json({ error: 'University not found.' });
      return;
    }
    const id = uuid();
    db.prepare(
      `INSERT INTO university_applications (id, user_id, university_id, program_name, status, deadline, notes, checklist_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      uid,
      universityId,
      programName,
      status,
      deadline,
      notes,
      JSON.stringify(['Transcripts ready', 'English test score', 'SOP draft', 'References']),
      nowIso()
    );
    res.status(201).json({ id });
  });

  router.patch('/applications/:id', requireAuth, (req, res) => {
    const appRow = db.prepare('SELECT * FROM university_applications WHERE id = ? AND user_id = ?').get(req.params.id, req.authUser!.id) as
      | Record<string, unknown>
      | undefined;
    if (!appRow) {
      res.status(404).json({ error: 'Application record not found.' });
      return;
    }
    const status = typeof req.body?.status === 'string' ? req.body.status.slice(0, 40) : String(appRow.status);
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 800) : String(appRow.notes);
    db.prepare('UPDATE university_applications SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(status, notes, nowIso(), appRow.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // NOTIFICATIONS
  // ---------------------------------------------------------------------------
  router.get('/notifications', requireAuth, (req, res) => {
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
      .all(req.authUser!.id) as Array<{ is_read: number }>;
    const unreadCount = rows.filter((r) => r.is_read === 0).length;
    res.json({ notifications: rows, unreadCount });
  });

  router.post('/notifications/read-all', requireAuth, (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.authUser!.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // REPORTING, SUPPORT, GRIEVANCES & WAITLIST
  // ---------------------------------------------------------------------------
  router.post('/reports', requireAuth, (req, res) => {
    const targetType = String(req.body?.target_type || '');
    const targetId = String(req.body?.target_id || '');
    const category = String(req.body?.category || 'Other').slice(0, 50);
    const details = String(req.body?.details || '').trim().slice(0, 1500);
    const reportedUserId = typeof req.body?.reported_user_id === 'string' ? req.body.reported_user_id : null;
    const groupId = typeof req.body?.group_id === 'string' ? req.body.group_id : null;

    if (!targetType || !targetId || !details) {
      res.status(400).json({ error: 'Report category, target, and description are required.' });
      return;
    }

    const signals = detectSafetySignals(details);
    const priority = ['Scam', 'Fake recruitment', 'Privacy violation', 'Harassment'].includes(category) ? 'high' : 'medium';
    const rid = uuid();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO reports (
        id, reporter_id, target_type, target_id, reported_user_id, group_id, category, details,
        safety_signals_json, priority, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    ).run(rid, req.authUser!.id, targetType, targetId, reportedUserId, groupId, category, details, JSON.stringify(signals), priority, ts, ts);

    logAudit(db, req.authUser!.id, 'report.submitted', targetType, targetId, { reportId: rid, category }, req.ip || '');
    res.status(201).json({ id: rid, status: 'open', message: 'Report submitted to our Trust & Safety moderation queue.' });
  });

  router.post('/support', rateLimitMiddleware('support_ticket', 10, 60_000), (req, res) => {
    const email = String(req.body?.email || req.authUser?.email || '').trim().toLowerCase();
    const subject = String(req.body?.subject || '').trim().slice(0, 160);
    const category = String(req.body?.category || 'support').slice(0, 40);
    const description = String(req.body?.description || '').trim().slice(0, 2000);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !subject || !description) {
      res.status(400).json({ error: 'Valid email, subject, and details are required.' });
      return;
    }
    const id = uuid();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO support_tickets (id, user_id, email, subject, category, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    ).run(id, req.authUser?.id || null, email, subject, category, description, ts, ts);
    res.status(201).json({ id, status: 'open', message: 'Your request has been logged with the Support & Grievance Desk.' });
  });

  // ---------------------------------------------------------------------------
  // MODERATION QUEUE (BACKEND-ENFORCED RBAC)
  // ---------------------------------------------------------------------------
  router.get('/moderation/queue', requireRole(['group_moderator', 'platform_admin', 'super_admin']), (req, res) => {
    const reports = db
      .prepare(
        `SELECT r.*,
                rep.display_name as reporter_name,
                acc.display_name as reported_user_name,
                g.name as group_name
         FROM reports r
         LEFT JOIN users rep ON rep.id = r.reporter_id
         LEFT JOIN users acc ON acc.id = r.reported_user_id
         LEFT JOIN groups g ON g.id = r.group_id
         ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
                  CASE r.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  r.created_at DESC`
      )
      .all();
    res.json({ reports });
  });

  router.post('/moderation/reports/:id/action', requireRole(['group_moderator', 'platform_admin', 'super_admin']), (req, res) => {
    const action = String(req.body?.action || '');
    const notes = String(req.body?.notes || '').trim().slice(0, 500);
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    const ts = nowIso();
    let nextStatus = 'resolved';
    if (action === 'dismiss') nextStatus = 'dismissed';
    else if (action === 'escalate') nextStatus = 'escalated';
    else if (action === 'request_info') nextStatus = 'in_review';

    if (action === 'hide_content' || action === 'remove_content') {
      if (report.target_type === 'post') {
        db.prepare('UPDATE posts SET is_hidden = 1 WHERE id = ?').run(report.target_id);
      } else if (report.target_type === 'comment') {
        db.prepare('UPDATE comments SET is_hidden = 1 WHERE id = ?').run(report.target_id);
      } else if (report.target_type === 'message') {
        db.prepare('UPDATE messages SET is_deleted = 1 WHERE id = ?').run(report.target_id);
      }
    } else if (action === 'restrict_user' && report.reported_user_id) {
      db.prepare("UPDATE users SET status = 'restricted', updated_at = ? WHERE id = ?").run(ts, report.reported_user_id);
    } else if (action === 'suspend_user' && report.reported_user_id) {
      db.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?").run(ts, report.reported_user_id);
    } else if (action === 'ban_user' && report.reported_user_id) {
      db.prepare("UPDATE users SET status = 'banned', updated_at = ? WHERE id = ?").run(ts, report.reported_user_id);
    }

    if (report.reported_user_id && ['warn', 'restrict_user', 'suspend_user', 'ban_user', 'hide_content'].includes(action)) {
      createNotification(
        db,
        String(report.reported_user_id),
        'moderation_action',
        'Community safety notice',
        `A moderator took action (${action.replace('_', ' ')}) following a safety review. You may submit an appeal via Help & Safety.`,
        'support'
      );
    }

    db.prepare('UPDATE reports SET status = ?, assigned_moderator_id = ?, resolution_notes = ?, updated_at = ? WHERE id = ?').run(
      nextStatus,
      req.authUser!.id,
      notes || `Action taken: ${action}`,
      ts,
      report.id
    );
    logAudit(db, req.authUser!.id, `moderation.${action}`, 'report', String(report.id), { notes, targetType: report.target_type }, req.ip || '');
    res.json({ ok: true, status: nextStatus });
  });

  // ---------------------------------------------------------------------------
  // ADMIN DASHBOARD (BACKEND-ENFORCED RBAC)
  // ---------------------------------------------------------------------------
  router.get('/admin/overview', requireRole(['platform_admin', 'super_admin']), (_req, res) => {
    const totalMembers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    const activeMembers = (db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'active'").get() as { c: number }).c;
    const totalGroups = (db.prepare('SELECT COUNT(*) as c FROM groups WHERE is_archived = 0').get() as { c: number }).c;
    const totalPosts = (db.prepare('SELECT COUNT(*) as c FROM posts WHERE is_hidden = 0').get() as { c: number }).c;
    const totalComments = (db.prepare('SELECT COUNT(*) as c FROM comments WHERE is_hidden = 0').get() as { c: number }).c;
    const totalMessagesCount = (db.prepare('SELECT COUNT(*) as c FROM messages WHERE is_deleted = 0').get() as { c: number }).c;
    const pendingReports = (db.prepare("SELECT COUNT(*) as c FROM reports WHERE status IN ('open', 'in_review', 'escalated')").get() as { c: number }).c;
    const pendingVerifications = (db.prepare("SELECT COUNT(*) as c FROM mentor_applications WHERE status = 'pending'").get() as { c: number }).c;
    const openSupport = (db.prepare("SELECT COUNT(*) as c FROM support_tickets WHERE status != 'resolved'").get() as { c: number }).c;
    const countryDistribution = db
      .prepare(
        `SELECT COALESCE(NULLIF(primary_destination_country, ''), 'undecided') as country, COUNT(*) as count
         FROM user_profiles_extended GROUP BY country ORDER BY count DESC LIMIT 10`
      )
      .all();

    const settings = db.prepare('SELECT key, value_json FROM platform_settings').all();

    res.json({
      metrics: {
        totalMembers,
        activeMembers,
        totalGroups,
        totalPosts,
        totalComments,
        totalMessagesCount,
        pendingReports,
        pendingVerifications,
        openSupport,
      },
      countryDistribution,
      settings,
    });
  });

  router.get('/admin/users', requireRole(['platform_admin', 'super_admin']), (_req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.display_name, u.username, u.current_country, u.city, u.status,
                u.verification_level, u.verification_badge_label, u.is_demo_data, u.created_at
         FROM users u ORDER BY u.created_at DESC LIMIT 100`
      )
      .all() as Array<Record<string, unknown>>;
    const enriched = users.map((u) => {
      const roles = (db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(u.id) as Array<{ role: string }>).map((r) => r.role);
      return { ...u, roles };
    });
    res.json({ users: enriched });
  });

  router.patch('/admin/users/:id/status', requireRole(['platform_admin', 'super_admin']), (req, res) => {
    const nextStatus = String(req.body?.status || '');
    if (!['active', 'restricted', 'suspended', 'banned'].includes(nextStatus)) {
      res.status(400).json({ error: 'Invalid status.' });
      return;
    }
    db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, nowIso(), req.params.id);
    logAudit(db, req.authUser!.id, 'admin.user_status_changed', 'user', req.params.id, { status: nextStatus }, req.ip || '');
    res.json({ ok: true });
  });

  router.post('/admin/users/:id/roles', requireRole(['super_admin', 'platform_admin']), (req, res) => {
    const role = String(req.body?.role || '');
    const action = req.body?.action === 'remove' ? 'remove' : 'add';
    if (!VALID_ROLES.has(role)) {
      res.status(400).json({ error: 'Invalid role.' });
      return;
    }
    if (role === 'super_admin' && !req.authUser!.roles.includes('super_admin')) {
      res.status(403).json({ error: 'Only Super Admin can assign Super Admin role.' });
      return;
    }
    if (action === 'add') {
      db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role, assigned_by, created_at) VALUES (?, ?, ?, ?)').run(
        req.params.id,
        role,
        req.authUser!.id,
        nowIso()
      );
    } else {
      db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role = ?').run(req.params.id, role);
    }
    logAudit(db, req.authUser!.id, `admin.role_${action}`, 'user', req.params.id, { role }, req.ip || '');
    res.json({ ok: true });
  });

  router.post('/admin/groups', requireRole(['platform_admin', 'super_admin']), (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const category = String(req.body?.category || 'Country + Purpose').trim();
    const countrySlug = req.body?.country_slug ? String(req.body.country_slug).trim().toLowerCase() : null;
    const purpose = String(req.body?.purpose || 'Study').trim();
    const privacy = ['public', 'private', 'invite_only'].includes(req.body?.privacy) ? req.body.privacy : 'public';
    const description = String(req.body?.description || '').trim().slice(0, 600);
    if (!name || !description) {
      res.status(400).json({ error: 'Group name and description are required.' });
      return;
    }
    const gid = uuid();
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.floor(100 + Math.random() * 900)}`;
    const ts = nowIso();
    db.prepare(
      `INSERT INTO groups (id, slug, name, category, country_slug, purpose, privacy, description, rules_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(gid, slug, name, category, countrySlug, purpose, privacy, description, JSON.stringify(['Follow community safety and anti-scam rules.']), req.authUser!.id, ts);
    db.prepare('INSERT INTO group_memberships (group_id, user_id, role, is_muted, joined_at) VALUES (?, ?, ?, 0, ?)').run(gid, req.authUser!.id, 'moderator', ts);
    const convId = uuid();
    db.prepare('INSERT INTO conversations (id, type, group_id, status, initiated_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(convId, 'group', gid, 'active', req.authUser!.id, ts);
    db.prepare('INSERT INTO conversation_participants (conversation_id, user_id, last_read_at, is_muted) VALUES (?, ?, ?, 0)').run(convId, req.authUser!.id, ts);

    logAudit(db, req.authUser!.id, 'admin.group_created', 'group', gid, { name, privacy }, req.ip || '');
    res.status(201).json({ id: gid, slug });
  });

  router.post('/admin/countries', requireRole(['platform_admin', 'super_admin']), (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const region = String(req.body?.region || 'Europe').trim().slice(0, 40);
    const flagCode = String(req.body?.flag_code || 'GL').trim().toUpperCase().slice(0, 3);
    const overview = String(req.body?.overview || '').trim().slice(0, 1000);
    if (!name || !overview) {
      res.status(400).json({ error: 'Country name and overview are required.' });
      return;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const id = uuid();
    db.prepare(
      `INSERT INTO countries (
        id, slug, name, region, flag_code, overview, education_pathways, job_pathways,
        apprenticeship_pathways, scholarship_summary, language_requirements, visa_disclaimer_info,
        living_cost_estimate, popular_cities_json, official_links_json, last_updated, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, 1)`
    ).run(
      id,
      slug,
      name,
      region,
      flagCode,
      overview,
      String(req.body?.education_pathways || 'Verify university portals directly.'),
      String(req.body?.job_pathways || 'Check official immigration work permit criteria.'),
      String(req.body?.apprenticeship_pathways || 'Check recognized national vocational pathways.'),
      String(req.body?.scholarship_summary || 'Verify official government & university funding portals.'),
      String(req.body?.language_requirements || 'Depends on program and employer.'),
      'Always verify official visa rules on government mission portals. Community notes are not legal guarantees.',
      String(req.body?.living_cost_estimate || 'Living costs vary by city and housing arrangement.'),
      nowIso().slice(0, 10)
    );
    logAudit(db, req.authUser!.id, 'admin.country_created', 'country', id, { name, slug }, req.ip || '');
    res.status(201).json({ id, slug });
  });

  router.get('/admin/mentor-applications', requireRole(['platform_admin', 'super_admin']), (_req, res) => {
    const apps = db
      .prepare(
        `SELECT ma.*, u.display_name, u.username
         FROM mentor_applications ma JOIN users u ON u.id = ma.user_id
         ORDER BY CASE ma.status WHEN 'pending' THEN 0 ELSE 1 END, ma.created_at DESC`
      )
      .all();
    res.json({ applications: apps });
  });

  router.post('/admin/mentor-applications/:id/review', requireRole(['platform_admin', 'super_admin']), (req, res) => {
    const decision = req.body?.decision === 'approved' ? 'approved' : 'rejected';
    const notes = String(req.body?.reviewer_notes || '').trim().slice(0, 400);
    const appRow = db.prepare('SELECT * FROM mentor_applications WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!appRow) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }
    const ts = nowIso();
    db.prepare('UPDATE mentor_applications SET status = ?, reviewer_notes = ?, reviewed_by = ? WHERE id = ?').run(
      decision,
      notes,
      req.authUser!.id,
      appRow.id
    );
    if (decision === 'approved') {
      db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role, assigned_by, created_at) VALUES (?, ?, ?, ?)').run(
        appRow.user_id,
        'verified_mentor',
        req.authUser!.id,
        ts
      );
      db.prepare("UPDATE users SET verification_level = 'mentor_reviewed', verification_badge_label = 'Mentor Evidence Reviewed', updated_at = ? WHERE id = ?").run(
        ts,
        appRow.user_id
      );
      db.prepare(
        `INSERT OR REPLACE INTO mentors (
          id, user_id, mentor_type, current_country, current_city, institution_or_employer,
          expertise_json, languages_json, years_experience, bio, topics_json, availability_slots_json,
          verification_status, verification_reviewed_at, is_suspended, created_at
        ) VALUES (
          COALESCE((SELECT id FROM mentors WHERE user_id = ?), ?),
          ?, ?, ?, ?, ?, ?, ?, ?, ?, '["Guidance Q&A"]', '["Weekends IST"]', 'approved', ?, 0, ?
        )`
      ).run(
        appRow.user_id,
        uuid(),
        appRow.user_id,
        appRow.mentor_type,
        appRow.current_country,
        appRow.current_city,
        appRow.institution_or_employer,
        appRow.expertise_json,
        appRow.languages_json,
        appRow.years_experience,
        appRow.evidence_summary,
        ts,
        ts
      );
      createNotification(db, String(appRow.user_id), 'mentor_approved', 'Mentor application approved', 'Your mentor verification evidence has been reviewed and approved.', 'mentors');
    }
    logAudit(db, req.authUser!.id, `admin.mentor_${decision}`, 'mentor_application', String(appRow.id), { userId: appRow.user_id }, req.ip || '');
    res.json({ ok: true, status: decision });
  });

  router.get('/admin/support', requireRole(['support_agent', 'platform_admin', 'super_admin']), (_req, res) => {
    const tickets = db.prepare('SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 100').all();
    res.json({ tickets });
  });

  router.get('/admin/audit-logs', requireRole(['platform_admin', 'super_admin']), (_req, res) => {
    const logs = db
      .prepare(
        `SELECT a.*, u.display_name as actor_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
         ORDER BY a.created_at DESC LIMIT 100`
      )
      .all();
    res.json({ logs });
  });

  // ---------------------------------------------------------------------------
  // GLOBAL SEARCH (PRIVATE GROUP CONTENT STRICTLY EXCLUDED)
  // ---------------------------------------------------------------------------
  router.get('/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q || q.length < 2) {
      res.json({ countries: [], groups: [], universities: [], jobs: [], scholarships: [], mentors: [], resources: [], posts: [] });
      return;
    }
    const like = `%${q}%`;
    const countries = db.prepare('SELECT slug, name, region, flag_code FROM countries WHERE is_active = 1 AND name LIKE ? LIMIT 6').all(like);
    const groups = db.prepare("SELECT id, slug, name, category, privacy FROM groups WHERE is_archived = 0 AND (name LIKE ? OR description LIKE ?) LIMIT 8").all(like, like);
    const universities = db.prepare('SELECT id, name, city, country_slug FROM universities WHERE name LIKE ? OR city LIKE ? OR programs_json LIKE ? LIMIT 6').all(like, like, like);
    const jobs = db.prepare('SELECT id, title, employer, country_slug FROM jobs WHERE title LIKE ? OR employer LIKE ? OR skills_json LIKE ? LIMIT 6').all(like, like, like);
    const scholarships = db.prepare('SELECT id, title, provider, country_slug, funding_type FROM scholarships WHERE title LIKE ? OR provider LIKE ? LIMIT 6').all(like, like);
    const mentors = db
      .prepare(
        `SELECT m.id, u.display_name, m.mentor_type, m.current_country, m.expertise_json
         FROM mentors m JOIN users u ON u.id = m.user_id
         WHERE m.verification_status = 'approved' AND m.is_suspended = 0 AND (u.display_name LIKE ? OR m.expertise_json LIKE ? OR m.current_country LIKE ?) LIMIT 6`
      )
      .all(like, like, like);
    const resources = db.prepare('SELECT id, title, category, country_slug, source_type FROM resources WHERE title LIKE ? OR summary LIKE ? LIMIT 6').all(like, like);
    // CRITICAL: Private group posts must NEVER appear in global search!
    const posts = db
      .prepare(
        `SELECT p.id, p.title, p.group_id, g.name as group_name, g.slug as group_slug
         FROM posts p JOIN groups g ON g.id = p.group_id
         WHERE g.privacy = 'public' AND p.is_hidden = 0 AND (p.title LIKE ? OR p.body LIKE ?) LIMIT 6`
      )
      .all(like, like);

    res.json({ countries, groups, universities, jobs, scholarships, mentors, resources, posts });
  });

  // ---------------------------------------------------------------------------
  // FIREBASE AUTH SYNC & CLOUD SQL (POSTGRESQL / DRIZZLE) ROUTES
  // ---------------------------------------------------------------------------
  router.post('/auth/firebase-sync', requireFirebaseAuth, async (req: FirebaseAuthRequest, res) => {
    const fb = req.firebaseUser;
    if (!fb || !fb.uid || !fb.email) {
      res.status(400).json({ error: 'Verified Firebase account email is required.' });
      return;
    }

    const email = fb.email.toLowerCase();
    const displayName = (fb.name || email.split('@')[0] || 'Member').slice(0, 80);

    try {
      await getOrCreateUser(fb.uid, email, displayName);
    } catch (err) {
      console.error('Cloud SQL sync warning during login:', err);
    }

    const ts = nowIso();
    let userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Record<string, unknown> | undefined;
    let isNewUser = false;

    if (!userRow) {
      isNewUser = true;
      const uid = uuid();
      const baseHandle = displayName.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 18) || 'member';
      const username = `${baseHandle}_${Math.floor(1000 + Math.random() * 9000)}`;
      db.prepare(
        `INSERT INTO users (
          id, email, display_name, username, current_country, preferred_language, status,
          email_verified, verification_level, verification_badge_label, is_demo_data, onboarding_completed, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'India', 'en', 'active', 1, 'email', 'Google Verified Member', 0, 1, ?, ?)`
      ).run(uid, email, displayName, username, ts, ts);
      db.prepare('INSERT INTO user_roles (user_id, role, created_at) VALUES (?, ?, ?)').run(uid, 'registered_member', ts);
      db.prepare(
        `INSERT INTO user_profiles_extended (user_id, primary_destination_country, purpose, intended_intake, consent_tos_at, consent_privacy_at, profile_completion_pct)
         VALUES (?, 'germany', 'Study', 'Winter 2027', ?, ?, 45)`
      ).run(uid, ts, ts);
      db.prepare(
        `INSERT INTO journeys (id, user_id, destination_country, purpose, target_intake, current_stage, updated_at)
         VALUES (?, ?, 'Germany', 'Study', 'Winter 2027', 'Explore', ?)`
      ).run(uuid(), uid, ts);
      userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as Record<string, unknown>;
    } else if (userRow.status === 'banned' || userRow.status === 'suspended') {
      res.status(403).json({ error: 'This account is currently restricted. Contact Support.' });
      return;
    }

    const token = generateSessionToken();
    const sessionId = uuid();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, userRow.id, hashToken(token), String(req.headers['user-agent'] || '').slice(0, 200), req.ip || '', expiresAt, ts);

    setSessionCookie(res, token, req);
    logAudit(db, String(userRow.id), 'auth.firebase_google_login', 'user', String(userRow.id), { isNewUser }, req.ip || '');

    const roles = (db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(userRow.id) as Array<{ role: string }>).map((r) => r.role);
    const profile = db.prepare('SELECT * FROM user_profiles_extended WHERE user_id = ?').get(userRow.id);

    res.json({
      token,
      isNewUser,
      user: { ...userRow, password_hash: undefined, roles, profile },
    });
  });

  router.get('/sql/me', requireFirebaseAuth, async (req: FirebaseAuthRequest, res) => {
    try {
      const fb = req.firebaseUser!;
      const sqlUser = await getOrCreateUser(fb.uid, fb.email || '', fb.name || '');
      res.json({ user: sqlUser });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to fetch user record.' });
    }
  });

  router.get('/sql/applications', requireFirebaseAuth, async (req: FirebaseAuthRequest, res) => {
    try {
      const fb = req.firebaseUser!;
      await getOrCreateUser(fb.uid, fb.email || '', fb.name || '');
      const applications = await getUserApplications(fb.uid);
      res.json({ applications });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load applications.' });
    }
  });

  const sqlAppSchema = z.object({
    institutionName: z.string().trim().min(2).max(160),
    countrySlug: z.string().trim().min(2).max(64).regex(/^[a-z0-9-]+$/),
    programTitle: z.string().trim().min(2).max(160),
    intake: z.string().trim().min(2).max(60).default('Winter 2027'),
    status: z.enum(['researching', 'preparing', 'submitted', 'offer_received', 'visa_stage']).default('researching'),
    deadlineDate: z.string().trim().max(40).default(''),
    notes: z.string().trim().max(800).default(''),
  });

  router.post('/sql/applications', requireFirebaseAuth, async (req: FirebaseAuthRequest, res) => {
    const parsed = sqlAppSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid institution, country slug, and program title are required.' });
      return;
    }
    try {
      const fb = req.firebaseUser!;
      const application = await createUserApplication(fb.uid, fb.email || '', fb.name || '', parsed.data);
      res.status(201).json({ application });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to save application.' });
    }
  });

  const sqlAppUpdateSchema = z.object({
    status: z.enum(['researching', 'preparing', 'submitted', 'offer_received', 'visa_stage']),
  });

  router.patch('/sql/applications/:id', requireFirebaseAuth, async (req: FirebaseAuthRequest, res) => {
    const appId = Number(req.params.id);
    const parsed = sqlAppUpdateSchema.safeParse(req.body);
    if (!Number.isInteger(appId) || appId <= 0 || !parsed.success) {
      res.status(400).json({ error: 'Invalid application update payload.' });
      return;
    }
    try {
      const updated = await updateUserApplicationStatus(req.firebaseUser!.uid, appId, parsed.data.status);
      if (!updated) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      res.json({ application: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update application.' });
    }
  });

  router.delete('/sql/applications/:id', requireFirebaseAuth, async (req: FirebaseAuthRequest, res) => {
    const appId = Number(req.params.id);
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'Invalid application identifier.' });
      return;
    }
    try {
      const removed = await deleteUserApplication(req.firebaseUser!.uid, appId);
      if (!removed) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to delete application.' });
    }
  });

  router.get('/sql/notes', requireFirebaseAuth, async (req: FirebaseAuthRequest, res) => {
    try {
      const fb = req.firebaseUser!;
      await getOrCreateUser(fb.uid, fb.email || '', fb.name || '');
      const notes = await getUserStudyNotes(fb.uid);
      res.json({ notes });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load notes.' });
    }
  });

  const sqlNoteSchema = z.object({
    title: z.string().trim().min(2).max(140),
    category: z.enum(['general', 'visa', 'language', 'scholarship', 'housing']).default('general'),
    content: z.string().trim().min(2).max(2000),
    countrySlug: z.string().trim().min(2).max(64).regex(/^[a-z0-9-]+$/).default('germany'),
  });

  router.post('/sql/notes', requireFirebaseAuth, async (req: FirebaseAuthRequest, res) => {
    const parsed = sqlNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid note title and content are required.' });
      return;
    }
    try {
      const fb = req.firebaseUser!;
      const note = await createUserStudyNote(fb.uid, fb.email || '', fb.name || '', parsed.data);
      res.status(201).json({ note });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to save study note.' });
    }
  });

  router.delete('/sql/notes/:id', requireFirebaseAuth, async (req: FirebaseAuthRequest, res) => {
    const noteId = Number(req.params.id);
    if (!Number.isInteger(noteId) || noteId <= 0) {
      res.status(400).json({ error: 'Invalid note identifier.' });
      return;
    }
    try {
      const removed = await deleteUserStudyNote(req.firebaseUser!.uid, noteId);
      if (!removed) {
        res.status(404).json({ error: 'Note not found.' });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to delete note.' });
    }
  });

  // ---------------------------------------------------------------------------
  // GEMINI AI MULTI-TURN ADVISOR & AUDIO TRANSCRIPTION
  // ---------------------------------------------------------------------------
  const aiChatSchema = z.object({
    preset: z.enum(['visa', 'strategy', 'guide', 'checklist']).default('guide'),
    targetCountry: z.string().trim().max(80).optional(),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'model']),
          text: z.string().max(8000),
        })
      )
      .max(24)
      .default([]),
    message: z.string().trim().min(1).max(4000),
  });

  router.post('/ai/chat', requireActiveWriter, rateLimitMiddleware('ai_chat', 25, 60_000), async (req, res) => {
    const parsed = aiChatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please enter a valid prompt message.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const { model } = await streamAdvisorChat({
        preset: parsed.data.preset as AdvisorPreset,
        targetCountry: parsed.data.targetCountry,
        history: parsed.data.history,
        message: parsed.data.message,
        onChunk: (chunkText) => {
          res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
        },
      });
      res.write(`data: ${JSON.stringify({ done: true, model })}\n\n`);
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI service error.';
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    }
  });

  const aiTranscribeSchema = z.object({
    audioBase64: z.string().min(16).max(14_000_000),
    mimeType: z
      .string()
      .trim()
      .regex(/^audio\/[a-z0-9.+-]+(;.*)?$/i),
  });

  router.post('/ai/transcribe', requireActiveWriter, rateLimitMiddleware('ai_transcribe', 15, 60_000), async (req, res) => {
    const parsed = aiTranscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid audio recording payload is required.' });
      return;
    }

    try {
      const normalizedMime = parsed.data.mimeType.split(';')[0].trim().toLowerCase();
      const transcript = await transcribeUserAudio({
        audioBase64: parsed.data.audioBase64,
        mimeType: normalizedMime,
      });
      res.json({ transcript });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Audio transcription failed.' });
    }
  });

  return router;
}
