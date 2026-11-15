// JSON shapes shared by every endpoint — built in SQL (one query per list, no N+1).
import type { Env } from '../env';
import { blockedBetweenProfiles, monetizationEnabled } from './moderation';
import { pushToProfile, pushToUser, type PushSetting } from './push';

/** Absolute URL of a media file: external demo URL, or this API's file endpoint for R2 objects. */
export function mediaURL(env: Env, row: { id: string; provider: string; url: string | null }): string | null {
  if (row.provider === 'external') return row.url;
  return `${env.API_URL}/v1/media/${row.id}/file`;
}

/** SQL expression: the profile's published-review rating (unrounded) and count, for profile alias `p`. */
export const ratingColumns = `
  (SELECT AVG((r.quality + r.speed + r.contact) / 3.0) FROM reviews r
    WHERE r.recipient_profile_id = p.id AND r.status = 'published' AND r.review_status = 'approved') AS rating,
  (SELECT COUNT(*) FROM reviews r WHERE r.recipient_profile_id = p.id AND r.status = 'published' AND r.review_status = 'approved') AS reviews_count,
  EXISTS (SELECT 1 FROM subscriptions s WHERE s.profile_id = p.id AND s.status = 'active'
            AND (s.expires_at IS NULL OR s.expires_at > unixepoch() * 1000)) AS is_pro,
  EXISTS (SELECT 1 FROM subscriptions s WHERE s.profile_id = p.id AND s.status = 'active' AND s.source = 'admin'
            AND (s.expires_at IS NULL OR s.expires_at > unixepoch() * 1000)) AS is_pro_grant`;

/** SQL: the avatar's provider/url for profile alias `p`. */
export const avatarColumns = `
  am.id AS avatar_id, am.provider AS avatar_provider, am.url AS avatar_url`;
// Others see an avatar only once a moderator approved it; its owner sees it while it waits (avatarJoinOwner).
export const avatarJoin = `LEFT JOIN media am ON am.id = p.avatar_media_id AND am.status = 'ready' AND am.review_status = 'approved'`;
export const avatarJoinOwner = `LEFT JOIN media am ON am.id = p.avatar_media_id AND am.status = 'ready'
  AND am.review_status IN ('approved', 'pending', 'flagged')`;

export const cardColumns = `p.id, p.type, p.display_name, p.username, p.city, p.country, p.country_code, p.flag,
  p.category, p.is_demo, p.status, ${avatarColumns}, ${ratingColumns}`;

export interface CardRow {
  id: string; type: string; display_name: string; username: string; city: string | null; country: string | null;
  country_code: string | null; flag: string | null; category: string | null; is_demo: number; status: string;
  avatar_id: string | null; avatar_provider: string | null; avatar_url: string | null;
  rating: number | null; reviews_count: number; is_pro: number; is_pro_grant?: number;
}

export function card(env: Env, row: CardRow, prefix = '') {
  const get = <K extends keyof CardRow>(k: K) => (row as unknown as Record<string, unknown>)[prefix + k] as CardRow[K];
  const avatarId = get('avatar_id');
  return {
    id: get('id'),
    type: get('type'),
    displayName: get('display_name'),
    username: get('username'),
    city: get('city'),
    country: get('country'),
    countryCode: get('country_code'),
    flag: get('flag'),
    location: [get('city'), get('country')].filter(Boolean).join(', ') || null,
    category: get('category'),
    avatarUrl: avatarId ? mediaURL(env, { id: avatarId, provider: get('avatar_provider')!, url: get('avatar_url') }) : null,
    rating: get('rating') ?? null,
    reviewsCount: get('reviews_count') ?? 0,
    // Paid plans are off for now (moderation.ts): only PRO an administrator gave shows its badge (FEATURE 115).
    isPro: monetizationEnabled(env) ? get('is_pro') === 1 : get('is_pro_grant') === 1,
    isDemo: get('is_demo') === 1,
  };
}

/** One profile card by id (`asOwner`: the avatar even while it waits for review). */
export async function loadCard(env: Env, id: string, asOwner = false) {
  const row = await env.DB.prepare(`SELECT ${cardColumns} FROM profiles p ${asOwner ? avatarJoinOwner : avatarJoin} WHERE p.id = ?`)
    .bind(id).first<CardRow>();
  return row ? card(env, row) : null;
}

/** Many cards by id, in one query. */
export async function loadCards(env: Env, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, ReturnType<typeof card>>();
  const rows = await env.DB.prepare(
    `SELECT ${cardColumns} FROM profiles p ${avatarJoin} WHERE p.id IN (${unique.map(() => '?').join(',')})`)
    .bind(...unique).all<CardRow>();
  return new Map(rows.results.map((r) => [r.id, card(env, r)]));
}

export interface MediaRow {
  id: string; owner_profile_id: string; kind: string; purpose: string; provider: string; url: string | null;
  fallback_url: string | null; poster_url: string | null; poster_media_id: string | null; mime: string | null;
  width: number | null; height: number | null; duration: number | null; title: string | null; likes_count: number;
  views_count: number; source_provider: string | null; source_url: string | null; license: string | null;
  attribution: string | null; created_at: number; position: number; review_status?: string;
}

export const mediaColumns = `m.id, m.owner_profile_id, m.kind, m.purpose, m.provider, m.url, m.fallback_url, m.poster_url,
  m.poster_media_id, m.mime, m.width, m.height, m.duration, m.title, m.likes_count, m.views_count, m.source_provider,
  m.source_url, m.license, m.attribution, m.created_at, m.position, m.review_status`;

export function mediaJSON(env: Env, m: MediaRow, extra: Record<string, unknown> = {}) {
  return {
    id: m.id,
    ownerProfileId: m.owner_profile_id,
    kind: m.kind,
    purpose: m.purpose,
    url: mediaURL(env, m),
    fallbackUrl: m.fallback_url,
    reviewStatus: m.review_status ?? 'approved',
    posterUrl: m.poster_media_id ? `${env.API_URL}/v1/media/${m.poster_media_id}/file` : m.poster_url,
    mime: m.mime,
    width: m.width,
    height: m.height,
    duration: m.duration,
    title: m.title,
    likesCount: m.likes_count,
    viewsCount: m.views_count,
    source: m.source_provider ? { provider: m.source_provider, url: m.source_url, license: m.license, attribution: m.attribution } : null,
    createdAt: m.created_at,
    ...extra,
  };
}

/** Every notification type the feed knows: what its push says (English until notifications are localized), which
 *  FIX 125 category may silence it (null: mandatory — PRO, moderation, sanctions, security), and whether it pushes at all — not every feed row is worth a push (a saved job's
 *  small edit, a finished background task), and messages are never notifications (Chat, its badge, its own push). */
export const NOTIFICATION_TYPES: Record<string, { body: string; setting: PushSetting | null; push: boolean;
                                                 scope: 'profile' | 'account' }> = {
  // Jobs & Apply
  application_received: { body: 'applied to your job.', setting: 'jobs', push: true, scope: 'profile' },
  saved_job_updated: { body: 'A job you saved has been updated.', setting: 'jobs', push: false, scope: 'profile' },
  saved_job_closed: { body: 'A job you saved is no longer available.', setting: 'jobs', push: false, scope: 'profile' },
  job_removed: { body: 'Your job has been removed.', setting: null, push: true, scope: 'profile' },
  // Contacts
  contact_request: { body: 'sent you a contact request.', setting: 'contacts', push: true, scope: 'profile' },
  contact_accepted: { body: 'accepted your contact request.', setting: 'contacts', push: true, scope: 'profile' },
  // Reviews
  review_request: { body: 'requested a review from you.', setting: 'activity', push: true, scope: 'profile' },
  new_review: { body: 'left you a review.', setting: 'activity', push: true, scope: 'profile' },
  review_rejected: { body: 'Your review could not be published.', setting: null, push: true, scope: 'profile' },
  // Media & content
  liked_video: { body: 'liked your video.', setting: 'activity', push: true, scope: 'profile' },
  video_failed: { body: "Your video couldn't be processed.", setting: 'activity', push: true, scope: 'profile' },
  content_removed: { body: 'Your content was removed.', setting: null, push: true, scope: 'profile' },
  content_restored: { body: 'Your content has been restored.', setting: 'activity', push: false, scope: 'profile' },
  content_approved: { body: 'Your content was approved.', setting: 'activity', push: false, scope: 'profile' },
  report_reviewed: { body: 'Your report has been reviewed.', setting: 'activity', push: false, scope: 'profile' },
  // PRO
  pro_granted: { body: 'Your PRO subscription is active.', setting: null, push: true, scope: 'profile' },
  pro_expired: { body: 'Your PRO subscription has expired.', setting: null, push: true, scope: 'profile' },
  pro_restored: { body: 'Your PRO benefits have been restored.', setting: null, push: true, scope: 'profile' },
  // Account & security (one row for the whole account, never switched off)
  password_changed: { body: 'Your password was changed.', setting: null, push: true, scope: 'account' },
  moderation_warning: { body: 'You received a warning from kolaba.', setting: null, push: true, scope: 'account' },
  moderation_restriction: { body: 'Your account was restricted.', setting: null, push: true, scope: 'account' },
  account_message: { body: 'A message from kolaba.', setting: null, push: true, scope: 'account' },
  profile_message: { body: 'A message from kolaba.', setting: null, push: true, scope: 'profile' },
};

export interface NotifyOptions {
  /** The same key never makes a second row (or push) — a repeated request, retry or webhook. */
  dedupKey?: string;
  targetType?: string;
  targetId?: string;
  /** Overrides the type's preset text (the admin's own words). */
  push?: { title: string; body: string };
  /** Overrides the type's push category (an admin notice in a chosen category; null: mandatory). */
  setting?: PushSetting | null;
}

/** A notification for a PROFILE: a row of its own feed (never another profile's of the same account) and, where APNs
 *  is set up and the type pushes, a push that opens that profile. */
export async function notify(env: Env, recipient: string, type: string, actor: string | null,
                             payload: Record<string, unknown> = {}, options: NotifyOptions = {}) {
  if (!recipient || recipient === actor) return;
  const preset = NOTIFICATION_TYPES[type];
  if (!preset || preset.scope !== 'profile') throw new Error(`not a profile notification: ${type}`);
  // Nothing from someone the recipient blocked (or who blocked them).
  if (actor && (await blockedBetweenProfiles(env, recipient, actor))) return;
  const owner = await env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(recipient).first<{ owner_user_id: string }>();
  if (!owner) return;
  const id = `ntf_${crypto.randomUUID()}`;
  const res = await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, recipient_user_id, recipient_profile_id, scope, type,
        actor_profile_id, target_type, target_id, payload, dedup_key, created_at) VALUES (?, ?, ?, 'profile', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, owner.owner_user_id, recipient, type, actor, options.targetType ?? null, options.targetId ?? null,
          JSON.stringify(payload), options.dedupKey ?? null, Date.now()).run();
  if (!res.meta.changes || !preset.push) return;
  let text = options.push;
  if (!text) {
    const name = actor ? (await env.DB.prepare(`SELECT display_name FROM profiles WHERE id = ?`).bind(actor).first<{ display_name: string }>())
      ?.display_name : null;
    text = name ? { title: name, body: preset.body } : { title: 'kolaba.', body: preset.body };
  }
  await pushToProfile(env, recipient, { ...text, setting: options.setting !== undefined ? options.setting : preset.setting, collapseId: id,
                                        data: { kind: 'notification', type, notificationId: id } });
}

/** A notification for the whole ACCOUNT (security, sanctions, the team's account messages): stored once, shown on
 *  every profile of the account, its push never switched off by the category switches. */
export async function notifyAccount(env: Env, userId: string, type: string, payload: Record<string, unknown> = {},
                                    options: NotifyOptions = {}) {
  const preset = NOTIFICATION_TYPES[type];
  if (!preset || preset.scope !== 'account') throw new Error(`not an account notification: ${type}`);
  const id = `ntf_${crypto.randomUUID()}`;
  const res = await env.DB.prepare(`INSERT OR IGNORE INTO notifications (id, recipient_user_id, recipient_profile_id, scope, type,
        actor_profile_id, target_type, target_id, payload, dedup_key, created_at) VALUES (?, ?, NULL, 'account', ?, NULL, ?, ?, ?, ?, ?)`)
    .bind(id, userId, type, options.targetType ?? null, options.targetId ?? null, JSON.stringify(payload),
          options.dedupKey ?? null, Date.now()).run();
  if (!res.meta.changes || !preset.push) return;
  await pushToUser(env, userId, { ...(options.push ?? { title: 'kolaba.', body: preset.body }), setting: null, collapseId: id,
                                  data: { kind: 'notification', type, notificationId: id } });
}

export async function audit(env: Env, actor: string | null, action: string, entityType: string, entityId: string | null,
                            detail: Record<string, unknown> = {}) {
  await env.DB.prepare(`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, detail, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(actor, action, entityType, entityId, JSON.stringify(detail), Date.now()).run();
}

/** Owner account of a profile. */
export async function ownerOf(env: Env, profileId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(profileId).first<{ owner_user_id: string }>();
  return row?.owner_user_id ?? null;
}

/** May this profile use a PRO feature? While paid plans are off, everyone may (nothing can be bought). */
export async function isPro(env: Env, profileId: string): Promise<boolean> {
  if (!monetizationEnabled(env)) return true;
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM subscriptions WHERE profile_id = ? AND status = 'active'
                                    AND (expires_at IS NULL OR expires_at > ?)`).bind(profileId, Date.now()).first();
  return Boolean(row);
}

export async function areContacts(env: Env, a: string, b: string): Promise<boolean> {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM contact_requests WHERE pair_key = ? AND status = 'accepted'`).bind(key).first();
  return Boolean(row);
}
