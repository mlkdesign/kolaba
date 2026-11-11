// Profiles: one creator + up to five business profiles per account; catalog, public page, edit, deactivate.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, currentUser, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { avatarJoin, avatarJoinOwner, card, cardColumns, type CardRow, isPro, loadCard, mediaColumns, mediaJSON, type MediaRow } from '../lib/cards';
import { assertCanPost, autoReport, checkText, monetizationEnabled, notBlockedSQL, visibleMediaSQL } from '../lib/moderation';
import { clampLimit, decodeCursor, encodeCursor, fail, newId, now, parseJSON } from '../lib/util';

const profiles = new Hono<AppEnv>();
export const MAX_BUSINESS_PROFILES = 5;

/** The account's profiles (creator first), each with its entitlements. */
export async function profilesOf(env: Env, userId: string) {
  const rows = await env.DB.prepare(`SELECT ${cardColumns} FROM profiles p ${avatarJoinOwner}
      WHERE p.owner_user_id = ? AND p.status <> 'deleted' ORDER BY p.type = 'business', p.created_at`).bind(userId).all<CardRow>();
  return rows.results.map((r) => ({ ...card(env, r),
    entitlements: entitlements(r.type as 'creator' | 'business', r.is_pro === 1, monetizationEnabled(env), r.is_pro_grant === 1) }));
}

/** What a profile may do (AccountCapabilities in the iOS app), decided here. */
export function entitlements(type: 'creator' | 'business', subscribed: boolean, monetization: boolean, granted = false) {
  // While paid plans are off every feature is open (there is nothing to buy); only PRO an administrator gave is shown
  // as PRO (FEATURE 115) — never a paywall.
  const pro = monetization ? subscribed : true;
  return {
    plan: type === 'creator' ? 'creator_pro' : 'business_pro',
    isPro: monetization ? subscribed : granted,
    monetizationEnabled: monetization,
    canCreateJobs: type === 'business',
    canApply: type === 'creator',
    canAttachMediaToApplications: type === 'creator' && pro,
    hasPortfolio: type === 'creator',
    collections: type !== 'creator' ? 'unavailable' : pro ? 'available' : 'locked',
    introVideo: type !== 'creator' ? 'unavailable' : pro ? 'available' : 'locked',
  };
}

const Username = z.string().trim().toLowerCase().regex(/^[a-z0-9._]{3,30}$/, 'invalid_username');
const Links = z.record(z.enum(['instagram', 'tiktok', 'youtube', 'telegram', 'whatsapp', 'website', 'email']),
  z.string().trim().max(300)).optional();
const ProfileFields = z.object({
  displayName: z.string().trim().min(1).max(80),
  // FIX 114: no usernames in KOLABA — still accepted from an old client, never required (internal key = profile id).
  username: Username.optional(),
  bio: z.string().max(1000).optional(),
  category: z.string().trim().max(60).nullable().optional(),
  country: z.string().trim().max(60).nullable().optional(),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable().optional(),
  city: z.string().trim().max(60).nullable().optional(),
  languages: z.array(z.string().regex(/^[a-z]{2,3}$/)).max(10).optional(),
  website: z.string().trim().max(300).nullable().optional(),
  links: Links,
  visibility: z.enum(['public', 'private']).optional(),
  settings: z.object({
    showLocation: z.boolean().optional(),
    whoCanMessage: z.enum(['everyone', 'contacts', 'nobody']).optional(),
    showLinks: z.boolean().optional(),
    hideJobPosts: z.boolean().optional(),
  }).optional(),
});

const flagOf = (code?: string | null) =>
  code && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((ch) => 127397 + ch.charCodeAt(0))) : null;

function safeURL(raw: string): string | null {
  const text = raw.includes('://') || raw.startsWith('mailto:') ? raw : `https://${raw}`;
  try {
    const url = new URL(text);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function saveLinks(env: Env, profileId: string, links: Record<string, string> | undefined) {
  if (!links) return;
  const statements = [env.DB.prepare(`DELETE FROM profile_links WHERE profile_id = ?`).bind(profileId)];
  Object.entries(links).forEach(([kind, raw], i) => {
    if (!raw) return;
    const url = safeURL(raw) ?? fail(422, 'invalid_link');
    statements.push(env.DB.prepare(`INSERT INTO profile_links (id, profile_id, kind, url, position) VALUES (?, ?, ?, ?, ?)`)
      .bind(newId('lnk'), profileId, kind, url, i));
  });
  await env.DB.batch(statements);
}

// POST /v1/profiles — create a creator or business profile for the signed-in account.
profiles.post('/', requireAuth, async (c) => {
  const user = currentUser(c);
  await rateLimit(c, 'RL_WRITE', `profile:${user.id}`);
  const body = ProfileFields.extend({ type: z.enum(['creator', 'business']) }).parse(await c.req.json());
  // One creator and up to five business profiles per account, whatever the plan. The limit is checked inside the INSERT
  // itself, so two requests at once (two devices) can't both pass it.
  const id = newId(body.type === 'creator' ? 'cr' : 'bz');
  const limit = body.type === 'creator' ? 1 : MAX_BUSINESS_PROFILES;
  const [inserted] = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO profiles (id, owner_user_id, type, display_name, username, bio, category, country, country_code,
                      city, flag, languages, website, created_at, updated_at)
                      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
                      WHERE (SELECT COUNT(*) FROM profiles WHERE owner_user_id = ?2 AND type = ?3 AND status <> 'deleted') < ?16`)
      // The username column stays (old links) but a new profile's is its own id: unique, never shown, never asked for.
      .bind(id, user.id, body.type, body.displayName, id, body.bio ?? '', body.category ?? null, body.country ?? null,
            body.countryCode ?? null, body.city ?? null, flagOf(body.countryCode), JSON.stringify(body.languages ?? []),
            body.website ? safeURL(body.website) : null, now(), now(), limit),
    c.env.DB.prepare(`INSERT INTO profile_settings (profile_id) SELECT ?1 WHERE EXISTS (SELECT 1 FROM profiles WHERE id = ?1)`).bind(id),
  ]);
  if (!inserted.meta.changes) fail(409, body.type === 'creator' ? 'creator_profile_exists' : 'business_profile_limit');
  await saveLinks(c.env, id, body.links);
  const verdict = checkText(body.displayName, body.bio);
  if (verdict.flagged) await autoReport(c.env, { type: 'user', id, profileId: id }, verdict, `${body.displayName}\n${body.bio ?? ''}`);
  return c.json(await loadCard(c.env, id, true), 201);
});

// PATCH /v1/profiles/:id — the owner edits; only the given fields change.
profiles.patch('/:id', requireAuth, async (c) => {
  const user = currentUser(c);
  const id = c.req.param('id');
  const owner = await c.env.DB.prepare(`SELECT owner_user_id, status FROM profiles WHERE id = ?`).bind(id)
    .first<{ owner_user_id: string; status: string }>();
  if (!owner || owner.owner_user_id !== user.id || owner.status === 'deleted') fail(403, 'not_profile_owner');
  const body = ProfileFields.partial().extend({
    avatarMediaId: z.string().nullable().optional(),
    introVideoMediaId: z.string().nullable().optional(),
  }).parse(await c.req.json());

  for (const [field, purpose] of [['avatarMediaId', 'photo'], ['introVideoMediaId', 'video']] as const) {
    const mediaId = body[field];
    if (!mediaId) continue;
    const media = await c.env.DB.prepare(`SELECT owner_profile_id, kind, status FROM media WHERE id = ?`).bind(mediaId)
      .first<{ owner_profile_id: string; kind: string; status: string }>();
    if (!media || media.owner_profile_id !== id || media.kind !== purpose || media.status !== 'ready') fail(422, 'media_not_found');
  }
  if (body.introVideoMediaId) {
    const type = (await c.env.DB.prepare(`SELECT type FROM profiles WHERE id = ?`).bind(id).first<{ type: string }>())!.type;
    if (type !== 'creator') fail(403, 'creator_profile_required');
    if (!(await isPro(c.env, id))) fail(403, 'pro_required');
  }

  const columns: Record<string, unknown> = {
    display_name: body.displayName, bio: body.bio, category: body.category, country: body.country,
    country_code: body.countryCode, city: body.city, flag: body.countryCode !== undefined ? flagOf(body.countryCode) : undefined,
    languages: body.languages ? JSON.stringify(body.languages) : undefined,
    website: body.website !== undefined ? (body.website ? safeURL(body.website) : null) : undefined,
    visibility: body.visibility, avatar_media_id: body.avatarMediaId, intro_video_media_id: body.introVideoMediaId,
  };
  // A business replacing its logo: the previous photo is retired (one photo only — FEATURE 19).
  const previous = body.avatarMediaId ? await c.env.DB.prepare(`SELECT type, avatar_media_id FROM profiles WHERE id = ?`).bind(id)
    .first<{ type: string; avatar_media_id: string | null }>() : null;
  if (body.bio !== undefined || body.displayName !== undefined) {
    const verdict = checkText(body.displayName, body.bio);
    if (verdict.flagged) {
      await autoReport(c.env, { type: 'user', id, profileId: id }, verdict, `${body.displayName ?? ''}\n${body.bio ?? ''}`);
    }
  }
  const set = Object.entries(columns).filter(([, v]) => v !== undefined);
  if (set.length) {
    await c.env.DB.prepare(`UPDATE profiles SET ${set.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...set.map(([, v]) => v), now(), id).run();
  }
  if (previous?.type === 'business' && previous.avatar_media_id && previous.avatar_media_id !== body.avatarMediaId) {
    const old = await c.env.DB.prepare(`SELECT storage_key FROM media WHERE id = ? AND owner_profile_id = ? AND purpose = 'avatar'`)
      .bind(previous.avatar_media_id, id).first<{ storage_key: string | null }>();
    if (old) {
      await c.env.DB.prepare(`UPDATE media SET status = 'deleted' WHERE id = ?`).bind(previous.avatar_media_id).run();
      if (old.storage_key && c.env.MEDIA) await c.env.MEDIA.delete(old.storage_key).catch(() => {});
    }
  }
  if (body.settings) {
    const s = body.settings;
    await c.env.DB.prepare(`UPDATE profile_settings SET show_location = COALESCE(?, show_location),
        who_can_message = COALESCE(?, who_can_message), show_links = COALESCE(?, show_links),
        hide_job_posts = COALESCE(?, hide_job_posts) WHERE profile_id = ?`)
      .bind(s.showLocation === undefined ? null : Number(s.showLocation), s.whoCanMessage ?? null,
            s.showLinks === undefined ? null : Number(s.showLinks), s.hideJobPosts === undefined ? null : Number(s.hideJobPosts), id).run();
  }
  await saveLinks(c.env, id, body.links);
  return c.json(await profilePage(c.env, id, user.id));
});

// DELETE /v1/profiles/:id — deactivate (soft). The account's last profile can't be removed.
profiles.delete('/:id', requireAuth, async (c) => {
  const user = currentUser(c);
  const id = c.req.param('id');
  const owned = await c.env.DB.prepare(`SELECT COUNT(*) AS n, SUM(id = ?) AS mine FROM profiles WHERE owner_user_id = ? AND status <> 'deleted'`)
    .bind(id, user.id).first<{ n: number; mine: number }>();
  if (!owned?.mine) fail(403, 'not_profile_owner');
  if (owned!.n <= 1) fail(409, 'last_profile');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE profiles SET status = 'deleted', updated_at = ? WHERE id = ?`).bind(now(), id),
    c.env.DB.prepare(`UPDATE jobs SET status = 'closed', closed_at = ? WHERE owner_profile_id = ? AND status = 'published'`).bind(now(), id),
    c.env.DB.prepare(`UPDATE contact_requests SET status = 'cancelled' WHERE status = 'pending'
                      AND (sender_profile_id = ? OR recipient_profile_id = ?)`).bind(id, id),
  ]);
  return c.json({ status: 'deactivated' });
});

// GET /v1/profiles?type=creator&q=&cursor= — the catalog (public profiles), keyset by name.
profiles.get('/', async (c) => {
  const type = c.req.query('type');
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 60);
  const limit = clampLimit(c.req.query('limit'), 24);
  const cursor = decodeCursor<{ n: string; id: string }>(c.req.query('cursor'));
  const rows = await c.env.DB.prepare(`SELECT ${cardColumns}, p.bio AS bio FROM profiles p ${avatarJoin}
      JOIN users u ON u.id = p.owner_user_id AND u.status = 'active'
      WHERE p.status = 'active' AND p.visibility = 'public'
        AND (?1 IS NULL OR p.type = ?1)
        AND (?2 = '' OR lower(p.display_name || ' ' || COALESCE(p.category, '') || ' ' ||
             COALESCE(p.city, '') || ' ' || COALESCE(p.country, '')) LIKE '%' || ?2 || '%')
        AND (?3 IS NULL OR (lower(p.display_name), p.id) > (?3, ?4))
        AND (?6 IS NULL OR ${notBlockedSQL('p.owner_user_id', '?6')})
      ORDER BY lower(p.display_name), p.id LIMIT ?5`)
    .bind(type === 'creator' || type === 'business' ? type : null, q, cursor?.n ?? null, cursor?.id ?? null, limit + 1,
          c.get('user')?.id ?? null).all<CardRow & { bio: string | null }>();
  const items = rows.results.slice(0, limit).map((r) => ({ ...card(c.env, r), bio: r.bio ?? '' }));
  const last = rows.results.length > limit ? rows.results[limit - 1] : null;
  return c.json({ items, nextCursor: last ? encodeCursor({ n: last.display_name.toLowerCase(), id: last.id }) : null });
});

/** A profile page: card + bio, links, social figures, intro video, figures, ratings; private parts for the owner. */
export async function profilePage(env: Env, id: string, viewerUserId: string | null) {
  const p = await env.DB.prepare(`SELECT p.*, s.show_location, s.who_can_message, s.show_links, s.hide_job_posts
      FROM profiles p LEFT JOIN profile_settings s ON s.profile_id = p.id
      WHERE p.id = ?1 OR (p.username = ?1 AND NOT EXISTS (SELECT 1 FROM profiles x WHERE x.id = ?1))`).bind(id)
    .first<Record<string, any>>();
  if (!p || p.status === 'deleted') fail(404, 'profile_not_found');
  id = p!.id; // an old /profile/<username> link: the profile's own id from here on
  const isOwner = p!.owner_user_id === viewerUserId;
  if (!isOwner && p!.status !== 'active') fail(404, 'profile_not_found');
  const base = (await loadCard(env, id, isOwner))!;
  const [links, social, ratings, intro, counts] = await Promise.all([
    env.DB.prepare(`SELECT kind, url FROM profile_links WHERE profile_id = ? ORDER BY position`).bind(id).all<{ kind: string; url: string }>(),
    env.DB.prepare(`SELECT platform, handle, followers FROM profile_social_accounts WHERE profile_id = ?`).bind(id).all(),
    env.DB.prepare(`SELECT AVG((quality + speed + contact) / 3.0) AS rating, AVG(quality) AS quality, AVG(speed) AS speed,
                    AVG(contact) AS contact, COUNT(*) AS count FROM reviews WHERE recipient_profile_id = ? AND status = 'published' AND review_status = 'approved'`)
      .bind(id).first(),
    p!.intro_video_media_id
      ? env.DB.prepare(`SELECT ${mediaColumns} FROM media m WHERE m.id = ? AND m.status = 'ready'
          AND ${isOwner ? "m.review_status IN ('approved', 'pending', 'flagged')" : "m.review_status = 'approved'"}`)
          .bind(p!.intro_video_media_id).first<MediaRow>()
      : Promise.resolve(null),
    env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM media WHERE owner_profile_id = ?1 AND purpose = 'portfolio' AND status = 'ready' AND review_status = 'approved') AS portfolio,
        (SELECT COUNT(*) FROM jobs WHERE owner_profile_id = ?1 AND status = 'published') AS jobs,
        (SELECT COUNT(*) FROM contact_requests WHERE status = 'accepted' AND (sender_profile_id = ?1 OR recipient_profile_id = ?1)) AS contacts,
        (SELECT COALESCE(SUM(likes_count), 0) FROM media WHERE owner_profile_id = ?1 AND status = 'ready' AND review_status = 'approved') AS likes`)
      .bind(id).first(),
  ]);
  const showLocation = isOwner || p!.show_location === 1;
  const showLinks = isOwner || p!.show_links === 1;
  return {
    ...base,
    city: showLocation ? base.city : null,
    country: showLocation ? base.country : null,
    location: showLocation ? base.location : null,
    bio: p!.bio,
    website: p!.website,
    languages: parseJSON<string[]>(p!.languages, []),
    links: showLinks ? links.results : [],
    socialAccounts: social.results,
    ratings,
    counts,
    introVideo: intro ? mediaJSON(env, intro) : null,
    hideJobPosts: p!.hide_job_posts === 1,
    visibility: p!.visibility,
    isOwner,
    settings: isOwner ? { showLocation: p!.show_location === 1, whoCanMessage: p!.who_can_message, showLinks: p!.show_links === 1,
                          hideJobPosts: p!.hide_job_posts === 1 } : undefined,
    entitlements: isOwner ? entitlements(p!.type, await isSubscribed(env, id), monetizationEnabled(env), await isSubscribed(env, id, true)) : undefined,
  };
}

// GET /v1/profiles/:id
profiles.get('/:id', async (c) => c.json(await profilePage(c.env, c.req.param('id'), c.get('user')?.id ?? null)));

// GET /v1/profiles/:id/media?purpose=portfolio&kind=video — a profile's public media grid, newest first. Others see
// approved items only; the owner also sees what waits for review (reviewStatus pending / flagged → "Pending review").
profiles.get('/:id/media', async (c) => {
  const id = c.req.param('id');
  const purpose = c.req.query('purpose') ?? 'portfolio';
  const kind = c.req.query('kind');
  const isOwner = await ownedByViewer(c.env, id, c.get('user')?.id);
  const rows = await c.env.DB.prepare(`SELECT ${mediaColumns} FROM media m WHERE m.owner_profile_id = ?1 AND m.purpose = ?2
      AND m.status = 'ready' AND m.is_public = 1 AND (?3 IS NULL OR m.kind = ?3) AND ${visibleMediaSQL('m', isOwner ? '?1' : undefined)}
      ORDER BY m.position, m.created_at DESC LIMIT 100`)
    .bind(id, purpose, kind === 'photo' || kind === 'video' ? kind : null).all<MediaRow>();
  return c.json({ items: rows.results.map((m) => mediaJSON(c.env, m)) });
});

// GET /v1/profiles/:id/collections — public collections (the owner sees private ones too) with covers and counts.
profiles.get('/:id/collections', async (c) => {
  const id = c.req.param('id');
  const isOwner = c.get('user') ? (await c.env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(id)
    .first<{ owner_user_id: string }>())?.owner_user_id === c.get('user')!.id : false;
  const rows = await c.env.DB.prepare(`SELECT col.*, (SELECT COUNT(*) FROM collection_items ci JOIN media m ON m.id = ci.media_id
        AND m.status = 'ready' AND ${visibleMediaSQL('m', isOwner ? 'col.owner_profile_id' : undefined)} WHERE ci.collection_id = col.id) AS items_count,
      COALESCE(col.cover_media_id, (SELECT ci.media_id FROM collection_items ci WHERE ci.collection_id = col.id ORDER BY ci.position LIMIT 1)) AS cover_id
      FROM collections col WHERE col.owner_profile_id = ? AND (? OR col.visibility = 'public') ORDER BY col.sort_order, col.created_at`)
    .bind(id, isOwner ? 1 : 0).all<Record<string, any>>();
  const coverIds = rows.results.map((r) => r.cover_id).filter(Boolean);
  const covers = coverIds.length
    ? await c.env.DB.prepare(`SELECT ${mediaColumns} FROM media m WHERE m.id IN (${coverIds.map(() => '?').join(',')})
        AND ${isOwner ? "m.review_status IN ('approved', 'pending', 'flagged')" : "m.review_status = 'approved'"}`)
        .bind(...coverIds).all<MediaRow>()
    : { results: [] as MediaRow[] };
  const coverMap = new Map(covers.results.map((m) => [m.id, mediaJSON(c.env, m)]));
  return c.json({ items: rows.results.map((r) => ({ id: r.id, title: r.title, description: r.description, visibility: r.visibility,
                                                   itemsCount: r.items_count, cover: r.cover_id ? coverMap.get(r.cover_id) ?? null : null })) });
});

// POST /v1/profiles/:id/view — counts a profile view and tells its owner (once per viewer per day).
profiles.post('/:id/view', requireAuth, requireProfile, async (c) => {
  const viewer = actingProfile(c);
  const id = c.req.param('id');
  if (viewer.id === id) return c.json({ ok: true });
  const owner = await c.env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(id).first<{ owner_user_id: string }>();
  if (!owner || owner.owner_user_id === viewer.ownerUserId) return c.json({ ok: true });
  const recent = await c.env.DB.prepare(`SELECT 1 AS ok FROM notifications WHERE recipient_profile_id = ? AND actor_profile_id = ?
      AND type = 'viewed_profile' AND created_at > ?`).bind(id, viewer.id, now() - 86_400_000).first();
  if (!recent) {
    await c.env.DB.prepare(`INSERT INTO notifications (id, recipient_profile_id, type, actor_profile_id, payload, created_at)
                            VALUES (?, ?, 'viewed_profile', ?, '{}', ?)`).bind(newId('ntf'), id, viewer.id, now()).run();
  }
  return c.json({ ok: true });
});

// GET /v1/profiles/:id/jobs — a business's published jobs (hidden by its privacy switch for others).
profiles.get('/:id/jobs', requireAuth, requireProfile, async (c) => {
  const viewer = actingProfile(c);
  const id = c.req.param('id');
  const owner = await c.env.DB.prepare(`SELECT p.owner_user_id, COALESCE(s.hide_job_posts, 0) AS hidden FROM profiles p
      LEFT JOIN profile_settings s ON s.profile_id = p.id WHERE p.id = ?`).bind(id).first<{ owner_user_id: string; hidden: number }>();
  if (!owner) fail(404, 'profile_not_found');
  const isOwner = owner!.owner_user_id === viewer.ownerUserId;
  if (owner!.hidden && !isOwner) return c.json({ items: [], hidden: true });
  const rows = await c.env.DB.prepare(`SELECT * FROM jobs WHERE owner_profile_id = ? AND ${isOwner ? "status <> 'removed'" : "status = 'published'"}
      ORDER BY COALESCE(published_at, created_at) DESC LIMIT 50`).bind(id).all<Record<string, any>>();
  const { jobsJSON } = await import('./jobs');
  return c.json({ items: await jobsJSON(c.env, rows.results, viewer.id) });
});

// FIX 114: KOLABA has mutual contacts only — the old one-directional follow is gone (410 for an old client).
profiles.all('/:id/follow', (c) => c.json({ error: { code: 'follows_removed', message: 'Use contacts.' } }, 410));

export default profiles;

async function isSubscribed(env: Env, profileId: string, adminGrantOnly = false): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM subscriptions WHERE profile_id = ? AND status = 'active'
      AND (expires_at IS NULL OR expires_at > ?) AND (? = 0 OR source = 'admin')`).bind(profileId, now(), adminGrantOnly ? 1 : 0).first();
  return Boolean(row);
}

async function ownedByViewer(env: Env, profileId: string, userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const row = await env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(profileId).first<{ owner_user_id: string }>();
  return row?.owner_user_id === userId;
}
