// FIX 131: Delete all data — the one erasure an account goes through (Settings → Delete account in the app, and the
// admin panel's Delete account with "Delete all data"). The account and every profile it owns become an anonymous
// tombstone ("Deleted account"): the ids stay, so other people's conversations, the reviews it wrote and the admin job
// history still point somewhere — nothing personal does.
//
// Removed:  e-mail (replaced by an unusable placeholder), password, Google identities, sessions, devices, reset codes,
//           names, username, bio, place, links, social accounts, settings, PRO, contacts, follows, review requests,
//           the reviews it received, its notifications, its applications' text and videos, saved jobs, likes, views,
//           collections, and every file it uploaded (media, posters, chat photos / videos, voice, files, review
//           attachments) — the rows marked unavailable, the R2 objects deleted.
// Kept:     the text of messages it sent (the other side's history, shown under "Deleted account"), reviews it wrote
//           (other people's ratings), its jobs as removed history for the admin (title only), reports it filed (without
//           the reporter), the audit log.
//
// D1 and R2 can't share a transaction: the work is a tracked operation (account_deletions) that can run again — each
// step is idempotent, the files are collected once and each one is marked when removed. Access ends first.
import type { Env } from '../env';
import { newId, now } from './util';

export interface ErasureResult {
  id: string;
  status: 'requested' | 'processing' | 'completed' | 'failed';
  profiles: number;
  filesTotal: number;
  filesDeleted: number;
  filesFailed: number;
  error: string | null;
}

/** Erases `userId` (or carries on with an erasure that stopped). Safe to call again: a completed one is returned as it is. */
export async function eraseAccount(env: Env, userId: string, requestedBy: string): Promise<ErasureResult> {
  const t = now();
  let op = await env.DB.prepare(`SELECT * FROM account_deletions WHERE user_id = ?`).bind(userId).first<Record<string, any>>();
  if (op?.status === 'completed') return resultOf(op, await profileCount(env, userId));
  if (!op) {
    const id = newId('del');
    await env.DB.prepare(`INSERT OR IGNORE INTO account_deletions (id, user_id, requested_by, status, created_at, updated_at)
        VALUES (?, ?, ?, 'requested', ?, ?)`).bind(id, userId, requestedBy, t, t).run();
    op = await env.DB.prepare(`SELECT * FROM account_deletions WHERE user_id = ?`).bind(userId).first<Record<string, any>>();
  }
  const opId = op!.id as string;
  const setStatus = (status: string, extra: Record<string, unknown> = {}) => {
    const cols = Object.keys(extra);
    return env.DB.prepare(`UPDATE account_deletions SET status = ?, updated_at = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`)
      .bind(status, now(), ...cols.map((c) => extra[c]), opId).run();
  };
  try {
    await setStatus('processing', { error: null });
    await endAccess(env, userId);
    await collectFiles(env, userId, opId);
    await anonymize(env, userId);
    await removeFiles(env, opId);
    const counts = await env.DB.prepare(`SELECT COUNT(*) AS total, SUM(deleted_at IS NOT NULL) AS done, SUM(deleted_at IS NULL) AS left
        FROM account_deletion_files WHERE deletion_id = ?`).bind(opId).first<{ total: number; done: number | null; left: number | null }>();
    const left = counts?.left ?? 0;
    await setStatus(left ? 'failed' : 'completed', {
      files_total: counts?.total ?? 0, files_deleted: counts?.done ?? 0, files_failed: left,
      error: left ? `${left} file(s) not removed yet — retry` : null, completed_at: left ? null : now(),
    });
  } catch (error) {
    console.error('account erasure failed', userId, error);
    await setStatus('failed', { error: String(error).slice(0, 500) });
  }
  const final = await env.DB.prepare(`SELECT * FROM account_deletions WHERE id = ?`).bind(opId).first<Record<string, any>>();
  return resultOf(final!, await profileCount(env, userId));
}

/** The erasure of an account, as the admin panel shows it (null: never erased). */
export async function erasureOf(env: Env, userId: string): Promise<ErasureResult | null> {
  const op = await env.DB.prepare(`SELECT * FROM account_deletions WHERE user_id = ?`).bind(userId).first<Record<string, any>>();
  return op ? resultOf(op, await profileCount(env, userId)) : null;
}

function resultOf(op: Record<string, any>, profiles: number): ErasureResult {
  return { id: op.id, status: op.status, profiles, filesTotal: op.files_total ?? 0, filesDeleted: op.files_deleted ?? 0,
           filesFailed: op.files_failed ?? 0, error: op.error ?? null };
}

async function profileCount(env: Env, userId: string) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM profiles WHERE owner_user_id = ?`).bind(userId).first<{ n: number }>())?.n ?? 0;
}

const run = (env: Env, userId: string, statements: string[]) =>
  // D1 rejects a binding a statement doesn't use: only the ones naming ?1 get the id.
  env.DB.batch(statements.map((sql) => (sql.includes('?1') ? env.DB.prepare(sql).bind(userId) : env.DB.prepare(sql))));

/** Step 1 — sign-in and every session end, the e-mail and identities go (a new sign-up is a new account from now on). */
async function endAccess(env: Env, userId: string) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET status = 'deleted', erased_at = COALESCE(erased_at, ?2), deleted_at = COALESCE(deleted_at, ?2),
        email = 'erased+' || id || '@users.kolaba.invalid', released_email = NULL, password_hash = NULL, password_salt = NULL,
        password_scheme = NULL, email_verified_at = NULL, updated_at = ?2 WHERE id = ?1`).bind(userId, t),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM device_tokens WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM auth_identities WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM email_codes WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM password_reset_tokens WHERE user_id = ?`).bind(userId),
  ]);
}

/** Step 2 — every R2 object the account owns, listed before any row changes (so a retry still knows them). Only files of
 *  its own profiles: something another person sent to it stays theirs. */
async function collectFiles(env: Env, userId: string, opId: string) {
  const P = `(SELECT id FROM profiles WHERE owner_user_id = ?1)`;
  await env.DB.prepare(`INSERT OR IGNORE INTO account_deletion_files (deletion_id, storage_key)
      SELECT ?2, storage_key FROM media WHERE owner_profile_id IN ${P} AND provider = 'r2' AND storage_key IS NOT NULL
      UNION SELECT ?2, storage_key FROM message_voice WHERE message_id IN (SELECT id FROM messages WHERE sender_profile_id IN ${P})
      UNION SELECT ?2, storage_key FROM message_files WHERE message_id IN (SELECT id FROM messages WHERE sender_profile_id IN ${P})
      UNION SELECT ?2, attachment_key FROM feedback WHERE user_id = ?1 AND attachment_key IS NOT NULL`).bind(userId, opId).run();
}

/** Step 3 — the rows: personal data removed, the ids kept as the "Deleted account" tombstone. */
async function anonymize(env: Env, userId: string) {
  const P = `(SELECT id FROM profiles WHERE owner_user_id = ?1)`;
  const M = `(SELECT id FROM media WHERE owner_profile_id IN ${P})`;
  const J = `(SELECT id FROM jobs WHERE owner_profile_id IN ${P})`;
  const SENT = `(SELECT id FROM messages WHERE sender_profile_id IN ${P})`;
  await run(env, userId, [
    // Files: unavailable everywhere (chat bubbles keep their place and show "Media unavailable").
    `UPDATE media SET status = 'deleted', deleted_at = COALESCE(deleted_at, CAST(strftime('%s','now') AS INTEGER) * 1000),
       url = NULL, poster_url = NULL, fallback_url = NULL, title = NULL, source_url = NULL, attribution = NULL
       WHERE owner_profile_id IN ${P}`,
    `UPDATE message_voice SET erased_at = COALESCE(erased_at, CAST(strftime('%s','now') AS INTEGER) * 1000) WHERE message_id IN ${SENT}`,
    `UPDATE message_files SET erased_at = COALESCE(erased_at, CAST(strftime('%s','now') AS INTEGER) * 1000), name = 'File'
       WHERE message_id IN ${SENT}`,
    `DELETE FROM likes WHERE profile_id IN ${P} OR media_id IN ${M}`,
    `DELETE FROM media_views WHERE viewer_profile_id IN ${P} OR media_id IN ${M}`,
    `DELETE FROM collection_items WHERE media_id IN ${M} OR collection_id IN (SELECT id FROM collections WHERE owner_profile_id IN ${P})`,
    `DELETE FROM collections WHERE owner_profile_id IN ${P}`,
    // Chats: the messages' text stays for the other side; its own reactions, read marks and hidden marks go.
    `DELETE FROM message_reactions WHERE profile_id IN ${P}`,
    `DELETE FROM message_hidden WHERE profile_id IN ${P}`,
    `DELETE FROM conversation_read_state WHERE profile_id IN ${P}`,
    // Jobs: off the feed for good (removed), kept for the admin's history with their title only; their media go.
    `UPDATE jobs SET status = 'removed', description = '', closed_at = COALESCE(closed_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
       WHERE owner_profile_id IN ${P}`,
    `DELETE FROM job_media WHERE job_id IN ${J}`,
    `DELETE FROM saved_jobs WHERE profile_id IN ${P} OR job_id IN ${J}`,
    `DELETE FROM job_views WHERE viewer_user_id = ?1 OR job_id IN ${J}`,
    // Its applications: withdrawn, their text and chosen videos gone (the businesses' lists drop them).
    `DELETE FROM application_media WHERE application_id IN (SELECT id FROM applications WHERE creator_profile_id IN ${P})`,
    `UPDATE applications SET status = 'withdrawn', message = '', shortlisted_at = NULL,
       withdrawn_at = COALESCE(withdrawn_at, CAST(strftime('%s','now') AS INTEGER) * 1000) WHERE creator_profile_id IN ${P}`,
    // People and reviews.
    `DELETE FROM contact_requests WHERE sender_profile_id IN ${P} OR recipient_profile_id IN ${P}`,
    `DELETE FROM follows WHERE follower_profile_id IN ${P} OR followee_profile_id IN ${P}`,
    `DELETE FROM review_requests WHERE requester_profile_id IN ${P} OR contact_profile_id IN ${P}`,
    `DELETE FROM review_invites WHERE owner_profile_id IN ${P} OR accepted_by_profile_id IN ${P}`,
    `DELETE FROM review_media WHERE review_id IN (SELECT id FROM reviews WHERE recipient_profile_id IN ${P})`,
    `DELETE FROM reviews WHERE recipient_profile_id IN ${P}`,
    `DELETE FROM notifications WHERE recipient_user_id = ?1 OR recipient_profile_id IN ${P}`,
    `DELETE FROM notification_preferences WHERE profile_id IN ${P}`,
    `UPDATE reports SET reporter_user_id = NULL, reporter_profile_id = NULL WHERE reporter_user_id = ?1 OR reporter_profile_id IN ${P}`,
    `DELETE FROM blocks WHERE blocker_user_id = ?1 OR blocked_user_id = ?1`,
    `DELETE FROM feedback WHERE user_id = ?1`,
    // Plans and settings.
    `DELETE FROM pro_grants WHERE profile_id IN ${P}`,
    `DELETE FROM subscriptions WHERE profile_id IN ${P}`,
    `DELETE FROM usage_events WHERE user_id = ?1`,
    `DELETE FROM profile_links WHERE profile_id IN ${P}`,
    `DELETE FROM profile_social_accounts WHERE profile_id IN ${P}`,
    `DELETE FROM profile_settings WHERE profile_id IN ${P}`,
    `DELETE FROM user_settings WHERE user_id = ?1`,
    // The tombstone: every profile "Deleted account", nothing personal left.
    `UPDATE profiles SET status = 'deleted', erased_at = COALESCE(erased_at, CAST(strftime('%s','now') AS INTEGER) * 1000),
       display_name = 'Deleted account', username = 'deleted_' || lower(substr(id, -12)) || '_' || lower(hex(randomblob(3))),
       avatar_media_id = NULL, intro_video_media_id = NULL, bio = '', category = NULL, country_code = NULL, country = NULL,
       city = NULL, flag = NULL, languages = '[]', website = NULL, admin_hidden_at = NULL,
       updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
       WHERE owner_user_id = ?1 AND erased_at IS NULL`,
  ]);
}

/** Step 4 — the R2 objects, one by one; each removed one is marked (a retry skips it, a failure is recorded). */
async function removeFiles(env: Env, opId: string) {
  if (!env.MEDIA) return;
  const pending = await env.DB.prepare(`SELECT storage_key FROM account_deletion_files WHERE deletion_id = ? AND deleted_at IS NULL`)
    .bind(opId).all<{ storage_key: string }>();
  const keys = pending.results.map((r) => r.storage_key);
  // R2 deletes up to 1 000 keys in one call.
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    try {
      await env.MEDIA.delete(chunk);
      const t = now();
      await env.DB.batch(chunk.map((key) => env.DB.prepare(`UPDATE account_deletion_files SET deleted_at = ?, error = NULL
          WHERE deletion_id = ? AND storage_key = ?`).bind(t, opId, key)));
    } catch (error) {
      const message = String(error).slice(0, 200);
      await env.DB.batch(chunk.map((key) => env.DB.prepare(`UPDATE account_deletion_files SET error = ?
          WHERE deletion_id = ? AND storage_key = ?`).bind(message, opId, key)));
    }
  }
}
