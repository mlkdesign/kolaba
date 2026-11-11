// The signed-in account itself: notification settings (Settings → Notifications), the Free / PRO test switch for
// allowed testers only, and Delete account (Settings → ⋯).
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, currentUser, requireAuth, requireProfile } from '../lib/auth';
import { fail, newId, now } from '../lib/util';
import { canTestPro } from './auth';
import { monetizationEnabled } from '../lib/moderation';
import { verifyPassword } from '../lib/password';

const me = new Hono<AppEnv>();
me.use('*', requireAuth);

// The iOS switches (SettingsNotificationsPage): stored per account.
const Notifications = z.object({
  push: z.boolean(), newMessages: z.boolean(), projectUpdates: z.boolean(), newApplications: z.boolean(),
  followersAndMentions: z.boolean(), email: z.boolean(),
});
const DEFAULTS = { push: true, newMessages: true, projectUpdates: true, newApplications: true, followersAndMentions: true, email: false };

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
  }).parse(await c.req.json());
  await c.env.DB.prepare(`INSERT INTO device_tokens (token, user_id, environment, previews, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, environment = excluded.environment, previews = excluded.previews,
      updated_at = excluded.updated_at`)
    .bind(body.token.toLowerCase(), user.id, body.environment, body.previews ? 1 : 0, now(), now()).run();
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

/** Everything an account owns, removed for real. Shared things: a conversation stays for the other side (this
 *  account's messages go with its profiles); reviews it wrote and received go; jobs go with their applications. R2
 *  files are deleted after the rows; a file that fails is reported, never blocks the deletion. */
export async function deleteAccount(env: Env, userId: string): Promise<{ profiles: number; files: number; filesFailed: string[] }> {
  const P = `(SELECT id FROM profiles WHERE owner_user_id = ?1)`;
  const files = await env.DB.prepare(`SELECT storage_key FROM media WHERE owner_profile_id IN ${P} AND provider = 'r2' AND storage_key IS NOT NULL
      UNION ALL SELECT storage_key FROM message_voice WHERE message_id IN (SELECT id FROM messages WHERE sender_profile_id IN ${P})
      UNION ALL SELECT attachment_key FROM feedback WHERE user_id = ?1 AND attachment_key IS NOT NULL`)
    .bind(userId).all<{ storage_key: string }>();
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM profiles WHERE owner_user_id = ?`).bind(userId).first<{ n: number }>();
  const statements = [
    `UPDATE conversations SET last_message_id = NULL WHERE last_message_id IN (SELECT id FROM messages WHERE sender_profile_id IN ${P})`,
    `DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE sender_profile_id IN ${P}) OR media_id IN (SELECT id FROM media WHERE owner_profile_id IN ${P})`,
    `DELETE FROM messages WHERE sender_profile_id IN ${P}`,
    `DELETE FROM application_media WHERE application_id IN (SELECT id FROM applications WHERE creator_profile_id IN ${P} OR job_id IN (SELECT id FROM jobs WHERE owner_profile_id IN ${P}))`,
    `DELETE FROM applications WHERE creator_profile_id IN ${P} OR job_id IN (SELECT id FROM jobs WHERE owner_profile_id IN ${P})`,
    `DELETE FROM saved_jobs WHERE profile_id IN ${P} OR job_id IN (SELECT id FROM jobs WHERE owner_profile_id IN ${P})`,
    `DELETE FROM job_media WHERE job_id IN (SELECT id FROM jobs WHERE owner_profile_id IN ${P})`,
    `DELETE FROM jobs WHERE owner_profile_id IN ${P}`,
    `DELETE FROM likes WHERE profile_id IN ${P} OR media_id IN (SELECT id FROM media WHERE owner_profile_id IN ${P})`,
    `DELETE FROM media_views WHERE viewer_profile_id IN ${P} OR media_id IN (SELECT id FROM media WHERE owner_profile_id IN ${P})`,
    `DELETE FROM collection_items WHERE media_id IN (SELECT id FROM media WHERE owner_profile_id IN ${P}) OR collection_id IN (SELECT id FROM collections WHERE owner_profile_id IN ${P})`,
    `DELETE FROM collections WHERE owner_profile_id IN ${P}`,
    `UPDATE profiles SET avatar_media_id = NULL, intro_video_media_id = NULL WHERE owner_user_id = ?1`,
    `DELETE FROM media WHERE owner_profile_id IN ${P}`,
    `DELETE FROM contact_requests WHERE sender_profile_id IN ${P} OR recipient_profile_id IN ${P}`,
    `DELETE FROM follows WHERE follower_profile_id IN ${P} OR followee_profile_id IN ${P}`,
    `DELETE FROM review_requests WHERE requester_profile_id IN ${P} OR contact_profile_id IN ${P}`,
    `DELETE FROM reviews WHERE author_user_id = ?1 OR author_profile_id IN ${P} OR recipient_profile_id IN ${P}`,
    `DELETE FROM review_invites WHERE owner_profile_id IN ${P} OR accepted_by_profile_id IN ${P}`,
    `DELETE FROM notifications WHERE recipient_profile_id IN ${P} OR actor_profile_id IN ${P}`,
    // Reports this account filed stay for the moderators, without the reporter (DATA_RETENTION.md).
    `UPDATE reports SET reporter_user_id = NULL, reporter_profile_id = NULL WHERE reporter_user_id = ?1 OR reporter_profile_id IN ${P}`,
    `DELETE FROM message_reactions WHERE profile_id IN ${P} OR message_id IN (SELECT id FROM messages WHERE sender_profile_id IN ${P})`,
    `DELETE FROM message_voice WHERE message_id IN (SELECT id FROM messages WHERE sender_profile_id IN ${P})`,
    `DELETE FROM blocks WHERE blocker_user_id = ?1 OR blocked_user_id = ?1`,
    `DELETE FROM feedback WHERE user_id = ?1`,
    `DELETE FROM conversation_read_state WHERE profile_id IN ${P}`,
    `DELETE FROM conversation_participants WHERE profile_id IN ${P}`,
    // A conversation nobody is left in goes too.
    `DELETE FROM messages WHERE conversation_id NOT IN (SELECT conversation_id FROM conversation_participants)`,
    `DELETE FROM conversations WHERE id NOT IN (SELECT conversation_id FROM conversation_participants)`,
    `DELETE FROM profile_links WHERE profile_id IN ${P}`,
    `DELETE FROM profile_social_accounts WHERE profile_id IN ${P}`,
    `DELETE FROM profile_settings WHERE profile_id IN ${P}`,
    `DELETE FROM subscriptions WHERE profile_id IN ${P}`,
    `DELETE FROM profiles WHERE owner_user_id = ?1`,
    `DELETE FROM sessions WHERE user_id = ?1`,
    `DELETE FROM device_tokens WHERE user_id = ?1`,
    `DELETE FROM auth_identities WHERE user_id = ?1`,
    `DELETE FROM email_codes WHERE user_id = ?1`,
    `DELETE FROM user_settings WHERE user_id = ?1`,
    `DELETE FROM users WHERE id = ?1`,
  ];
  // D1 rejects a binding a statement doesn't use, so only the ones that name ?1 get the id.
  await env.DB.batch(statements.map((sql) => (sql.includes('?1') ? env.DB.prepare(sql).bind(userId) : env.DB.prepare(sql))));
  const failed: string[] = [];
  if (env.MEDIA) {
    for (const f of files.results) {
      try { await env.MEDIA.delete(f.storage_key); } catch { failed.push(f.storage_key); }
    }
  }
  if (failed.length) console.error('account deletion: files not removed', userId, failed);
  return { profiles: count?.n ?? 0, files: files.results.length - failed.length, filesFailed: failed };
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
  const result = await deleteAccount(c.env, user.id);
  await c.env.DB.prepare(`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, detail, created_at)
      VALUES (NULL, 'account.deleted', 'user', ?, ?, ?)`).bind(user.id, JSON.stringify(result), now()).run();
  return c.json({ status: 'deleted', ...result });
});

export default me;
