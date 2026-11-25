// FEATURE 134 — Video comments: one thread per media (whatever screen the video is opened from), top-level comments
// newest first, one level of replies oldest first, likes, delete own, reports through /v1/reports (target 'comment').
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, currentUser, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { loadCards, notify } from '../lib/cards';
import { autoReport, blockState, checkText } from '../lib/moderation';
import { fail, newId, now } from '../lib/util';

const comments = new Hono<AppEnv>();
comments.use('*', requireAuth, requireProfile);

const PAGE = 20;
const REPLIES_PREVIEW = 2;
export const COMMENT_MAX = 1000;

interface CommentRow {
  id: string; media_id: string; author_profile_id: string; parent_id: string | null; reply_to_profile_id: string | null;
  body: string; status: string; likes_count: number; replies_count: number; created_at: number;
  liked?: number;
}

/** The video, if this viewer may see (and so comment on) it: published, public, not blocked either way. */
async function visibleVideo(env: Env, mediaId: string, viewerUserId: string) {
  const m = await env.DB.prepare(`SELECT m.id, m.owner_profile_id, m.review_status, m.comments_count, p.owner_user_id FROM media m
      JOIN profiles p ON p.id = m.owner_profile_id
      WHERE m.id = ? AND m.kind = 'video' AND m.status = 'ready' AND m.is_public = 1 AND m.purpose IN ('portfolio', 'collection', 'intro')
        AND p.status <> 'deleted'`)
    .bind(mediaId).first<{ id: string; owner_profile_id: string; review_status: string; comments_count: number; owner_user_id: string }>();
  if (!m) return null;
  const isOwner = m.owner_user_id === viewerUserId;
  if (!isOwner && m.review_status !== 'approved') return null;
  if (!isOwner && (await blockState(env, viewerUserId, m.owner_user_id)) !== 'none') return null;
  return m;
}

/** Comments whose authors and the viewer haven't blocked each other. */
const notBlockedAuthor = `NOT EXISTS (SELECT 1 FROM profiles ap JOIN blocks b ON (b.blocker_user_id = ap.owner_user_id AND b.blocked_user_id = ?1)
    OR (b.blocker_user_id = ?1 AND b.blocked_user_id = ap.owner_user_id) WHERE ap.id = c.author_profile_id)`;

async function render(env: Env, rows: CommentRow[], viewerProfileId: string) {
  const cards = await loadCards(env, rows.flatMap((r) => [r.author_profile_id, r.reply_to_profile_id ?? '']));
  return rows.map((r) => {
    const removed = r.status !== 'visible';
    return {
      id: r.id, mediaId: r.media_id, parentId: r.parent_id,
      author: removed ? null : cards.get(r.author_profile_id) ?? null,
      replyTo: r.reply_to_profile_id ? { id: r.reply_to_profile_id, displayName: cards.get(r.reply_to_profile_id)?.displayName ?? '' } : null,
      text: removed ? '' : r.body,
      status: r.status,
      likesCount: removed ? 0 : r.likes_count,
      isLiked: !removed && r.liked === 1,
      repliesCount: r.replies_count,
      isOwn: r.author_profile_id === viewerProfileId,
      createdAt: r.created_at,
    };
  });
}

// GET /v1/comments/media/:mediaId?before= — top-level comments, newest first, each with its first replies.
comments.get('/media/:mediaId', async (c) => {
  const user = currentUser(c);
  const profile = actingProfile(c);
  const video = await visibleVideo(c.env, c.req.param('mediaId'), user.id);
  if (!video) fail(404, 'media_not_found');
  const before = Number(c.req.query('before') ?? 0) || Number.MAX_SAFE_INTEGER;
  const rows = await c.env.DB.prepare(`SELECT c.*, EXISTS (SELECT 1 FROM media_comment_likes l WHERE l.comment_id = c.id AND l.profile_id = ?2) AS liked
      FROM media_comments c WHERE c.media_id = ?3 AND c.parent_id IS NULL AND c.created_at < ?4
        AND (c.status = 'visible' OR c.replies_count > 0) AND ${notBlockedAuthor}
      ORDER BY c.created_at DESC LIMIT ?5`)
    .bind(user.id, profile.id, video!.id, before, PAGE + 1).all<CommentRow>();
  const page = rows.results.slice(0, PAGE);
  const replies = page.length
    ? await c.env.DB.prepare(`SELECT * FROM (SELECT c.*, EXISTS (SELECT 1 FROM media_comment_likes l WHERE l.comment_id = c.id AND l.profile_id = ?2) AS liked,
          ROW_NUMBER() OVER (PARTITION BY c.parent_id ORDER BY c.created_at) AS n
          FROM media_comments c WHERE c.parent_id IN (${page.map((_, i) => `?${i + 4}`).join(',')}) AND c.status = 'visible' AND ${notBlockedAuthor})
        WHERE n <= ?3`).bind(user.id, profile.id, REPLIES_PREVIEW, ...page.map((r) => r.id)).all<CommentRow>()
    : { results: [] as CommentRow[] };
  const rendered = await render(c.env, [...page, ...replies.results], profile.id);
  const byId = new Map(rendered.map((r) => [r.id, r]));
  const fresh = await c.env.DB.prepare(`SELECT comments_count FROM media WHERE id = ?`).bind(video!.id).first<{ comments_count: number }>();
  return c.json({
    count: fresh?.comments_count ?? 0,
    items: page.map((r) => ({ ...byId.get(r.id)!, replies: rendered.filter((x) => x.parentId === r.id) })),
    nextBefore: rows.results.length > PAGE ? page[page.length - 1].created_at : null,
  });
});

// GET /v1/comments/:id/replies?after= — a thread's replies, oldest first.
comments.get('/:id/replies', async (c) => {
  const user = currentUser(c);
  const profile = actingProfile(c);
  const parent = await c.env.DB.prepare(`SELECT media_id FROM media_comments WHERE id = ? AND parent_id IS NULL`).bind(c.req.param('id'))
    .first<{ media_id: string }>();
  if (!parent || !(await visibleVideo(c.env, parent.media_id, user.id))) fail(404, 'comment_not_found');
  const after = Number(c.req.query('after') ?? 0) || 0;
  const rows = await c.env.DB.prepare(`SELECT c.*, EXISTS (SELECT 1 FROM media_comment_likes l WHERE l.comment_id = c.id AND l.profile_id = ?2) AS liked
      FROM media_comments c WHERE c.parent_id = ?3 AND c.status = 'visible' AND c.created_at > ?4 AND ${notBlockedAuthor}
      ORDER BY c.created_at LIMIT ?5`).bind(user.id, profile.id, c.req.param('id'), after, PAGE + 1).all<CommentRow>();
  const page = rows.results.slice(0, PAGE);
  return c.json({ items: await render(c.env, page, profile.id),
                  nextAfter: rows.results.length > PAGE ? page[page.length - 1].created_at : null });
});

const CommentBody = z.object({
  text: z.string().max(4000),
  parentId: z.string().max(80).nullable().optional(),
  clientKey: z.string().max(80).optional(),
});

// POST /v1/comments/media/:mediaId {text, parentId?, clientKey?} — a comment, or a reply (a reply to a reply joins its
// thread and names whom it answers). The same clientKey twice is the same comment.
comments.post('/media/:mediaId', async (c) => {
  const user = currentUser(c);
  const profile = actingProfile(c);
  await rateLimit(c, 'RL_WRITE', `comment:${profile.id}`);
  const body = CommentBody.parse(await c.req.json());
  const text = body.text.replace(/\r\n/g, '\n').trim();
  if (!text) fail(422, 'comment_empty');
  if ([...text].length > COMMENT_MAX) fail(422, 'comment_too_long');
  const video = await visibleVideo(c.env, c.req.param('mediaId'), user.id);
  if (!video) fail(404, 'media_not_found');
  if (body.clientKey) {
    const same = await c.env.DB.prepare(`SELECT * FROM media_comments WHERE author_profile_id = ? AND client_key = ?`)
      .bind(profile.id, body.clientKey).first<CommentRow>();
    if (same) return c.json({ comment: (await render(c.env, [same], profile.id))[0], duplicate: true });
  }
  let parentId: string | null = null;
  let replyTo: string | null = null;
  if (body.parentId) {
    const target = await c.env.DB.prepare(`SELECT id, parent_id, author_profile_id, media_id, status FROM media_comments WHERE id = ?`)
      .bind(body.parentId).first<{ id: string; parent_id: string | null; author_profile_id: string; media_id: string; status: string }>();
    if (!target || target.media_id !== video!.id || target.status === 'removed') fail(404, 'comment_not_found');
    parentId = target!.parent_id ?? target!.id;
    replyTo = target!.author_profile_id;
    const owner = await c.env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(replyTo).first<{ owner_user_id: string }>();
    if (owner && (await blockState(c.env, user.id, owner.owner_user_id)) !== 'none') fail(403, 'blocked');
  }
  // Moderation: an obvious threat or spam isn't published; anything else flagged is published and reported for review.
  const verdict = checkText(text);
  if (verdict.categories.includes('violence') || verdict.categories.includes('illegal')) fail(422, 'comment_blocked');
  const id = newId('cmt');
  const t = now();
  const statements = [
    c.env.DB.prepare(`INSERT INTO media_comments (id, media_id, author_profile_id, parent_id, reply_to_profile_id, body, client_key, created_at,
        updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, video!.id, profile.id, parentId, replyTo, text, body.clientKey ?? null, t, t),
    c.env.DB.prepare(`UPDATE media SET comments_count = comments_count + 1 WHERE id = ?`).bind(video!.id),
  ];
  if (parentId) statements.push(c.env.DB.prepare(`UPDATE media_comments SET replies_count = replies_count + 1 WHERE id = ?`).bind(parentId));
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    if (!String(error).includes('UNIQUE') || !body.clientKey) throw error;
    const same = await c.env.DB.prepare(`SELECT * FROM media_comments WHERE author_profile_id = ? AND client_key = ?`)
      .bind(profile.id, body.clientKey).first<CommentRow>();
    return c.json({ comment: (await render(c.env, [same!], profile.id))[0], duplicate: true });
  }
  if (verdict.flagged) {
    await autoReport(c.env, { type: 'comment', id, profileId: profile.id }, verdict, text).catch(() => {});
  }
  // The video's owner hears of a comment; whoever was answered hears of the reply (never of their own words).
  const payload = { mediaId: video!.id, commentId: id, parentId, excerpt: text.slice(0, 120) };
  if (replyTo && replyTo !== profile.id) {
    await notify(c.env, replyTo, 'comment_reply', profile.id, payload, { dedupKey: `comment_reply:${id}`, targetType: 'media', targetId: video!.id });
  }
  if (video!.owner_profile_id !== profile.id && video!.owner_profile_id !== replyTo) {
    await notify(c.env, video!.owner_profile_id, 'new_comment', profile.id, payload,
                 { dedupKey: `new_comment:${id}`, targetType: 'media', targetId: video!.id });
  }
  const row = await c.env.DB.prepare(`SELECT * FROM media_comments WHERE id = ?`).bind(id).first<CommentRow>();
  return c.json({ comment: (await render(c.env, [row!], profile.id))[0] }, 201);
});

// DELETE /v1/comments/:id — one's own comment: gone, or "Comment deleted" in place while it has replies. Idempotent.
comments.delete('/:id', async (c) => {
  const profile = actingProfile(c);
  const row = await c.env.DB.prepare(`SELECT id, media_id, author_profile_id, parent_id, replies_count, status FROM media_comments WHERE id = ?`)
    .bind(c.req.param('id')).first<{ id: string; media_id: string; author_profile_id: string; parent_id: string | null; replies_count: number; status: string }>();
  if (!row || row.status !== 'visible') return c.json({ status: 'deleted' });
  if (row.author_profile_id !== profile.id) fail(403, 'not_comment_author');
  await deleteComment(c.env, row, 'deleted');
  return c.json({ status: 'deleted' });
});

/** Takes a visible comment out (its author's delete, or a moderator's removal) and keeps every count right. */
export async function deleteComment(env: Env, row: { id: string; media_id: string; parent_id: string | null; replies_count: number },
                                    status: 'deleted' | 'removed') {
  const t = now();
  const statements = [env.DB.prepare(`UPDATE media SET comments_count = MAX(comments_count - 1, 0) WHERE id = ?`).bind(row.media_id)];
  if (row.parent_id) {
    statements.push(env.DB.prepare(`UPDATE media_comments SET replies_count = MAX(replies_count - 1, 0) WHERE id = ?`).bind(row.parent_id));
  }
  // With replies it stays as "Comment deleted" (status ≠ visible, body gone); without, the list leaves it out.
  statements.push(env.DB.prepare(`UPDATE media_comments SET status = ?, body = '', updated_at = ? WHERE id = ? AND status = 'visible'`)
    .bind(status, t, row.id));
  statements.push(env.DB.prepare(`DELETE FROM media_comment_likes WHERE comment_id = ?`).bind(row.id));
  await env.DB.batch(statements);
}

// PUT / DELETE /v1/comments/:id/like — idempotent.
comments.put('/:id/like', async (c) => {
  const user = currentUser(c);
  const profile = actingProfile(c);
  const row = await c.env.DB.prepare(`SELECT media_id, status FROM media_comments WHERE id = ?`).bind(c.req.param('id'))
    .first<{ media_id: string; status: string }>();
  if (!row || row.status !== 'visible' || !(await visibleVideo(c.env, row.media_id, user.id))) fail(404, 'comment_not_found');
  const added = await c.env.DB.prepare(`INSERT OR IGNORE INTO media_comment_likes (comment_id, profile_id, created_at) VALUES (?, ?, ?)`)
    .bind(c.req.param('id'), profile.id, now()).run();
  if (added.meta.changes) {
    await c.env.DB.prepare(`UPDATE media_comments SET likes_count = likes_count + 1 WHERE id = ?`).bind(c.req.param('id')).run();
  }
  const fresh = await c.env.DB.prepare(`SELECT likes_count FROM media_comments WHERE id = ?`).bind(c.req.param('id')).first<{ likes_count: number }>();
  return c.json({ isLiked: true, likesCount: fresh?.likes_count ?? 0 });
});

comments.delete('/:id/like', async (c) => {
  const profile = actingProfile(c);
  const removed = await c.env.DB.prepare(`DELETE FROM media_comment_likes WHERE comment_id = ? AND profile_id = ?`)
    .bind(c.req.param('id'), profile.id).run();
  if (removed.meta.changes) {
    await c.env.DB.prepare(`UPDATE media_comments SET likes_count = MAX(likes_count - 1, 0) WHERE id = ?`).bind(c.req.param('id')).run();
  }
  const fresh = await c.env.DB.prepare(`SELECT likes_count FROM media_comments WHERE id = ?`).bind(c.req.param('id')).first<{ likes_count: number }>();
  return c.json({ isLiked: false, likesCount: fresh?.likes_count ?? 0 });
});

export default comments;
