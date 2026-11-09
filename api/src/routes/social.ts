// Notifications, the Reels feed, search, the polling sync endpoint, reports, minimal admin.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { actingProfile, currentUser, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { audit, avatarJoin, card, cardColumns, type CardRow, loadCards, mediaColumns, mediaJSON, type MediaRow } from '../lib/cards';
import { clampLimit, decodeCursor, encodeCursor, fail, newId, now } from '../lib/util';
import { conversationList } from './messages';
import { jobsJSON } from './jobs';

export const notifications = new Hono<AppEnv>();
notifications.use('*', requireAuth, requireProfile);

// GET /v1/notifications?cursor=
notifications.get('/', async (c) => {
  const profile = actingProfile(c);
  const limit = clampLimit(c.req.query('limit'), 30, 60);
  const cursor = decodeCursor<{ t: number; id: string }>(c.req.query('cursor'));
  const rows = await c.env.DB.prepare(`SELECT * FROM notifications WHERE recipient_profile_id = ?1
      AND (?2 IS NULL OR (created_at, id) < (?2, ?3)) ORDER BY created_at DESC, id DESC LIMIT ?4`)
    .bind(profile.id, cursor?.t ?? null, cursor?.id ?? null, limit + 1).all<Record<string, any>>();
  const page = rows.results.slice(0, limit);
  const actors = await loadCards(c.env, page.map((n) => n.actor_profile_id));
  const unread = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_profile_id = ? AND read_at IS NULL`)
    .bind(profile.id).first<{ n: number }>();
  const last = rows.results.length > limit ? page[page.length - 1] : null;
  // The row's trailing piece (NotificationsView): the liked video's picture, and whether the actor is followed.
  const payloads = page.map((n) => JSON.parse(n.payload) as Record<string, any>);
  const mediaIds = [...new Set(payloads.map((p) => p.mediaId).filter(Boolean))] as string[];
  const actorIds = [...new Set(page.map((n) => n.actor_profile_id).filter(Boolean))] as string[];
  const [mediaRows, followRows] = await Promise.all([
    mediaIds.length ? c.env.DB.prepare(`SELECT ${mediaColumns} FROM media m WHERE m.id IN (${mediaIds.map(() => '?').join(',')}) AND m.status = 'ready'`)
      .bind(...mediaIds).all<MediaRow>() : Promise.resolve({ results: [] as MediaRow[] }),
    actorIds.length ? c.env.DB.prepare(`SELECT followee_profile_id AS id FROM follows WHERE follower_profile_id = ? AND followee_profile_id IN (${actorIds.map(() => '?').join(',')})`)
      .bind(profile.id, ...actorIds).all<{ id: string }>() : Promise.resolve({ results: [] as { id: string }[] }),
  ]);
  const mediaById = new Map(mediaRows.results.map((m) => [m.id, mediaJSON(c.env, m)]));
  const followed = new Set(followRows.results.map((r) => r.id));
  return c.json({
    items: page.map((n, i) => ({ id: n.id, type: n.type, payload: payloads[i], createdAt: n.created_at, readAt: n.read_at,
                              actor: n.actor_profile_id ? actors.get(n.actor_profile_id) ?? null : null,
                              media: payloads[i].mediaId ? mediaById.get(payloads[i].mediaId) ?? null : null,
                              isFollowingActor: n.actor_profile_id ? followed.has(n.actor_profile_id) : false })),
    unreadCount: unread?.n ?? 0,
    nextCursor: last ? encodeCursor({ t: last.created_at, id: last.id }) : null,
  });
});

notifications.post('/read', async (c) => {
  const profile = actingProfile(c);
  const { ids } = z.object({ ids: z.array(z.string()).max(100) }).parse(await c.req.json());
  if (!ids.length) return c.json({ updated: 0 });
  const res = await c.env.DB.prepare(`UPDATE notifications SET read_at = ? WHERE recipient_profile_id = ? AND read_at IS NULL
      AND id IN (${ids.map(() => '?').join(',')})`).bind(now(), profile.id, ...ids).run();
  return c.json({ updated: res.meta.changes });
});

// DELETE /v1/notifications/:id — the row's long-press Delete (iOS FIX 52).
notifications.delete('/:id', async (c) => {
  const profile = actingProfile(c);
  const res = await c.env.DB.prepare(`DELETE FROM notifications WHERE id = ? AND recipient_profile_id = ?`).bind(c.req.param('id'), profile.id).run();
  if (!res.meta.changes) fail(404, 'notification_not_found');
  return c.json({ status: 'deleted' });
});

notifications.post('/read-all', async (c) => {
  const profile = actingProfile(c);
  const res = await c.env.DB.prepare(`UPDATE notifications SET read_at = ? WHERE recipient_profile_id = ? AND read_at IS NULL`)
    .bind(now(), profile.id).run();
  return c.json({ updated: res.meta.changes });
});

// ─── Reels: creators' public videos, newest first, cursor by (created_at, id); only what's on screen is fetched.

export const reels = new Hono<AppEnv>();
reels.get('/', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const limit = clampLimit(c.req.query('limit'), 8, 20);
  const cursor = decodeCursor<{ t: number; id: string }>(c.req.query('cursor'));
  const rows = await c.env.DB.prepare(`SELECT ${mediaColumns},
        EXISTS (SELECT 1 FROM likes l WHERE l.media_id = m.id AND l.profile_id = ?1) AS is_liked
      FROM media m JOIN profiles p ON p.id = m.owner_profile_id AND p.status = 'active' AND p.type = 'creator'
      WHERE m.kind = 'video' AND m.purpose IN ('portfolio', 'intro') AND m.status = 'ready' AND m.is_public = 1
        AND (?2 IS NULL OR (m.created_at, m.id) < (?2, ?3))
      ORDER BY m.created_at DESC, m.id DESC LIMIT ?4`)
    .bind(profile.id, cursor?.t ?? null, cursor?.id ?? null, limit + 1).all<MediaRow & { is_liked: number }>();
  const page = rows.results.slice(0, limit);
  const authors = await loadCards(c.env, page.map((m) => m.owner_profile_id));
  const last = rows.results.length > limit ? page[page.length - 1] : null;
  return c.json({
    items: page.map((m) => mediaJSON(c.env, m, { isLiked: m.is_liked === 1, author: authors.get(m.owner_profile_id) ?? null })),
    nextCursor: last ? encodeCursor({ t: last.created_at, id: last.id }) : null,
  });
});

// GET /v1/reels/creators?cursor= — the iOS feed: one vertical page per creator, each with its videos (horizontal),
// creators ordered by their latest video; cursor by (latest, id).
reels.get('/creators', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const limit = clampLimit(c.req.query('limit'), 5, 10);
  const cursor = decodeCursor<{ t: number; id: string }>(c.req.query('cursor'));
  const creators = await c.env.DB.prepare(`SELECT p.id, MAX(m.created_at) AS latest FROM profiles p
      JOIN media m ON m.owner_profile_id = p.id AND m.kind = 'video' AND m.purpose IN ('portfolio', 'intro') AND m.status = 'ready' AND m.is_public = 1
      WHERE p.type = 'creator' AND p.status = 'active' AND p.visibility = 'public'
      GROUP BY p.id HAVING (?1 IS NULL OR (MAX(m.created_at), p.id) < (?1, ?2))
      ORDER BY latest DESC, p.id DESC LIMIT ?3`).bind(cursor?.t ?? null, cursor?.id ?? null, limit + 1).all<{ id: string; latest: number }>();
  const page = creators.results.slice(0, limit);
  if (!page.length) return c.json({ items: [], nextCursor: null });
  const ids = page.map((p) => p.id);
  const marks = ids.map(() => '?').join(',');
  const [cards, videos, follows, bios] = await Promise.all([
    loadCards(c.env, ids),
    c.env.DB.prepare(`SELECT ${mediaColumns}, EXISTS (SELECT 1 FROM likes l WHERE l.media_id = m.id AND l.profile_id = ?) AS is_liked
        FROM media m WHERE m.owner_profile_id IN (${marks}) AND m.kind = 'video' AND m.purpose IN ('portfolio', 'intro')
        AND m.status = 'ready' AND m.is_public = 1 ORDER BY m.position, m.created_at DESC`).bind(profile.id, ...ids).all<MediaRow & { is_liked: number }>(),
    c.env.DB.prepare(`SELECT followee_profile_id FROM follows WHERE follower_profile_id = ? AND followee_profile_id IN (${marks})`)
      .bind(profile.id, ...ids).all<{ followee_profile_id: string }>(),
    c.env.DB.prepare(`SELECT id, bio FROM profiles WHERE id IN (${marks})`).bind(...ids).all<{ id: string; bio: string }>(),
  ]);
  const followed = new Set(follows.results.map((f) => f.followee_profile_id));
  const bio = new Map(bios.results.map((b) => [b.id, b.bio]));
  const last = creators.results.length > limit ? page[page.length - 1] : null;
  return c.json({
    items: page.map((p) => ({
      author: cards.get(p.id), bio: bio.get(p.id) ?? '', isFollowing: followed.has(p.id),
      videos: videos.results.filter((v) => v.owner_profile_id === p.id).slice(0, 10).map((v) => mediaJSON(c.env, v, { isLiked: v.is_liked === 1 })),
    })),
    nextCursor: last ? encodeCursor({ t: last.latest, id: last.id }) : null,
  });
});

// ─── Search: creators, businesses, jobs, the user's contacts and messages (never other people's private data).

export const search = new Hono<AppEnv>();
search.get('/', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 60);
  const scope = c.req.query('scope') ?? 'all';
  if (q.length < 2) return c.json({ creators: [], businesses: [], jobs: [], contacts: [], messages: [] });
  const like = `%${q}%`;
  const want = (s: string) => scope === 'all' || scope === s;
  const profilesOf = async (type: string) => want(`${type}s`)
    ? (await c.env.DB.prepare(`SELECT ${cardColumns} FROM profiles p ${avatarJoin} WHERE p.type = ? AND p.status = 'active'
          AND p.visibility = 'public' AND lower(p.display_name || ' ' || p.username || ' ' || COALESCE(p.category, '') || ' ' ||
          COALESCE(p.city, '') || ' ' || COALESCE(p.country, '')) LIKE ? ORDER BY lower(p.display_name) LIMIT 20`)
        .bind(type, like).all<CardRow>()).results.map((r) => card(c.env, r))
    : [];
  const [creators, businesses, jobRows, contactRows, messageRows] = await Promise.all([
    profilesOf('creator'),
    profilesOf('business'),
    want('jobs') ? c.env.DB.prepare(`SELECT * FROM jobs WHERE status = 'published' AND lower(title || ' ' || description || ' ' ||
        location || ' ' || tags) LIKE ? ORDER BY published_at DESC LIMIT 20`).bind(like).all<Record<string, any>>() : null,
    want('contacts') ? c.env.DB.prepare(`SELECT CASE WHEN cr.sender_profile_id = ?1 THEN cr.recipient_profile_id ELSE cr.sender_profile_id END AS id
        FROM contact_requests cr JOIN profiles p ON p.id = CASE WHEN cr.sender_profile_id = ?1 THEN cr.recipient_profile_id ELSE cr.sender_profile_id END
        WHERE cr.status = 'accepted' AND (cr.sender_profile_id = ?1 OR cr.recipient_profile_id = ?1)
          AND lower(p.display_name || ' ' || p.username) LIKE ?2 LIMIT 20`).bind(profile.id, like).all<{ id: string }>() : null,
    want('messages') ? c.env.DB.prepare(`SELECT m.id, m.conversation_id, m.body, m.created_at, m.sender_profile_id FROM messages m
        JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.profile_id = ?1
        WHERE m.deleted_at IS NULL AND lower(m.body) LIKE ?2 ORDER BY m.created_at DESC LIMIT 20`).bind(profile.id, like)
      .all<Record<string, any>>() : null,
  ]);
  const extra = await loadCards(c.env, [...(contactRows?.results.map((r) => r.id) ?? []), ...(messageRows?.results.map((m) => m.sender_profile_id) ?? [])]);
  return c.json({
    creators, businesses,
    jobs: jobRows ? await jobsJSON(c.env, jobRows.results, profile.id) : [],
    contacts: contactRows?.results.map((r) => extra.get(r.id)).filter(Boolean) ?? [],
    messages: messageRows?.results.map((m) => ({ id: m.id, conversationId: m.conversation_id, body: m.body, createdAt: m.created_at,
                                                 sender: extra.get(m.sender_profile_id) ?? null })) ?? [],
  });
});

// ─── Sync: one cheap poll for badges and the chat list (the client polls adaptively; no per-second polling).

export const sync = new Hono<AppEnv>();
sync.get('/', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const counts = await c.env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM notifications WHERE recipient_profile_id = ?1 AND read_at IS NULL) AS notifications,
      (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.profile_id = ?1 AND cp.hidden_at IS NULL AND cp.muted = 0
         AND EXISTS (SELECT 1 FROM messages m LEFT JOIN conversation_read_state rs ON rs.conversation_id = m.conversation_id AND rs.profile_id = ?1
           WHERE m.conversation_id = cp.conversation_id AND m.sender_profile_id <> ?1 AND m.deleted_at IS NULL
             AND m.created_at > COALESCE(rs.last_read_at, 0))) AS conversations,
      (SELECT COUNT(*) FROM contact_requests WHERE recipient_profile_id = ?1 AND status = 'pending') AS contact_requests,
      (SELECT MAX(c.last_message_at) FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id
         AND cp.profile_id = ?1) AS last_message_at`).bind(profile.id).first<Record<string, number>>();
  return c.json({ unread: { notifications: counts?.notifications ?? 0, conversations: counts?.conversations ?? 0,
                            contactRequests: counts?.contact_requests ?? 0 }, lastMessageAt: counts?.last_message_at ?? null,
                  serverTime: now() });
});

// Messages search shortcut used by the chat list (the user's own messages only).
export async function chatListFor(env: any, profileId: string) {
  return conversationList(env, profileId, 50, null);
}

// ─── Reports ───

export const reports = new Hono<AppEnv>();
reports.post('/', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  await rateLimit(c, 'RL_WRITE', `report:${profile.ownerUserId}`);
  const body = z.object({ targetType: z.enum(['profile', 'media', 'job', 'message', 'review']), targetId: z.string().max(80),
                          reason: z.enum(['spam', 'scam', 'inappropriate', 'harassment', 'other']), details: z.string().max(1000).optional() })
    .parse(await c.req.json());
  const id = newId('rep');
  await c.env.DB.prepare(`INSERT INTO reports (id, reporter_profile_id, target_type, target_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, profile.id, body.targetType, body.targetId, body.reason, body.details ?? null, now()).run();
  return c.json({ id, status: 'open' }, 201);
});

// ─── Admin (role admin / moderator), every action audited ───

export const admin = new Hono<AppEnv>();
admin.use('*', requireAuth, async (c, next) => {
  const user = currentUser(c);
  if (user.role === 'user') fail(403, 'admin_required');
  await next();
});

admin.get('/reports', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 100`).all();
  return c.json({ items: rows.results });
});

admin.post('/users/:id/status', async (c) => {
  const user = currentUser(c);
  if (user.role !== 'admin') fail(403, 'admin_forbidden');
  const { status, reason } = z.object({ status: z.enum(['active', 'suspended']), reason: z.string().min(3) }).parse(await c.req.json());
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ? AND is_demo = 0`).bind(status, now(), c.req.param('id')),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(status === 'suspended' ? c.req.param('id') : ''),
  ]);
  await audit(c.env, user.id, 'user.status', 'user', c.req.param('id'), { status, reason });
  return c.json({ status });
});

admin.post('/profiles/:id/pro', async (c) => {
  const user = currentUser(c);
  if (user.role !== 'admin') fail(403, 'admin_forbidden');
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
  const p = await c.env.DB.prepare(`SELECT type FROM profiles WHERE id = ?`).bind(c.req.param('id')).first<{ type: string }>();
  if (!p) fail(404, 'profile_not_found');
  await c.env.DB.prepare(`UPDATE subscriptions SET status = 'cancelled' WHERE profile_id = ? AND status = 'active'`).bind(c.req.param('id')).run();
  if (enabled) {
    await c.env.DB.prepare(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at) VALUES (?, ?, ?, 'active', 'test', ?)`)
      .bind(newId('sub'), c.req.param('id'), p!.type === 'creator' ? 'creator_pro' : 'business_pro', now()).run();
  }
  await audit(c.env, user.id, 'profile.pro', 'profile', c.req.param('id'), { enabled });
  return c.json({ isPro: enabled });
});

// Remove a test (non-demo) account's data entirely.
admin.delete('/users/:id', async (c) => {
  const user = currentUser(c);
  if (user.role !== 'admin') fail(403, 'admin_forbidden');
  const res = await c.env.DB.prepare(`DELETE FROM users WHERE id = ? AND is_demo = 0 AND role = 'user'`).bind(c.req.param('id')).run();
  await audit(c.env, user.id, 'user.delete', 'user', c.req.param('id'), { deleted: res.meta.changes });
  return c.json({ deleted: res.meta.changes });
});
