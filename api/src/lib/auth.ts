import type { Context, MiddlewareHandler } from 'hono';
import type { ActingProfile, AppEnv, AuthUser } from '../env';
import { fail, newToken, now, sha256Hex } from './util';

export const SESSION_DAYS = 30;

/** Creates a session; returns the bearer token (only its hash is stored). */
export async function createSession(db: D1Database, userId: string, userAgent: string | undefined): Promise<string> {
  const token = newToken();
  const t = now();
  await db.prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent)
                    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(await sha256Hex(token), userId, t, t + SESSION_DAYS * 86_400_000, t, (userAgent ?? '').slice(0, 200))
    .run();
  return token;
}

function bearer(c: Context): string | null {
  const header = c.req.header('Authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(header);
  return match ? match[1] : null;
}

/** Reads the session if there is one (never fails). */
export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c);
  if (token) {
    const sessionId = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.id, u.email, u.role, u.is_demo, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).bind(sessionId)
      .first<{ session_id: string; expires_at: number; last_seen_at: number; id: string; email: string; role: AuthUser['role'];
               is_demo: number; status: string }>();
    if (row && row.expires_at > now() && row.status === 'active') {
      c.set('user', { id: row.id, email: row.email, role: row.role, isDemo: row.is_demo === 1, sessionId: row.session_id });
      // Sliding expiry, written at most hourly (saves D1 writes).
      if (now() - row.last_seen_at > 3_600_000) {
        c.executionCtx.waitUntil(c.env.DB.prepare(`UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?`)
          .bind(now(), now() + SESSION_DAYS * 86_400_000, row.session_id).run());
      }
    }
  }
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) fail(401, 'not_signed_in');
  await next();
};

/**
 * The acting profile (the app's Active Profile) from the X-Profile-Id header — it must belong to the signed-in
 * account and be active. Every write is done "as" this profile.
 */
export const requireProfile: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user') ?? fail(401, 'not_signed_in');
  const profileId = c.req.header('X-Profile-Id') ?? fail(400, 'profile_required');
  const profile = await c.env.DB.prepare(
    `SELECT id, type, owner_user_id, status FROM profiles WHERE id = ?`).bind(profileId)
    .first<{ id: string; type: ActingProfile['type']; owner_user_id: string; status: string }>();
  if (!profile || profile.owner_user_id !== user.id || profile.status === 'deleted') fail(403, 'not_profile_owner');
  if (profile!.status === 'suspended') fail(403, 'profile_suspended');
  c.set('profile', { id: profile!.id, type: profile!.type, ownerUserId: profile!.owner_user_id });
  await next();
};

export function actingProfile(c: Context<AppEnv>, type?: ActingProfile['type']): ActingProfile {
  const profile = c.get('profile') ?? fail(400, 'profile_required');
  if (type && profile.type !== type) fail(403, type === 'creator' ? 'creator_profile_required' : 'business_profile_required');
  return profile;
}

export function currentUser(c: Context<AppEnv>): AuthUser {
  return c.get('user') ?? fail(401, 'not_signed_in');
}

/** Workers Rate Limiting (when bound); `key` scopes it (ip, user, e-mail). */
export async function rateLimit(c: Context<AppEnv>, binding: 'RL_AUTH' | 'RL_WRITE', key: string): Promise<void> {
  const limiter = c.env[binding];
  if (!limiter) return;
  const { success } = await limiter.limit({ key });
  if (!success) fail(429, 'rate_limited');
}

export const clientIP = (c: Context) => c.req.header('CF-Connecting-IP') ?? 'unknown';
