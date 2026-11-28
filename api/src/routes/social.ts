// Notifications, the Reels feed, search, the polling sync endpoint, reports, minimal admin.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { actingProfile, currentUser, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { audit, avatarJoin, card, cardColumns, type CardRow, loadCards, mediaColumns, mediaJSON, type MediaRow } from '../lib/cards';
import { clampLimit, decodeCursor, encodeCursor, fail, newId, now } from '../lib/util';
import { conversationList } from './messages';
import { notBlockedSQL } from '../lib/moderation';
import { jobsJSON } from './jobs';

export const notifications = new Hono<AppEnv>();
notifications.use('*', requireAuth, requireProfile);

/** SQL: the notifications the acting profile sees — its own, and its account's (security, the team's notices). Never
 *  another profile's of the same account, never a message. */
const VISIBLE = `((n.scope = 'profile' AND n.recipient_profile_id = ?1) OR (n.scope = 'account' AND n.recipient_user_id = ?2))
  AND n.type NOT IN ('followed', 'new_message', 'viewed_profile', 'review_request')`;

// GET /v1/notifications?cursor=&filter=unread
notifications.get('/', async (c) => {
  const profile = actingProfile(c);
  const limit = clampLimit(c.req.query('limit'), 30, 60);
  const cursor = decodeCursor<{ t: number; id: string }>(c.req.query('cursor'));
  const unreadOnly = c.req.query('filter') === 'unread';
  const rows = await c.env.DB.prepare(`SELECT n.* FROM notifications n WHERE ${VISIBLE} ${unreadOnly ? 'AND n.read_at IS NULL' : ''}
      AND (?3 IS NULL OR (n.created_at, n.id) < (?3, ?4)) ORDER BY n.created_at DESC, n.id DESC LIMIT ?5`)
    .bind(profile.id, profile.ownerUserId, cursor?.t ?? null, cursor?.id ?? null, limit + 1).all<Record<string, any>>();
  const page = rows.results.slice(0, limit);
  const actors = await loadCards(c.env, page.map((n) => n.actor_profile_id));
  const unread = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM notifications n WHERE ${VISIBLE} AND n.read_at IS NULL`)
    .bind(profile.id, profile.ownerUserId).first<{ n: number }>();
  const last = rows.results.length > limit ? page[page.length - 1] : null;
  const payloads = page.map((n) => JSON.parse(n.payload) as Record<string, any>);
  // The row's trailing piece: the liked video's picture.
  const mediaIds = [...new Set(payloads.map((p) => p.mediaId).filter(Boolean))] as string[];
  const mediaRows = mediaIds.length
    ? await c.env.DB.prepare(`SELECT ${mediaColumns} FROM media m WHERE m.id IN (${mediaIds.map(() => '?').join(',')}) AND m.status = 'ready' AND m.review_status = 'approved'`)
        .bind(...mediaIds).all<MediaRow>() : { results: [] as MediaRow[] };
  const mediaById = new Map(mediaRows.results.map((m) => [m.id, mediaJSON(c.env, m)]));
  // A contact request's own state now (pending → Accept / Decline on the row; accepted / declined / cancelled after).
  const requestIds = [...new Set(page.map((n, i) => (n.type === 'contact_request' ? payloads[i].requestId : null)).filter(Boolean))] as string[];
  const requestRows = requestIds.length
    ? await c.env.DB.prepare(`SELECT id, status FROM contact_requests WHERE recipient_profile_id = ? AND id IN (${requestIds.map(() => '?').join(',')})`)
        .bind(profile.id, ...requestIds).all<{ id: string; status: string }>() : { results: [] as { id: string; status: string }[] };
  const requestStatus = new Map(requestRows.results.map((r) => [r.id, r.status]));
  // Whether a job a row points at still opens (a removed / deleted job shows its state instead of a broken screen).
  const jobIds = [...new Set(page.filter((n) => n.target_type === 'job' || payloads[page.indexOf(n)].jobId)
    .map((n) => n.target_id ?? payloads[page.indexOf(n)].jobId).filter(Boolean))] as string[];
  const liveJobs = jobIds.length
    ? await c.env.DB.prepare(`SELECT id FROM jobs WHERE id IN (${jobIds.map(() => '?').join(',')}) AND status IN ('published', 'closed', 'draft')
        AND COALESCE(review_status, 'approved') NOT IN ('rejected', 'removed')`).bind(...jobIds).all<{ id: string }>()
    : { results: [] as { id: string }[] };
  const liveJobIds = new Set(liveJobs.results.map((j) => j.id));
  return c.json({
    items: page.map((n, i) => {
      const jobId = n.target_type === 'job' ? n.target_id : payloads[i].jobId;
      return {
        id: n.id, type: n.type, scope: n.scope, payload: payloads[i], createdAt: n.created_at, readAt: n.read_at,
        targetType: n.target_type ?? null, targetId: n.target_id ?? null,
        actor: n.actor_profile_id ? actors.get(n.actor_profile_id) ?? null : null,
        media: payloads[i].mediaId ? mediaById.get(payloads[i].mediaId) ?? null : null,
        isFollowingActor: false,
        requestStatus: n.type === 'contact_request' ? requestStatus.get(payloads[i].requestId) ?? 'cancelled' : undefined,
        targetAvailable: jobId ? liveJobIds.has(jobId) : undefined,
      };
    }),
    unreadCount: unread?.n ?? 0,
    nextCursor: last ? encodeCursor({ t: last.created_at, id: last.id }) : null,
  });
});

// GET / PUT /v1/notifications/preferences — FIX 125: the acting profile's Settings → Notifications (each profile its own).
// Defaults: everything on. Saved before the answer — the app shows a switch as saved only after this succeeds.
const PREF_KEYS = ['pushEnabled', 'jobsEnabled', 'contactsEnabled', 'activityEnabled', 'messagesEnabled'] as const;
const prefsJSON = (row: Record<string, number> | null, t: number | null) => ({
  pushEnabled: row ? row.push_enabled === 1 : true, jobsEnabled: row ? row.jobs_enabled === 1 : true,
  contactsEnabled: row ? row.contacts_enabled === 1 : true, activityEnabled: row ? row.activity_enabled === 1 : true,
  messagesEnabled: row ? row.messages_enabled === 1 : true, updatedAt: t,
});
notifications.get('/preferences', async (c) => {
  const profile = actingProfile(c);
  const row = await c.env.DB.prepare(`SELECT * FROM notification_preferences WHERE profile_id = ?`).bind(profile.id)
    .first<Record<string, number>>();
  return c.json(prefsJSON(row, row?.updated_at ?? null));
});
notifications.put('/preferences', async (c) => {
  const profile = actingProfile(c);
  const body = z.object(Object.fromEntries(PREF_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof PREF_KEYS)[number], z.ZodBoolean>)
    .parse(await c.req.json());
  const t = now();
  await c.env.DB.prepare(`INSERT INTO notification_preferences (profile_id, push_enabled, jobs_enabled, contacts_enabled, activity_enabled,
      messages_enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (profile_id) DO UPDATE SET push_enabled = excluded.push_enabled,
      jobs_enabled = excluded.jobs_enabled, contacts_enabled = excluded.contacts_enabled, activity_enabled = excluded.activity_enabled,
      messages_enabled = excluded.messages_enabled, updated_at = excluded.updated_at`)
    .bind(profile.id, Number(body.pushEnabled), Number(body.jobsEnabled), Number(body.contactsEnabled), Number(body.activityEnabled),
          Number(body.messagesEnabled), t).run();
  const row = await c.env.DB.prepare(`SELECT * FROM notification_preferences WHERE profile_id = ?`).bind(profile.id)
    .first<Record<string, number>>();
  return c.json(prefsJSON(row, t));
});

// GET /v1/notifications/unread-by-profile — the account's profiles with something unread (Switch profiles' dot, the
// profile tab's, Settings', Account center's): unread notifications plus (2026-11-28) chats with unread messages
// (muted and hidden chats don't count). Account notices count on every profile, so they're not in these numbers.
notifications.get('/unread-by-profile', async (c) => {
  const profile = actingProfile(c);
  const [rows, chats] = await Promise.all([
    c.env.DB.prepare(`SELECT n.recipient_profile_id AS id, COUNT(*) AS n FROM notifications n
      JOIN profiles p ON p.id = n.recipient_profile_id AND p.owner_user_id = ?1
      WHERE n.scope = 'profile' AND n.recipient_user_id = ?1 AND n.read_at IS NULL
        AND n.type NOT IN ('followed', 'new_message', 'viewed_profile') GROUP BY n.recipient_profile_id`)
      .bind(profile.ownerUserId).all<{ id: string; n: number }>(),
    c.env.DB.prepare(`SELECT cp.profile_id AS id, COUNT(*) AS n FROM conversation_participants cp
      JOIN profiles p ON p.id = cp.profile_id AND p.owner_user_id = ?1 AND p.status = 'active'
      JOIN conversations c ON c.id = cp.conversation_id
      LEFT JOIN conversation_read_state rs ON rs.conversation_id = c.id AND rs.profile_id = cp.profile_id
      WHERE cp.hidden_at IS NULL AND COALESCE(cp.muted, 0) = 0
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_profile_id <> cp.profile_id
          AND m.deleted_at IS NULL AND m.created_at > MAX(COALESCE(rs.last_read_at, 0), COALESCE(cp.cleared_at, 0))
          AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.profile_id = cp.profile_id))
        -- As the chat list: a chat with someone blocked (either way) is hidden, so it doesn't count either.
        AND NOT EXISTS (SELECT 1 FROM conversation_participants o JOIN profiles op ON op.id = o.profile_id
              JOIN blocks b ON (b.blocker_user_id = ?1 AND b.blocked_user_id = op.owner_user_id)
                            OR (b.blocker_user_id = op.owner_user_id AND b.blocked_user_id = ?1)
             WHERE o.conversation_id = c.id AND o.profile_id <> cp.profile_id)
      GROUP BY cp.profile_id`).bind(profile.ownerUserId).all<{ id: string; n: number }>(),
  ]);
  const totals = new Map<string, number>();
  for (const r of [...rows.results, ...chats.results]) totals.set(r.id, (totals.get(r.id) ?? 0) + r.n);
  return c.json({ items: [...totals].map(([profileId, unread]) => ({ profileId, unread })) });
});

notifications.post('/read', async (c) => {
  const profile = actingProfile(c);
  const { ids } = z.object({ ids: z.array(z.string()).max(100) }).parse(await c.req.json());
  if (!ids.length) return c.json({ updated: 0 });
  const res = await c.env.DB.prepare(`UPDATE notifications AS n SET read_at = ?3 WHERE ${VISIBLE} AND n.read_at IS NULL
      AND n.id IN (${ids.map((_, i) => `?${i + 4}`).join(',')})`).bind(profile.id, profile.ownerUserId, now(), ...ids).run();
  return c.json({ updated: res.meta.changes });
});

// DELETE /v1/notifications/:id — the row's long-press Delete (iOS FIX 52).
notifications.delete('/:id', async (c) => {
  const profile = actingProfile(c);
  const res = await c.env.DB.prepare(`DELETE FROM notifications AS n WHERE n.id = ?3 AND ${VISIBLE}`)
    .bind(profile.id, profile.ownerUserId, c.req.param('id')).run();
  if (!res.meta.changes) fail(404, 'notification_not_found');
  return c.json({ status: 'deleted' });
});

// POST /v1/notifications/read-all — this profile's and its account's (never another profile's).
notifications.post('/read-all', async (c) => {
  const profile = actingProfile(c);
  const res = await c.env.DB.prepare(`UPDATE notifications AS n SET read_at = ?3 WHERE ${VISIBLE} AND n.read_at IS NULL`)
    .bind(profile.id, profile.ownerUserId, now()).run();
  return c.json({ updated: res.meta.changes });
});

// ─── Reels: creators' public portfolio videos (an Intro Video opens only from its profile), newest first, cursor by (created_at, id); only what's on screen is fetched.

export const reels = new Hono<AppEnv>();
reels.get('/', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const limit = clampLimit(c.req.query('limit'), 8, 20);
  const cursor = decodeCursor<{ t: number; id: string }>(c.req.query('cursor'));
  const rows = await c.env.DB.prepare(`SELECT ${mediaColumns},
        EXISTS (SELECT 1 FROM likes l WHERE l.media_id = m.id AND l.profile_id = ?1) AS is_liked
      FROM media m JOIN profiles p ON p.id = m.owner_profile_id AND p.status = 'active' AND p.type = 'creator'
      WHERE m.kind = 'video' AND m.purpose = 'portfolio' AND m.status = 'ready' AND m.is_public = 1
        AND m.review_status = 'approved' AND ${notBlockedSQL('p.owner_user_id', '?5')}
        AND (?2 IS NULL OR (m.created_at, m.id) < (?2, ?3))
      ORDER BY m.created_at DESC, m.id DESC LIMIT ?4`)
    .bind(profile.id, cursor?.t ?? null, cursor?.id ?? null, limit + 1, profile.ownerUserId).all<MediaRow & { is_liked: number }>();
  const page = rows.results.slice(0, limit);
  const authors = await loadCards(c.env, page.map((m) => m.owner_profile_id));
  const last = rows.results.length > limit ? page[page.length - 1] : null;
  return c.json({
    items: page.map((m) => mediaJSON(c.env, m, { isLiked: m.is_liked === 1, author: authors.get(m.owner_profile_id) ?? null })),
    nextCursor: last ? encodeCursor({ t: last.created_at, id: last.id }) : null,
  });
});

/** Reels shows at most this many of a creator's latest videos. */
export const REELS_VIDEOS_PER_CREATOR = 10;

// GET /v1/reels/creators?cursor= — the iOS feed: one vertical page per creator, each with its videos (horizontal),
// creators ordered by their latest video; cursor by (latest, id).
reels.get('/creators', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const limit = clampLimit(c.req.query('limit'), 5, 10);
  const cursor = decodeCursor<{ t: number; id: string }>(c.req.query('cursor'));
  const creators = await c.env.DB.prepare(`SELECT p.id, MAX(m.created_at) AS latest FROM profiles p
      JOIN media m ON m.owner_profile_id = p.id AND m.kind = 'video' AND m.purpose = 'portfolio' AND m.status = 'ready' AND m.is_public = 1
        AND m.review_status = 'approved'
      WHERE p.type = 'creator' AND p.status = 'active' AND p.visibility = 'public' AND p.owner_user_id <> ?4
        AND ${notBlockedSQL('p.owner_user_id', '?4')}
      GROUP BY p.id HAVING (?1 IS NULL OR (MAX(m.created_at), p.id) < (?1, ?2))
      ORDER BY latest DESC, p.id DESC LIMIT ?3`).bind(cursor?.t ?? null, cursor?.id ?? null, limit + 1, profile.ownerUserId).all<{ id: string; latest: number }>();
  const page = creators.results.slice(0, limit);
  if (!page.length) return c.json({ items: [], nextCursor: null });
  const ids = page.map((p) => p.id);
  const marks = ids.map(() => '?').join(',');
  const [cards, videos, bios] = await Promise.all([
    loadCards(c.env, ids),
    c.env.DB.prepare(`SELECT ${mediaColumns}, EXISTS (SELECT 1 FROM likes l WHERE l.media_id = m.id AND l.profile_id = ?) AS is_liked
        FROM media m WHERE m.owner_profile_id IN (${marks}) AND m.kind = 'video' AND m.purpose = 'portfolio'
        AND m.status = 'ready' AND m.is_public = 1 AND m.review_status = 'approved' AND m.moderation_status IS NULL
        ORDER BY m.created_at DESC, m.id DESC`).bind(profile.id, ...ids).all<MediaRow & { is_liked: number }>(),
    c.env.DB.prepare(`SELECT id, bio FROM profiles WHERE id IN (${marks})`).bind(...ids).all<{ id: string; bio: string }>(),
  ]);
  // KOLABA has contacts, not follows: each creator's contact state with the viewer (the page's contact button).
  const requests = await c.env.DB.prepare(`SELECT id, status, sender_profile_id, recipient_profile_id FROM contact_requests
      WHERE status IN ('pending', 'accepted') AND ((sender_profile_id = ?1 AND recipient_profile_id IN (${ids.map((_, i) => `?${i + 2}`).join(',')}))
        OR (recipient_profile_id = ?1 AND sender_profile_id IN (${ids.map((_, i) => `?${i + 2}`).join(',')})))`)
    .bind(profile.id, ...ids).all<{ id: string; status: string; sender_profile_id: string; recipient_profile_id: string }>();
  const contactOf = (id: string) => {
    const r = requests.results.find((x) => x.sender_profile_id === id || x.recipient_profile_id === id);
    if (!r) return { relation: 'none', requestId: null };
    if (r.status === 'accepted') return { relation: 'connected', requestId: r.id };
    return { relation: r.sender_profile_id === profile.id ? 'requested' : 'incoming', requestId: r.id };
  };
  const bio = new Map(bios.results.map((b) => [b.id, b.bio]));
  const last = creators.results.length > limit ? page[page.length - 1] : null;
  return c.json({
    items: page.map((p) => ({
      author: cards.get(p.id), bio: bio.get(p.id) ?? '', isFollowing: false, contact: contactOf(p.id),
      // At most the creator's 10 latest videos in the feed (newest first).
      videos: videos.results.filter((v) => v.owner_profile_id === p.id).slice(0, REELS_VIDEOS_PER_CREATOR).map((v) => mediaJSON(c.env, v, { isLiked: v.is_liked === 1 })),
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
    ? (await c.env.DB.prepare(`SELECT ${cardColumns} FROM profiles p ${avatarJoin} WHERE p.type = ?1 AND p.status = 'active'
          AND p.visibility = 'public' AND ${notBlockedSQL('p.owner_user_id', '?3')} AND lower(p.display_name || ' ' || COALESCE(p.category, '') || ' ' ||
          COALESCE(p.city, '') || ' ' || COALESCE(p.country, '')) LIKE ?2 ORDER BY lower(p.display_name) LIMIT 20`)
        .bind(type, like, profile.ownerUserId).all<CardRow>()).results.map((r) => card(c.env, r))
    : [];
  const [creators, businesses, jobRows, contactRows, messageRows] = await Promise.all([
    profilesOf('creator'),
    profilesOf('business'),
    want('jobs') ? c.env.DB.prepare(`SELECT * FROM jobs WHERE status = 'published' AND review_status = 'approved' AND lower(title || ' ' || description || ' ' ||
        location || ' ' || tags) LIKE ? ORDER BY published_at DESC LIMIT 20`).bind(like).all<Record<string, any>>() : null,
    want('contacts') ? c.env.DB.prepare(`SELECT CASE WHEN cr.sender_profile_id = ?1 THEN cr.recipient_profile_id ELSE cr.sender_profile_id END AS id
        FROM contact_requests cr JOIN profiles p ON p.id = CASE WHEN cr.sender_profile_id = ?1 THEN cr.recipient_profile_id ELSE cr.sender_profile_id END
        WHERE cr.status = 'accepted' AND (cr.sender_profile_id = ?1 OR cr.recipient_profile_id = ?1)
          AND lower(p.display_name) LIKE ?2 LIMIT 20`).bind(profile.id, like).all<{ id: string }>() : null,
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
      (SELECT COUNT(*) FROM notifications n WHERE ((n.scope = 'profile' AND n.recipient_profile_id = ?1) OR (n.scope = 'account' AND n.recipient_user_id = ?2))
         AND n.read_at IS NULL AND n.type NOT IN ('followed', 'new_message', 'viewed_profile')) AS notifications,
      (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.profile_id = ?1 AND cp.hidden_at IS NULL AND cp.muted = 0
         AND EXISTS (SELECT 1 FROM messages m LEFT JOIN conversation_read_state rs ON rs.conversation_id = m.conversation_id AND rs.profile_id = ?1
           WHERE m.conversation_id = cp.conversation_id AND m.sender_profile_id <> ?1 AND m.deleted_at IS NULL
             AND m.created_at > COALESCE(rs.last_read_at, 0))) AS conversations,
      (SELECT COUNT(*) FROM contact_requests WHERE recipient_profile_id = ?1 AND status = 'pending') AS contact_requests,
      (SELECT MAX(c.last_message_at) FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id
         AND cp.profile_id = ?1) AS last_message_at`).bind(profile.id, profile.ownerUserId).first<Record<string, number>>();
  return c.json({ unread: { notifications: counts?.notifications ?? 0, conversations: counts?.conversations ?? 0,
                            contactRequests: counts?.contact_requests ?? 0 }, lastMessageAt: counts?.last_message_at ?? null,
                  serverTime: now() });
});

// Messages search shortcut used by the chat list (the user's own messages only).
export async function chatListFor(env: any, profileId: string) {
  return conversationList(env, profileId, 50, null);
}

// Admin: see routes/admin.ts (separate admin accounts and sessions).
