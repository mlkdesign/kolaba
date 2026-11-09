// Admin panel API (/v1/admin/*). A separate auth system: admins + admin_sessions (never users / sessions), short
// sessions (8 h absolute, 60 min idle), bearer token kept only in the admin tab's memory. Every change is written to
// admin_logs. All SQL is parameterised; every body is validated with zod; request bodies are capped at 16 KB.
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AdminSession, AppEnv, Env } from '../env';
import { clientIP, rateLimit } from '../lib/auth';
import { avatarJoin, card, cardColumns, type CardRow, mediaColumns, mediaJSON, type MediaRow } from '../lib/cards';
import { hashPassword, verifyPassword } from '../lib/password';
import { fail, newId, newToken, now, sha256Hex, timingSafeEqual } from '../lib/util';
import { jobsJSON } from './jobs';

const SESSION_MS = 8 * 3_600_000;
const IDLE_MS = 60 * 60_000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const MIN_PASSWORD = 12;

const admin = new Hono<AppEnv>();

admin.use('*', bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: { code: 'payload_too_large' } }, 413) }));

// ─── helpers ───

const allowedAdmins = (env: Env) => (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

function bearer(c: Context): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(c.req.header('Authorization') ?? '');
  return match ? match[1] : null;
}

const current = (c: Context<AppEnv>): AdminSession => c.get('admin') ?? fail(401, 'admin_auth_required');

async function log(env: Env, entry: { admin?: AdminSession | null; email?: string | null; action: string; entityType?: string | null;
  entityId?: string | null; result?: 'success' | 'failure'; reason?: string | null; detail?: Record<string, unknown>; ip?: string }) {
  await env.DB.prepare(`INSERT INTO admin_logs (admin_id, admin_email, action, entity_type, entity_id, result, reason, detail, ip, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(entry.admin?.id ?? null, entry.admin?.email ?? entry.email ?? null, entry.action, entry.entityType ?? null, entry.entityId ?? null,
          entry.result ?? 'success', entry.reason ?? null, entry.detail ? JSON.stringify(entry.detail) : null, entry.ip ?? null, now())
    .run();
}

const audit = (c: Context<AppEnv>, action: string, entityType: string, entityId: string, reason?: string | null,
               detail?: Record<string, unknown>) =>
  log(c.env, { admin: current(c), action, entityType, entityId, reason: reason ?? null, detail, ip: clientIP(c) });

function page(c: Context, fallback = 20) {
  const limit = Math.min(Math.max(Math.trunc(Number(c.req.query('limit') ?? fallback)) || fallback, 1), 100);
  const pageNo = Math.max(Math.trunc(Number(c.req.query('page') ?? 1)) || 1, 1);
  return { limit, offset: (pageNo - 1) * limit, page: pageNo };
}

const q = (c: Context) => (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 80);
const like = (text: string) => `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
const appLink = (env: Env, kind: 'profile' | 'job', id: string) => `${env.APP_URL.replace(/\/?$/, '/')}#/${kind}/${encodeURIComponent(id)}`;

const Reason = z.string().trim().min(3).max(500);

// ─── auth middleware ───

const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c) ?? fail(401, 'admin_auth_required');
  const id = await sha256Hex(token!);
  const row = await c.env.DB.prepare(`SELECT s.id, s.expires_at, s.last_seen_at, a.id AS admin_id, a.email, a.must_change_password
      FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.id = ?`).bind(id)
    .first<{ id: string; expires_at: number; last_seen_at: number; admin_id: string; email: string; must_change_password: number }>();
  const t = now();
  if (!row || row.expires_at < t || row.last_seen_at + IDLE_MS < t || !allowedAdmins(c.env).includes(row.email.toLowerCase())) {
    if (row) await c.env.DB.prepare(`DELETE FROM admin_sessions WHERE id = ?`).bind(row.id).run();
    fail(401, 'session_expired');
  }
  c.set('admin', { id: row!.admin_id, email: row!.email, sessionId: row!.id, mustChangePassword: row!.must_change_password === 1 });
  if (t - row!.last_seen_at > 60_000) {
    c.executionCtx.waitUntil(c.env.DB.prepare(`UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?`).bind(t, row!.id).run());
  }
  // The initial password must be replaced before anything else is allowed.
  const path = c.req.path.replace(/^\/v1\/admin/, '');
  if (row!.must_change_password === 1 && !['/me', '/password', '/logout'].includes(path)) fail(403, 'password_change_required');
  await next();
};

// ─── login / session ───

admin.post('/login', async (c) => {
  const ip = clientIP(c);
  await rateLimit(c, 'RL_AUTH', `admin-login:${ip}`);
  const { email, password } = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) })
    .parse(await c.req.json());
  await rateLimit(c, 'RL_AUTH', `admin-login:${email}`);

  const allowed = allowedAdmins(c.env).includes(email);
  type AdminRow = { id: string; email: string; password_hash: string; password_salt: string; password_scheme: string;
                    must_change_password: number; failed_logins: number; locked_until: number | null };
  let row = allowed ? await c.env.DB.prepare(`SELECT * FROM admins WHERE email = ?`).bind(email).first<AdminRow>() : null;

  // First sign-in: the administrator row is created from the ADMIN_INITIAL_PASSWORD secret (Cloudflare Secrets).
  // Once the row exists the secret is never read again.
  if (allowed && !row && c.env.ADMIN_INITIAL_PASSWORD) {
    const matches = timingSafeEqual(await sha256Hex(password), await sha256Hex(c.env.ADMIN_INITIAL_PASSWORD));
    if (matches) {
      const { hash, salt, scheme } = await hashPassword(password);
      await c.env.DB.prepare(`INSERT OR IGNORE INTO admins (id, email, password_hash, password_salt, password_scheme, must_change_password,
          created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).bind(newId('adm'), email, hash, salt, scheme, now(), now()).run();
      row = await c.env.DB.prepare(`SELECT * FROM admins WHERE email = ?`).bind(email).first<AdminRow>();
      await log(c.env, { email, action: 'admin.bootstrap', entityType: 'admin', entityId: row?.id ?? null, ip });
    }
  }

  if (row?.locked_until && row.locked_until > now()) {
    await log(c.env, { email, action: 'login', result: 'failure', reason: 'locked', ip });
    fail(429, 'account_locked');
  }
  const ok = row ? await verifyPassword(password, row.password_hash, row.password_salt, row.password_scheme)
                 : (await hashPassword(password), false); // same work either way
  if (!ok || !row) {
    if (row) {
      const failed = row.failed_logins + 1;
      await c.env.DB.prepare(`UPDATE admins SET failed_logins = ?, locked_until = ? WHERE id = ?`)
        .bind(failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? now() + LOCK_MS : null, row.id).run();
    }
    await log(c.env, { email: email.slice(0, 254), action: 'login', result: 'failure', reason: 'invalid_credentials', ip });
    fail(401, 'invalid_credentials');
  }
  const token = newToken();
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE admins SET failed_logins = 0, locked_until = NULL WHERE id = ?`).bind(row!.id),
    c.env.DB.prepare(`DELETE FROM admin_sessions WHERE admin_id = ? AND (expires_at < ? OR last_seen_at < ?)`).bind(row!.id, t, t - IDLE_MS),
    c.env.DB.prepare(`INSERT INTO admin_sessions (id, admin_id, created_at, expires_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(await sha256Hex(token), row!.id, t, t + SESSION_MS, t, (c.req.header('User-Agent') ?? '').slice(0, 200), ip),
  ]);
  await log(c.env, { admin: { id: row!.id, email: row!.email, sessionId: '', mustChangePassword: false }, action: 'login', ip });
  return c.json({ token, expiresAt: t + SESSION_MS, admin: { email: row!.email, mustChangePassword: row!.must_change_password === 1 } });
});

admin.use('*', requireAdmin);

admin.get('/me', (c) => {
  const a = current(c);
  return c.json({ admin: { email: a.email, mustChangePassword: a.mustChangePassword } });
});

admin.post('/logout', async (c) => {
  const a = current(c);
  await c.env.DB.prepare(`DELETE FROM admin_sessions WHERE id = ?`).bind(a.sessionId).run();
  await audit(c, 'logout', 'admin', a.id);
  return c.json({ status: 'signed_out' });
});

admin.post('/password', async (c) => {
  const a = current(c);
  const body = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }).parse(await c.req.json());
  if (body.newPassword.length < MIN_PASSWORD) fail(422, 'password_too_short');
  if (body.newPassword === body.currentPassword) fail(422, 'password_unchanged');
  const row = await c.env.DB.prepare(`SELECT password_hash, password_salt, password_scheme FROM admins WHERE id = ?`).bind(a.id)
    .first<{ password_hash: string; password_salt: string; password_scheme: string }>();
  if (!row || !(await verifyPassword(body.currentPassword, row.password_hash, row.password_salt, row.password_scheme))) {
    await log(c.env, { admin: a, action: 'password.change', entityType: 'admin', entityId: a.id, result: 'failure', reason: 'wrong current password', ip: clientIP(c) });
    fail(403, 'invalid_credentials');
  }
  const { hash, salt, scheme } = await hashPassword(body.newPassword);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE admins SET password_hash = ?, password_salt = ?, password_scheme = ?, must_change_password = 0,
        password_changed_at = ?, updated_at = ? WHERE id = ?`).bind(hash, salt, scheme, now(), now(), a.id),
    c.env.DB.prepare(`DELETE FROM admin_sessions WHERE admin_id = ? AND id <> ?`).bind(a.id, a.sessionId), // other sessions out
  ]);
  await audit(c, 'password.change', 'admin', a.id);
  return c.json({ status: 'password_changed' });
});

// ─── dashboard ───

const PRO_SQL = `EXISTS (SELECT 1 FROM subscriptions s WHERE s.profile_id = p.id AND s.status = 'active'
                 AND (s.expires_at IS NULL OR s.expires_at > ?))`;

admin.get('/dashboard', async (c) => {
  const t = now();
  const stats = await c.env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM users WHERE status <> 'deleted') AS total_users,
      (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS blocked_users,
      (SELECT COUNT(*) FROM profiles WHERE type = 'creator' AND status <> 'deleted') AS creator_profiles,
      (SELECT COUNT(*) FROM profiles WHERE type = 'business' AND status <> 'deleted') AS business_profiles,
      (SELECT COUNT(*) FROM jobs WHERE published_at IS NOT NULL AND moderation_status IS NULL) AS total_jobs,
      (SELECT COUNT(*) FROM jobs WHERE status = 'published' AND (deadline IS NULL OR deadline > ?1)) AS active_jobs,
      (SELECT COUNT(*) FROM jobs WHERE moderation_status = 'hidden') AS hidden_jobs,
      (SELECT COUNT(DISTINCT p.owner_user_id) FROM profiles p JOIN users u ON u.id = p.owner_user_id AND u.status <> 'deleted'
         WHERE p.status <> 'deleted' AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.profile_id = p.id AND s.status = 'active'
         AND (s.expires_at IS NULL OR s.expires_at > ?1))) AS pro_accounts`).bind(t).first<Record<string, number>>();
  const recent = await c.env.DB.prepare(`SELECT * FROM (
        SELECT 'user.registered' AS type, u.id AS entity_id, u.email AS title,
               (SELECT p.display_name FROM profiles p WHERE p.owner_user_id = u.id ORDER BY p.created_at LIMIT 1) AS subtitle,
               u.created_at AS at FROM users u ORDER BY u.created_at DESC LIMIT 8)
      UNION ALL SELECT * FROM (
        SELECT 'job.published' AS type, j.id, j.title, p.display_name, j.published_at FROM jobs j
          JOIN profiles p ON p.id = j.owner_profile_id WHERE j.published_at IS NOT NULL ORDER BY j.published_at DESC LIMIT 8)
      ORDER BY at DESC LIMIT 12`).all<{ type: string; entity_id: string; title: string; subtitle: string | null; at: number }>();
  return c.json({
    stats: {
      totalUsers: stats!.total_users, blockedUsers: stats!.blocked_users, creatorProfiles: stats!.creator_profiles,
      businessProfiles: stats!.business_profiles, totalJobs: stats!.total_jobs, activeJobs: stats!.active_jobs,
      hiddenJobs: stats!.hidden_jobs, proAccounts: stats!.pro_accounts,
    },
    recent: recent.results.map((r) => ({ type: r.type, id: r.entity_id, title: r.title, subtitle: r.subtitle, at: r.at })),
  });
});

// ─── users ───

const userStatus = (s: string) => (s === 'suspended' ? 'blocked' : s);

type ProfileRow = CardRow & { owner_user_id: string; created_at: number; bio: string; website: string | null; visibility: string };

async function profilesFor(env: Env, userIds: string[]) {
  if (!userIds.length) return new Map<string, ReturnType<typeof profileJSON>[]>();
  const rows = await env.DB.prepare(`SELECT ${cardColumns}, p.owner_user_id, p.created_at, p.bio, p.website, p.visibility
      FROM profiles p ${avatarJoin} WHERE p.owner_user_id IN (${userIds.map(() => '?').join(',')}) AND p.status <> 'deleted'
      ORDER BY p.type = 'business', p.created_at`).bind(...userIds).all<ProfileRow>();
  const byUser = new Map<string, ReturnType<typeof profileJSON>[]>();
  for (const r of rows.results) byUser.set(r.owner_user_id, [...(byUser.get(r.owner_user_id) ?? []), profileJSON(env, r)]);
  return byUser;
}

function profileJSON(env: Env, r: ProfileRow) {
  return { ...card(env, r), status: r.status, bio: r.bio, website: r.website, visibility: r.visibility, createdAt: r.created_at,
           publicUrl: r.status === 'active' ? appLink(env, 'profile', r.id) : null };
}

function accountType(profiles: { type: string }[]) {
  const c = profiles.some((p) => p.type === 'creator');
  const b = profiles.some((p) => p.type === 'business');
  return c && b ? 'both' : c ? 'creator' : b ? 'business' : 'none';
}

admin.get('/users', async (c) => {
  const { limit, offset, page: pageNo } = page(c);
  const t = now();
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  const text = q(c);
  if (text) {
    where.push(`(lower(u.email) LIKE ? ESCAPE '\\' OR u.id = ? OR EXISTS (SELECT 1 FROM profiles p WHERE p.owner_user_id = u.id
      AND (lower(p.display_name) LIKE ? ESCAPE '\\' OR lower(p.username) LIKE ? ESCAPE '\\' OR p.id = ?)))`);
    params.push(like(text), text, like(text), like(text.replace(/^@/, '')), text);
  }
  const hasType = (type: string) => `EXISTS (SELECT 1 FROM profiles p WHERE p.owner_user_id = u.id AND p.type = '${type}' AND p.status <> 'deleted')`;
  const type = c.req.query('type');
  if (type === 'creator') where.push(`${hasType('creator')} AND NOT ${hasType('business')}`);
  else if (type === 'business') where.push(`${hasType('business')} AND NOT ${hasType('creator')}`);
  else if (type === 'both') where.push(`${hasType('creator')} AND ${hasType('business')}`);
  const plan = c.req.query('plan');
  const proExists = `EXISTS (SELECT 1 FROM profiles p WHERE p.owner_user_id = u.id AND p.status <> 'deleted' AND ${PRO_SQL})`;
  if (plan === 'pro') { where.push(proExists); params.push(t); }
  else if (plan === 'free') { where.push(`NOT ${proExists}`); params.push(t); }
  const status = c.req.query('status');
  if (status === 'active') where.push(`u.status = 'active'`);
  else if (status === 'blocked') where.push(`u.status = 'suspended'`);
  else if (status === 'deleted') where.push(`u.status = 'deleted'`);
  const order = c.req.query('sort') === 'oldest' ? 'u.created_at ASC, u.id ASC' : 'u.created_at DESC, u.id DESC';

  const [total, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${where.join(' AND ')}`).bind(...params).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT u.id, u.email, u.status, u.is_demo, u.created_at, u.blocked_reason FROM users u
        WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...params, limit, offset)
      .all<{ id: string; email: string; status: string; is_demo: number; created_at: number; blocked_reason: string | null }>(),
  ]);
  const profiles = await profilesFor(c.env, rows.results.map((r) => r.id));
  return c.json({
    total: total?.n ?? 0, page: pageNo, limit,
    items: rows.results.map((u) => {
      const ps = profiles.get(u.id) ?? [];
      return { id: u.id, email: u.email, status: userStatus(u.status), isDemo: u.is_demo === 1, createdAt: u.created_at,
               blockedReason: u.blocked_reason, accountType: accountType(ps), isPro: ps.some((p) => p.isPro), profiles: ps };
    }),
  });
});

admin.get('/users/:id', async (c) => {
  const id = c.req.param('id');
  const u = await c.env.DB.prepare(`SELECT id, email, status, is_demo, created_at, updated_at, email_verified_at, email_verification,
      blocked_reason, blocked_at, deleted_at, deleted_reason FROM users WHERE id = ?`).bind(id).first<Record<string, any>>();
  if (!u) fail(404, 'user_not_found');
  const ps = (await profilesFor(c.env, [id])).get(id) ?? [];
  const ids = ps.map((p) => p.id);
  const marks = ids.map(() => '?').join(',') || "''";
  const [counts, subs, logs] = await Promise.all([
    c.env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM jobs WHERE owner_profile_id IN (${marks}) AND published_at IS NOT NULL) AS jobs,
        (SELECT COUNT(*) FROM media WHERE owner_profile_id IN (${marks}) AND status = 'ready' AND purpose NOT IN ('chat', 'application')) AS media,
        (SELECT COUNT(*) FROM sessions WHERE user_id = ? AND expires_at > ?) AS sessions`).bind(...ids, ...ids, id, now())
      .first<{ jobs: number; media: number; sessions: number }>(),
    ids.length ? c.env.DB.prepare(`SELECT profile_id, plan, source, started_at, expires_at FROM subscriptions WHERE profile_id IN (${marks})
        AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`).bind(...ids, now()).all<Record<string, any>>() : { results: [] },
    c.env.DB.prepare(`SELECT id, admin_email, action, result, reason, created_at FROM admin_logs
        WHERE entity_id = ? OR entity_id IN (${marks}) ORDER BY created_at DESC LIMIT 10`).bind(id, ...ids).all(),
  ]);
  const subByProfile = new Map(subs.results.map((s) => [s.profile_id, s]));
  return c.json({
    id: u!.id, email: u!.email, status: userStatus(u!.status), isDemo: u!.is_demo === 1, createdAt: u!.created_at,
    emailVerifiedAt: u!.email_verified_at, emailVerification: u!.email_verification, blockedReason: u!.blocked_reason,
    blockedAt: u!.blocked_at, deletedAt: u!.deleted_at, deletedReason: u!.deleted_reason, accountType: accountType(ps),
    isPro: ps.some((p) => p.isPro), counts,
    profiles: ps.map((p) => {
      const s = subByProfile.get(p.id);
      return { ...p, subscription: s ? { plan: s.plan, source: s.source, startedAt: s.started_at, expiresAt: s.expires_at } : null };
    }),
    logs: logs.results,
  });
});

const ProfileEdit = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._]{3,30}$/, 'invalid_username').optional(),
  bio: z.string().max(1000).optional(),
  category: z.string().trim().max(60).nullable().optional(),
  city: z.string().trim().max(60).nullable().optional(),
  country: z.string().trim().max(60).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
}).strict();

admin.patch('/profiles/:id', async (c) => {
  const id = c.req.param('id');
  const body = ProfileEdit.parse(await c.req.json());
  const old = await c.env.DB.prepare(`SELECT id, display_name, username, bio, category, city, country, website FROM profiles WHERE id = ? AND status <> 'deleted'`)
    .bind(id).first<Record<string, any>>();
  if (!old) fail(404, 'profile_not_found');
  if (body.username && body.username !== old!.username.toLowerCase()) {
    const taken = await c.env.DB.prepare(`SELECT 1 AS ok FROM profiles WHERE username = ? AND id <> ?`).bind(body.username, id).first();
    if (taken) fail(409, 'username_taken');
  }
  if (body.website) {
    const text = body.website.includes('://') ? body.website : `https://${body.website}`;
    try { if (!['https:', 'http:'].includes(new URL(text).protocol)) fail(422, 'invalid_link'); body.website = new URL(text).toString(); }
    catch { fail(422, 'invalid_link'); }
  }
  const columns: Record<string, string> = { displayName: 'display_name', username: 'username', bio: 'bio', category: 'category',
                                            city: 'city', country: 'country', website: 'website' };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(columns)) {
    const value = (body as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const next = value === '' && key !== 'bio' && key !== 'displayName' ? null : value;
    if ((old![col] ?? null) === (next ?? null)) continue;
    sets.push(`${col} = ?`);
    values.push(next);
    changes[key] = { from: old![col], to: next };
  }
  if (sets.length) {
    await c.env.DB.prepare(`UPDATE profiles SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...values, now(), id).run();
    await audit(c, 'profile.edit', 'profile', id, null, { changes });
  }
  return c.json({ status: 'saved', changed: Object.keys(changes) });
});

admin.patch('/users/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = z.object({ action: z.enum(['block', 'unblock', 'delete', 'restore']), reason: Reason.optional() }).parse(await c.req.json());
  const u = await c.env.DB.prepare(`SELECT status FROM users WHERE id = ?`).bind(id).first<{ status: string }>();
  if (!u) fail(404, 'user_not_found');
  const t = now();
  const db = c.env.DB;
  if ((body.action === 'block' || body.action === 'delete') && !body.reason) fail(422, 'reason_required');
  if (body.action === 'block') {
    if (u!.status !== 'active') fail(409, 'invalid_transition');
    await db.batch([
      db.prepare(`UPDATE users SET status = 'suspended', blocked_reason = ?, blocked_at = ?, updated_at = ? WHERE id = ?`).bind(body.reason, t, t, id),
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id), // signed out everywhere at once
    ]);
  } else if (body.action === 'unblock') {
    if (u!.status !== 'suspended') fail(409, 'invalid_transition');
    await db.prepare(`UPDATE users SET status = 'active', blocked_reason = NULL, blocked_at = NULL, failed_logins = 0, locked_until = NULL,
        updated_at = ? WHERE id = ?`).bind(t, id).run();
  } else if (body.action === 'delete') {
    if (u!.status === 'deleted') fail(409, 'invalid_transition');
    // Soft delete: nothing is erased. Sign-in stops, profiles disappear from the app; Restore brings everything back.
    await db.batch([
      db.prepare(`UPDATE users SET status = 'deleted', deleted_at = ?, deleted_reason = ?, updated_at = ? WHERE id = ?`).bind(t, body.reason, t, id),
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id),
      db.prepare(`UPDATE profiles SET status = 'hidden', admin_hidden_at = ?, updated_at = ? WHERE owner_user_id = ? AND status = 'active'`).bind(t, t, id),
    ]);
  } else {
    if (u!.status !== 'deleted') fail(409, 'invalid_transition');
    await db.batch([
      db.prepare(`UPDATE users SET status = 'active', deleted_at = NULL, deleted_reason = NULL, blocked_reason = NULL, blocked_at = NULL,
          updated_at = ? WHERE id = ?`).bind(t, id),
      db.prepare(`UPDATE profiles SET status = 'active', admin_hidden_at = NULL, updated_at = ? WHERE owner_user_id = ? AND admin_hidden_at IS NOT NULL`)
        .bind(t, id),
    ]);
  }
  await audit(c, `user.${body.action}`, 'user', id, body.reason ?? null);
  const after = await db.prepare(`SELECT status FROM users WHERE id = ?`).bind(id).first<{ status: string }>();
  return c.json({ status: userStatus(after!.status) });
});

admin.patch('/profiles/:id/pro', async (c) => {
  const id = c.req.param('id');
  const { enabled, reason } = z.object({ enabled: z.boolean(), reason: z.string().trim().max(500).optional() }).parse(await c.req.json());
  const p = await c.env.DB.prepare(`SELECT type FROM profiles WHERE id = ? AND status <> 'deleted'`).bind(id).first<{ type: string }>();
  if (!p) fail(404, 'profile_not_found');
  const t = now();
  // Manual PRO is an entitlement with source 'admin' — no payment or transaction is created.
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE subscriptions SET status = 'cancelled', expires_at = COALESCE(expires_at, ?) WHERE profile_id = ? AND status = 'active'`).bind(t, id),
    ...(enabled ? [c.env.DB.prepare(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at) VALUES (?, ?, ?, 'active', 'admin', ?)`)
      .bind(newId('sub'), id, p!.type === 'creator' ? 'creator_pro' : 'business_pro', t)] : []),
  ]);
  await audit(c, enabled ? 'pro.grant' : 'pro.revoke', 'profile', id, reason || null, { plan: p!.type === 'creator' ? 'creator_pro' : 'business_pro' });
  return c.json({ isPro: enabled });
});

// ─── jobs ───

const jobState = (j: Record<string, any>) => j.moderation_status ?? j.status;

admin.get('/jobs/categories', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT DISTINCT category FROM jobs WHERE category IS NOT NULL AND category <> '' ORDER BY category`).all<{ category: string }>();
  return c.json({ items: rows.results.map((r) => r.category) });
});

admin.get('/jobs', async (c) => {
  const { limit, offset, page: pageNo } = page(c);
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  const text = q(c);
  if (text) {
    where.push(`(lower(j.title) LIKE ? ESCAPE '\\' OR j.id = ? OR lower(o.display_name) LIKE ? ESCAPE '\\' OR lower(o.username) LIKE ? ESCAPE '\\')`);
    params.push(like(text), text, like(text), like(text.replace(/^@/, '')));
  }
  const status = c.req.query('status');
  if (status === 'hidden' || status === 'deleted') { where.push(`j.moderation_status = ?`); params.push(status); }
  else if (status && ['published', 'closed', 'draft'].includes(status)) { where.push(`j.status = ? AND j.moderation_status IS NULL`); params.push(status); }
  const category = c.req.query('category');
  if (category) { where.push(`j.category = ?`); params.push(category); }
  const owner = c.req.query('owner');
  if (owner) { where.push(`(j.owner_profile_id = ? OR o.owner_user_id = ?)`); params.push(owner, owner); }
  const from = Number(c.req.query('from'));
  const to = Number(c.req.query('to'));
  if (from) { where.push(`COALESCE(j.published_at, j.created_at) >= ?`); params.push(from); }
  if (to) { where.push(`COALESCE(j.published_at, j.created_at) < ?`); params.push(to); }
  const order = c.req.query('sort') === 'oldest' ? 'sort_at ASC, j.id ASC' : 'sort_at DESC, j.id DESC';
  const base = `FROM jobs j JOIN profiles o ON o.id = j.owner_profile_id WHERE ${where.join(' AND ')}`;
  const [total, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n ${base}`).bind(...params).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT j.id, j.title, j.category, j.status, j.moderation_status, j.moderation_reason, j.published_at, j.created_at,
        j.owner_profile_id, COALESCE(j.published_at, j.created_at) AS sort_at,
        (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'submitted') AS applications,
        (SELECT jm.media_id FROM job_media jm JOIN media m ON m.id = jm.media_id WHERE jm.job_id = j.id ORDER BY jm.position LIMIT 1) AS thumb_id
        ${base} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...params, limit, offset).all<Record<string, any>>(),
  ]);
  const ownerIds = [...new Set(rows.results.map((r) => r.owner_profile_id))];
  const thumbIds = rows.results.map((r) => r.thumb_id).filter(Boolean);
  const [owners, thumbs] = await Promise.all([
    ownerIds.length ? c.env.DB.prepare(`SELECT ${cardColumns}, p.owner_user_id FROM profiles p ${avatarJoin} WHERE p.id IN (${ownerIds.map(() => '?').join(',')})`)
      .bind(...ownerIds).all<CardRow & { owner_user_id: string }>() : { results: [] },
    thumbIds.length ? c.env.DB.prepare(`SELECT ${mediaColumns} FROM media m WHERE m.id IN (${thumbIds.map(() => '?').join(',')})`)
      .bind(...thumbIds).all<MediaRow>() : { results: [] },
  ]);
  const ownerMap = new Map(owners.results.map((o) => [o.id, { ...card(c.env, o), userId: o.owner_user_id }]));
  const thumbMap = new Map(thumbs.results.map((m) => [m.id, mediaJSON(c.env, m)]));
  return c.json({
    total: total?.n ?? 0, page: pageNo, limit,
    items: rows.results.map((j) => {
      const thumb = j.thumb_id ? thumbMap.get(j.thumb_id) : null;
      return { id: j.id, title: j.title, category: j.category, status: jobState(j), moderationReason: j.moderation_reason,
               publishedAt: j.published_at, createdAt: j.created_at, applicationsCount: j.applications,
               thumbnailUrl: thumb ? (thumb.kind === 'video' ? thumb.posterUrl : thumb.url) : null, author: ownerMap.get(j.owner_profile_id) ?? null };
    }),
  });
});

admin.get('/jobs/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`SELECT j.*, p.owner_user_id FROM jobs j JOIN profiles p ON p.id = j.owner_profile_id WHERE j.id = ?`)
    .bind(id).first<Record<string, any>>();
  if (!row) fail(404, 'job_not_found');
  const [json] = await jobsJSON(c.env, [row!], null);
  const [apps, logs] = await Promise.all([
    c.env.DB.prepare(`SELECT COALESCE(SUM(status = 'submitted'), 0) AS submitted, SUM(status = 'withdrawn') AS withdrawn FROM applications WHERE job_id = ?`).bind(id)
      .first<{ submitted: number; withdrawn: number | null }>(),
    c.env.DB.prepare(`SELECT id, admin_email, action, result, reason, created_at FROM admin_logs WHERE entity_id = ? ORDER BY created_at DESC LIMIT 10`)
      .bind(id).all(),
  ]);
  const state = jobState(row as { status: string; moderation_status: string | null });
  return c.json({
    ...json, status: state, ownerUserId: row!.owner_user_id, moderationStatus: row!.moderation_status, moderationReason: row!.moderation_reason,
    moderatedAt: row!.moderated_at, applicationsTotal: apps?.submitted ?? 0, applicationsWithdrawn: apps?.withdrawn ?? 0,
    liveUrl: state === 'published' || state === 'closed' ? appLink(c.env, 'job', id) : null, logs: logs.results,
  });
});

const JobEdit = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().trim().max(60).nullable().optional(),
  location: z.string().trim().max(120).optional(),
}).strict();

admin.patch('/jobs/:id', async (c) => {
  const id = c.req.param('id');
  const body = JobEdit.parse(await c.req.json());
  const old = await c.env.DB.prepare(`SELECT title, description, category, location FROM jobs WHERE id = ?`).bind(id).first<Record<string, any>>();
  if (!old) fail(404, 'job_not_found');
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of ['title', 'description', 'category', 'location'] as const) {
    const value = body[key];
    if (value === undefined) continue;
    const next = key === 'category' && value === '' ? null : value;
    if ((old![key] ?? null) === (next ?? null)) continue;
    sets.push(`${key} = ?`);
    values.push(next);
    changes[key] = { from: key === 'description' ? `${String(old![key]).slice(0, 80)}…` : old![key], to: key === 'description' ? `${String(next).slice(0, 80)}…` : next };
  }
  if (sets.length) {
    await c.env.DB.prepare(`UPDATE jobs SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...values, now(), id).run();
    await audit(c, 'job.edit', 'job', id, null, { changes });
  }
  return c.json({ status: 'saved', changed: Object.keys(changes) });
});

admin.patch('/jobs/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = z.object({ action: z.enum(['hide', 'restore', 'delete']), reason: Reason.optional() }).parse(await c.req.json());
  if (body.action !== 'restore' && !body.reason) fail(422, 'reason_required');
  const j = await c.env.DB.prepare(`SELECT status, moderation_status, pre_moderation_status FROM jobs WHERE id = ?`).bind(id)
    .first<{ status: string; moderation_status: string | null; pre_moderation_status: string | null }>();
  if (!j) fail(404, 'job_not_found');
  const t = now();
  if (body.action === 'restore') {
    if (!j!.moderation_status) fail(409, 'invalid_transition');
    await c.env.DB.prepare(`UPDATE jobs SET status = COALESCE(pre_moderation_status, 'published'), moderation_status = NULL, moderation_reason = NULL,
        moderated_at = ?, pre_moderation_status = NULL, updated_at = ? WHERE id = ?`).bind(t, t, id).run();
  } else {
    const target = body.action === 'hide' ? 'hidden' : 'deleted';
    if (j!.moderation_status === target) fail(409, 'invalid_transition');
    if (!j!.moderation_status && j!.status === 'removed') fail(409, 'invalid_transition');
    // 'removed' hides the job from every public query; the files and applications stay untouched.
    await c.env.DB.prepare(`UPDATE jobs SET pre_moderation_status = COALESCE(pre_moderation_status, status), status = 'removed',
        moderation_status = ?, moderation_reason = ?, moderated_at = ?, updated_at = ? WHERE id = ?`).bind(target, body.reason, t, t, id).run();
  }
  await audit(c, `job.${body.action}`, 'job', id, body.reason ?? null);
  const after = await c.env.DB.prepare(`SELECT status, moderation_status FROM jobs WHERE id = ?`).bind(id).first<{ status: string; moderation_status: string | null }>();
  return c.json({ status: jobState(after!) });
});

// ─── media (public library only: chat and application attachments are private and never listed) ───

const mediaState = (m: Record<string, any>) => m.moderation_status ?? m.status;

admin.get('/media', async (c) => {
  const { limit, offset, page: pageNo } = page(c, 24);
  const where = [`m.purpose NOT IN ('chat', 'application')`, `(m.status = 'ready' OR m.moderation_status IS NOT NULL)`];
  const params: unknown[] = [];
  const text = q(c);
  if (text) {
    where.push(`(lower(COALESCE(m.title, '')) LIKE ? ESCAPE '\\' OR m.id = ? OR lower(p.display_name) LIKE ? ESCAPE '\\' OR lower(p.username) LIKE ? ESCAPE '\\')`);
    params.push(like(text), text, like(text), like(text.replace(/^@/, '')));
  }
  const kind = c.req.query('kind');
  if (kind === 'photo' || kind === 'video') { where.push(`m.kind = ?`); params.push(kind); }
  const purpose = c.req.query('purpose');
  if (purpose && ['avatar', 'portfolio', 'intro', 'collection', 'job', 'poster'].includes(purpose)) { where.push(`m.purpose = ?`); params.push(purpose); }
  const status = c.req.query('status');
  if (status === 'hidden') where.push(`m.moderation_status = 'hidden'`);
  else if (status === 'visible') where.push(`m.moderation_status IS NULL`);
  const owner = c.req.query('owner');
  if (owner) { where.push(`(m.owner_profile_id = ? OR p.owner_user_id = ?)`); params.push(owner, owner); }
  const base = `FROM media m JOIN profiles p ON p.id = m.owner_profile_id WHERE ${where.join(' AND ')}`;
  const order = c.req.query('sort') === 'oldest' ? 'm.created_at ASC, m.id ASC' : 'm.created_at DESC, m.id DESC';
  const [total, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n ${base}`).bind(...params).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT ${mediaColumns}, m.status, m.moderation_status, m.moderation_reason, m.is_public, m.bytes,
        (SELECT jm.job_id FROM job_media jm WHERE jm.media_id = m.id LIMIT 1) AS job_id ${base} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset).all<MediaRow & Record<string, any>>(),
  ]);
  const ownerIds = [...new Set(rows.results.map((r) => r.owner_profile_id))];
  const owners = ownerIds.length ? await c.env.DB.prepare(`SELECT ${cardColumns}, p.owner_user_id FROM profiles p ${avatarJoin}
      WHERE p.id IN (${ownerIds.map(() => '?').join(',')})`).bind(...ownerIds).all<CardRow & { owner_user_id: string }>() : { results: [] };
  const ownerMap = new Map(owners.results.map((o) => [o.id, { ...card(c.env, o), userId: o.owner_user_id }]));
  return c.json({
    total: total?.n ?? 0, page: pageNo, limit,
    items: rows.results.map((m) => {
      const state = mediaState(m);
      const json = mediaJSON(c.env, m);
      // Hidden R2 files are not served (status ≠ ready); external demo URLs still preview for the admin.
      const previewable = state === 'ready' || m.provider === 'external';
      return { ...json, url: previewable && m.is_public ? json.url : null, posterUrl: previewable ? json.posterUrl : null,
               status: state === 'ready' ? 'visible' : state, moderationReason: m.moderation_reason, bytes: m.bytes,
               jobId: m.job_id, owner: ownerMap.get(m.owner_profile_id) ?? null,
               publicUrl: state === 'ready' && m.job_id ? appLink(c.env, 'job', m.job_id) : state === 'ready' ? appLink(c.env, 'profile', m.owner_profile_id) : null };
    }),
  });
});

admin.patch('/media/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = z.object({ action: z.enum(['hide', 'restore']), reason: Reason.optional() }).parse(await c.req.json());
  if (body.action === 'hide' && !body.reason) fail(422, 'reason_required');
  const m = await c.env.DB.prepare(`SELECT status, moderation_status, purpose FROM media WHERE id = ?`).bind(id)
    .first<{ status: string; moderation_status: string | null; purpose: string }>();
  if (!m || ['chat', 'application'].includes(m.purpose)) fail(404, 'media_not_found');
  if (body.action === 'hide') {
    if (m!.status !== 'ready' || m!.moderation_status) fail(409, 'invalid_transition');
    // The object stays in R2: the app just stops serving / listing it.
    await c.env.DB.prepare(`UPDATE media SET pre_moderation_status = status, status = 'deleted', moderation_status = 'hidden',
        moderation_reason = ? WHERE id = ?`).bind(body.reason, id).run();
  } else {
    if (m!.moderation_status !== 'hidden') fail(409, 'invalid_transition');
    await c.env.DB.prepare(`UPDATE media SET status = COALESCE(pre_moderation_status, 'ready'), moderation_status = NULL, moderation_reason = NULL,
        pre_moderation_status = NULL WHERE id = ?`).bind(id).run();
  }
  await audit(c, `media.${body.action}`, 'media', id, body.reason ?? null);
  return c.json({ status: body.action === 'hide' ? 'hidden' : 'visible' });
});

// ─── activity logs ───

admin.get('/logs', async (c) => {
  const { limit, offset, page: pageNo } = page(c, 25);
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  const text = q(c);
  if (text) {
    where.push(`(lower(action) LIKE ? ESCAPE '\\' OR lower(COALESCE(entity_id, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(reason, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(admin_email, '')) LIKE ? ESCAPE '\\')`);
    params.push(like(text), like(text), like(text), like(text));
  }
  const action = c.req.query('action');
  if (action) { where.push(`action LIKE ? ESCAPE '\\'`); params.push(`${action.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`); }
  const result = c.req.query('result');
  if (result === 'success' || result === 'failure') { where.push(`result = ?`); params.push(result); }
  const [total, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_logs WHERE ${where.join(' AND ')}`).bind(...params).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT id, admin_email, action, entity_type, entity_id, result, reason, detail, created_at FROM admin_logs
        WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all<Record<string, any>>(),
  ]);
  return c.json({
    total: total?.n ?? 0, page: pageNo, limit,
    items: rows.results.map((r) => ({ id: r.id, adminEmail: r.admin_email, action: r.action, entityType: r.entity_type, entityId: r.entity_id,
                                      result: r.result, reason: r.reason, detail: r.detail ? JSON.parse(r.detail) : null, createdAt: r.created_at })),
  });
});

export default admin;
