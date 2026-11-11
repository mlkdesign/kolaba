// JSON shapes shared by every endpoint — built in SQL (one query per list, no N+1).
import type { Env } from '../env';
import { blockedBetweenProfiles, monetizationEnabled } from './moderation';
import { pushToProfile, type PushContent } from './push';

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

/** What a feed notification says on the lock screen (FEATURE 115; English until notifications are localized). */
const PUSH_TEXT: Record<string, { body: string; setting: PushContent['setting'] }> = {
  contact_request: { body: 'wants to add you to contacts.', setting: 'followersAndMentions' },
  contact_accepted: { body: 'accepted your contact request.', setting: 'followersAndMentions' },
  new_review: { body: 'left you a review.', setting: 'projectUpdates' },
  review_request: { body: 'asked you for a review.', setting: 'projectUpdates' },
  liked_video: { body: 'liked your video.', setting: 'followersAndMentions' },
  application_received: { body: 'applied to your job.', setting: 'newApplications' },
};

/** A notification for a profile: a row of its Notifications feed and, where APNs is set up, a push. Messages are not
 *  notifications (they live in Chat, its badge and their own push — messages.ts). */
export async function notify(env: Env, recipient: string, type: string, actor: string | null, payload: Record<string, unknown> = {},
                             push?: { title: string; body: string }) {
  if (!recipient || recipient === actor) return;
  // Nothing from someone the recipient blocked (or who blocked them).
  if (actor && (await blockedBetweenProfiles(env, recipient, actor))) return;
  const id = `ntf_${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO notifications (id, recipient_profile_id, type, actor_profile_id, payload, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, recipient, type, actor, JSON.stringify(payload), Date.now()).run();
  const preset = PUSH_TEXT[type];
  let text = push;
  if (!text && preset) {
    const name = actor ? (await env.DB.prepare(`SELECT display_name FROM profiles WHERE id = ?`).bind(actor).first<{ display_name: string }>())
      ?.display_name : null;
    text = { title: name ?? 'kolaba.', body: preset.body };
  }
  if (text) {
    await pushToProfile(env, recipient, { ...text, setting: preset?.setting ?? null, collapseId: id,
                                          data: { kind: 'notification', type, notificationId: id } });
  }
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
