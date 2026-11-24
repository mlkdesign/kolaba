// The signed-in account itself: notification settings (Settings → Notifications), the Free / PRO test switch for
// allowed testers only, and Delete account (Settings → ⋯).
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, currentUser, requireAuth, requireProfile } from '../lib/auth';
import { fail, newId, now } from '../lib/util';
import { canTestPro } from './auth';
import { entitlementsSnapshot } from '../lib/entitlements';
import { monetizationEnabled } from '../lib/moderation';
import { verifyPassword } from '../lib/password';
import { eraseAccount } from '../lib/erase';
import { mediaColumns, mediaJSON, type MediaRow } from '../lib/cards';
import { visibleMediaSQL } from '../lib/moderation';

const me = new Hono<AppEnv>();
me.use('*', requireAuth);

// GET /v1/me/liked-media — FEATURE 130: Settings → Liked media: the videos this profile liked, the latest like first
// (only ones still public and approved).
me.get('/liked-media', requireProfile, async (c) => {
  const profile = actingProfile(c);
  const rows = await c.env.DB.prepare(`SELECT ${mediaColumns} FROM likes l JOIN media m ON m.id = l.media_id
      WHERE l.profile_id = ? AND m.status = 'ready' AND m.is_public = 1 AND ${visibleMediaSQL('m')}
      ORDER BY l.created_at DESC LIMIT 200`).bind(profile.id).all<MediaRow>();
  return c.json({ items: rows.results.map((m) => mediaJSON(c.env, m)) });
});

// The iOS switches (SettingsNotificationsPage): stored per account.
// Categories (Notifications ТЗ §7): Jobs & Apply (newApplications, projectUpdates = saved jobs), Contacts
// (followersAndMentions), Reviews, Content & Moderation, PRO & Subscription, Messages (push only — never feed rows).
// Account security has no switch: it always arrives.
const Notifications = z.object({
  push: z.boolean(), newMessages: z.boolean(), projectUpdates: z.boolean(), newApplications: z.boolean(),
  followersAndMentions: z.boolean(), email: z.boolean(),
  reviews: z.boolean().default(true), content: z.boolean().default(true), subscription: z.boolean().default(true),
});
const DEFAULTS = { push: true, newMessages: true, projectUpdates: true, newApplications: true, followersAndMentions: true, email: false,
                   reviews: true, content: true, subscription: true };

me.get('/settings', async (c) => {
  const user = currentUser(c);
  const row = await c.env.DB.prepare(`SELECT language, notifications FROM user_settings WHERE user_id = ?`).bind(user.id)
    .first<{ language: string; notifications: string }>();
  let stored: Record<string, unknown> = {};
  try { stored = JSON.parse(row?.notifications ?? '{}'); } catch { /* defaults */ }
  return c.json({ language: row?.language ?? 'en', notifications: { ...DEFAULTS, ...stored } });
});

me.put('/settings', async (c) => {
  const user = currentUser(c);
  const body = z.object({ notifications: Notifications }).parse(await c.req.json());
  await c.env.DB.prepare(`INSERT INTO user_settings (user_id, notifications, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET notifications = excluded.notifications, updated_at = excluded.updated_at`)
    .bind(user.id, JSON.stringify(body.notifications), now()).run();
  return c.json({ notifications: body.notifications });
});

// FEATURE 115 — APNs: PUT /v1/me/devices {token, environment, previews} registers this device for the signed-in account
// (a token another account had moves here); DELETE /v1/me/devices/:token on Log out.
me.put('/devices', async (c) => {
  const user = currentUser(c);
  const body = z.object({
    token: z.string().trim().regex(/^[0-9a-fA-F]{32,200}$/),
    environment: z.enum(['production', 'sandbox']).default('production'),
    previews: z.boolean().default(true),
    // FIX 169 — Settings → Push & Alerts on this device (kept as they were when not sent).
    sounds: z.boolean().optional(),
    otherProfiles: z.boolean().optional(),
    activeProfileId: z.string().max(64).nullable().optional(),
  }).parse(await c.req.json());
  let active: string | null | undefined = body.activeProfileId;
  if (active) {
    const owned = await c.env.DB.prepare(`SELECT 1 FROM profiles WHERE id = ? AND owner_user_id = ?`).bind(active, user.id).first();
    if (!owned) active = null;
  }
  await c.env.DB.prepare(`INSERT INTO device_tokens (token, user_id, environment, previews, sounds, other_profiles, active_profile_id,
        created_at, updated_at) VALUES (?1, ?2, ?3, ?4, COALESCE(?5, 1), COALESCE(?6, 1), ?7, ?8, ?8)
      ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, environment = excluded.environment, previews = excluded.previews,
        sounds = COALESCE(?5, device_tokens.sounds), other_profiles = COALESCE(?6, device_tokens.other_profiles),
        active_profile_id = CASE WHEN ?9 THEN ?7 ELSE device_tokens.active_profile_id END, updated_at = excluded.updated_at`)
    .bind(body.token.toLowerCase(), user.id, body.environment, body.previews ? 1 : 0,
          body.sounds === undefined ? null : Number(body.sounds), body.otherProfiles === undefined ? null : Number(body.otherProfiles),
          active ?? null, now(), active !== undefined ? 1 : 0).run();
  return c.json({ status: 'registered' });
});

me.delete('/devices/:token', async (c) => {
  const user = currentUser(c);
  await c.env.DB.prepare(`DELETE FROM device_tokens WHERE token = ? AND user_id = ?`).bind(c.req.param('token').toLowerCase(), user.id).run();
  return c.json({ status: 'removed' });
});

// PUT /v1/me/pro-test {pro} — the acting profile's PRO for testing (creator.pro or business.pro by its type). Only for
// an admin or an address in PRO_TEST_EMAILS; everyone else gets 403 — PRO is never self-service.
me.put('/pro-test', requireProfile, async (c) => {
  const user = currentUser(c);
  const profile = actingProfile(c);
  const row = await c.env.DB.prepare(`SELECT role, email, email_verification FROM users WHERE id = ?`).bind(user.id)
    .first<{ role: string; email: string; email_verification: string | null }>();
  if (!monetizationEnabled(c.env)) fail(403, 'monetization_disabled');
  if (!row || !canTestPro(c.env, row)) fail(403, 'pro_test_not_allowed');
  const { pro } = z.object({ pro: z.boolean() }).parse(await c.req.json());
  await c.env.DB.prepare(`UPDATE subscriptions SET status = 'cancelled', expires_at = ? WHERE profile_id = ? AND status = 'active'`)
    .bind(now(), profile.id).run();
  if (pro) {
    await c.env.DB.prepare(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at) VALUES (?, ?, ?, 'active', 'test', ?)`)
      .bind(newId('sub'), profile.id, profile.type === 'business' ? 'business_pro' : 'creator_pro', now()).run();
  }
  return c.json({ pro });
});

// GET /v1/me/entitlements — the acting profile's plan, its limits and what it has used (Entitlements & Usage Limits):
// portfolio videos (creator profile), job posts (the account's, shared by all its business profiles), collections,
// video length. The app reads this; the writes check the same rules themselves.
me.get('/entitlements', requireProfile, async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await entitlementsSnapshot(c.env, actingProfile(c)));
});

/** One profile of an account and everything it owns, removed for real (Account Center → delete a profile): its media
 *  and files, jobs with their applications, chats' messages it sent (a conversation nobody is left in goes too),
 *  contacts, reviews it wrote or received, notifications, settings. The account and its other profiles stay. */
export async function deleteProfileData(env: Env, profileId: string): Promise<{ files: number; filesFailed: string[] }> {
  const files = await env.DB.prepare(`SELECT storage_key FROM media WHERE owner_profile_id = ?1 AND provider = 'r2' AND storage_key IS NOT NULL
      UNION ALL SELECT storage_key FROM message_voice WHERE message_id IN (SELECT id FROM messages WHERE sender_profile_id = ?1)`)
    .bind(profileId).all<{ storage_key: string }>();
  const statements = [
    `UPDATE conversations SET last_message_id = NULL WHERE last_message_id IN (SELECT id FROM messages WHERE sender_profile_id = ?1)`,
    `DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE sender_profile_id = ?1) OR media_id IN (SELECT id FROM media WHERE owner_profile_id = ?1)`,
    `DELETE FROM message_reactions WHERE profile_id = ?1 OR message_id IN (SELECT id FROM messages WHERE sender_profile_id = ?1)`,
    `DELETE FROM message_voice WHERE message_id IN (SELECT id FROM messages WHERE sender_profile_id = ?1)`,
    `DELETE FROM messages WHERE sender_profile_id = ?1`,
    `DELETE FROM application_media WHERE application_id IN (SELECT id FROM applications WHERE creator_profile_id = ?1 OR job_id IN (SELECT id FROM jobs WHERE owner_profile_id = ?1))`,
    `DELETE FROM applications WHERE creator_profile_id = ?1 OR job_id IN (SELECT id FROM jobs WHERE owner_profile_id = ?1)`,
    `DELETE FROM saved_jobs WHERE profile_id = ?1 OR job_id IN (SELECT id FROM jobs WHERE owner_profile_id = ?1)`,
    `DELETE FROM job_media WHERE job_id IN (SELECT id FROM jobs WHERE owner_profile_id = ?1)`,
    `DELETE FROM jobs WHERE owner_profile_id = ?1`,
    `DELETE FROM likes WHERE profile_id = ?1 OR media_id IN (SELECT id FROM media WHERE owner_profile_id = ?1)`,
    `DELETE FROM media_views WHERE viewer_profile_id = ?1 OR media_id IN (SELECT id FROM media WHERE owner_profile_id = ?1)`,
    `DELETE FROM collection_items WHERE media_id IN (SELECT id FROM media WHERE owner_profile_id = ?1) OR collection_id IN (SELECT id FROM collections WHERE owner_profile_id = ?1)`,
    `DELETE FROM collections WHERE owner_profile_id = ?1`,
    `UPDATE profiles SET avatar_media_id = NULL, intro_video_media_id = NULL WHERE id = ?1`,
    `DELETE FROM media WHERE owner_profile_id = ?1`,
    `DELETE FROM contact_requests WHERE sender_profile_id = ?1 OR recipient_profile_id = ?1`,
    `DELETE FROM follows WHERE follower_profile_id = ?1 OR followee_profile_id = ?1`,
    `DELETE FROM review_requests WHERE requester_profile_id = ?1 OR contact_profile_id = ?1`,
    `DELETE FROM reviews WHERE author_profile_id = ?1 OR recipient_profile_id = ?1`,
    `DELETE FROM review_invites WHERE owner_profile_id = ?1 OR accepted_by_profile_id = ?1`,
    `DELETE FROM notifications WHERE recipient_profile_id = ?1 OR actor_profile_id = ?1`,
    `DELETE FROM notification_preferences WHERE profile_id = ?1`,
    `UPDATE reports SET reporter_profile_id = NULL WHERE reporter_profile_id = ?1`,
    `DELETE FROM conversation_read_state WHERE profile_id = ?1`,
    `DELETE FROM conversation_participants WHERE profile_id = ?1`,
    `DELETE FROM messages WHERE conversation_id NOT IN (SELECT conversation_id FROM conversation_participants)`,
    `DELETE FROM conversations WHERE id NOT IN (SELECT conversation_id FROM conversation_participants)`,
    `DELETE FROM profile_links WHERE profile_id = ?1`,
    `DELETE FROM profile_external_links WHERE profile_id = ?1`,
    `DELETE FROM profile_social_accounts WHERE profile_id = ?1`,
    `DELETE FROM profile_settings WHERE profile_id = ?1`,
    `DELETE FROM subscriptions WHERE profile_id = ?1`,
    `DELETE FROM profiles WHERE id = ?1`,
  ];
  await env.DB.batch(statements.map((sql) => (sql.includes('?1') ? env.DB.prepare(sql).bind(profileId) : env.DB.prepare(sql))));
  const failed: string[] = [];
  if (env.MEDIA) {
    for (const f of files.results) {
      try { await env.MEDIA.delete(f.storage_key); } catch { failed.push(f.storage_key); }
    }
  }
  if (failed.length) console.error('profile deletion: files not removed', profileId, failed);
  return { files: files.results.length - failed.length, filesFailed: failed };
}

// DELETE /v1/me {confirm: "DELETE", password?} — the account and everything it owns; the sessions end with it. An account
// with a password confirms it again here (re-authentication); a Google-only account confirms with "DELETE".
me.delete('/', async (c) => {
  const user = currentUser(c);
  const body = z.object({ confirm: z.literal('DELETE'), password: z.string().min(1).max(200).optional() }).parse(await c.req.json());
  if (user.isDemo) fail(403, 'demo_account');
  const creds = await c.env.DB.prepare(`SELECT password_hash, password_salt, password_scheme FROM users WHERE id = ?`).bind(user.id)
    .first<{ password_hash: string | null; password_salt: string | null; password_scheme: string | null }>();
  if (creds?.password_hash && creds.password_salt && creds.password_scheme) {
    if (!body.password) fail(401, 'password_required');
    if (!(await verifyPassword(body.password!, creds.password_hash, creds.password_salt, creds.password_scheme))) fail(401, 'invalid_credentials');
  }
  // FIX 131: the one erasure (src/lib/erase.ts) — the same as the admin panel's "Delete all data".
  const result = await eraseAccount(c.env, user.id, 'self');
  await c.env.DB.prepare(`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, detail, created_at)
      VALUES (NULL, 'account.erased', 'user', ?, ?, ?)`).bind(user.id, JSON.stringify(result), now()).run();
  return c.json({ status: 'deleted', profiles: result.profiles, files: result.filesDeleted, filesFailed: result.filesFailed,
                  erasure: result.status });
});

export default me;
