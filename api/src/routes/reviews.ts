// Open reviews (FIX 114: any signed-in account, no contact needed); Request a Review; external invite links (server tokens, expiry, one use).
import { Hono } from 'hono';
import { autoReport, blockedBetweenProfiles, checkText } from '../lib/moderation';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, clientIP, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { isPro, loadCard, loadCards, mediaColumns, mediaJSON, type MediaRow, notify, ownerOf } from '../lib/cards';
import { signedMediaURL } from './media';
import { clampLimit, fail, newId, newToken, now, pairKey, sha256Hex } from '../lib/util';

const reviews = new Hono<AppEnv>();

export const REVIEW_MEDIA_LIMIT = 10;

/** FIX 128: the media a business attached to its reviews of a creator — shown only while that creator has PRO (checked
 *  here, on the server); otherwise none are sent at all (the files and their links are kept, and show again with PRO).
 *  Private files: short-lived signed URLs, never a storage path. */
async function reviewMedia(env: Env, recipientProfileId: string, reviewIds: string[]) {
  const byReview = new Map<string, ReturnType<typeof mediaJSON>[]>();
  if (!reviewIds.length || !(await isPro(env, recipientProfileId))) return byReview;
  const rows = await env.DB.prepare(`SELECT rm.review_id, ${mediaColumns} FROM review_media rm JOIN media m ON m.id = rm.media_id
      AND m.status = 'ready' AND m.review_status NOT IN ('rejected', 'removed')
      WHERE rm.review_id IN (${reviewIds.map(() => '?').join(',')}) ORDER BY rm.position, m.id`)
    .bind(...reviewIds).all<MediaRow & { review_id: string }>();
  for (const m of rows.results) {
    const json = mediaJSON(env, m);
    if (m.provider === 'r2') json.url = await signedMediaURL(env, m.id);
    if (m.poster_media_id) json.posterUrl = await signedMediaURL(env, m.poster_media_id);
    byReview.set(m.review_id, [...(byReview.get(m.review_id) ?? []), json]);
  }
  return byReview;
}

/** Media a business may attach to a review: its own ready private uploads (`purpose: 'review'`), not yet on a review,
 *  at most 10 photos and videos together, and only about a creator with PRO. */
async function checkReviewMedia(env: Env, authorId: string, authorType: string, recipientId: string, mediaIds: string[]) {
  const unique = [...new Set(mediaIds)];
  if (!unique.length) return unique;
  if (unique.length > REVIEW_MEDIA_LIMIT) fail(422, 'too_many_media');
  if (authorType !== 'business') fail(403, 'business_profile_required');
  const recipient = await env.DB.prepare(`SELECT type FROM profiles WHERE id = ?`).bind(recipientId).first<{ type: string }>();
  if (recipient?.type !== 'creator' || !(await isPro(env, recipientId))) fail(403, 'recipient_pro_required');
  const owned = await env.DB.prepare(`SELECT COUNT(*) AS n FROM media m WHERE m.owner_profile_id = ? AND m.status = 'ready'
      AND m.purpose = 'chat' AND m.is_public = 0 AND m.id IN (${unique.map(() => '?').join(',')})
      AND NOT EXISTS (SELECT 1 FROM review_media rm WHERE rm.media_id = m.id)`).bind(authorId, ...unique).first<{ n: number }>();
  if (owned?.n !== unique.length) fail(422, 'media_not_found');
  return unique;
}

async function hasReviewed(env: Env, authorUserId: string, recipient: string) {
  return Boolean(await env.DB.prepare(`SELECT 1 AS ok FROM reviews WHERE author_user_id = ? AND recipient_profile_id = ? AND status = 'published'`)
    .bind(authorUserId, recipient).first());
}

/** ReviewPermissions.canReview on the server. Only the other kind reviews: a creator a business, a business a creator
 *  (never creator → creator, never business → business). */
async function checkCanReview(env: Env, author: string, authorUser: string, recipient: string) {
  if (author === recipient || (await ownerOf(env, recipient)) === authorUser) fail(403, 'self_review');
  const types = await env.DB.prepare(`SELECT id, type FROM profiles WHERE id IN (?, ?)`).bind(author, recipient).all<{ id: string; type: string }>();
  const typeOf = new Map(types.results.map((r) => [r.id, r.type]));
  if (typeOf.get(author) && typeOf.get(author) === typeOf.get(recipient)) fail(403, 'same_profile_type');
  if (await blockedBetweenProfiles(env, author, recipient)) fail(403, 'blocked');
  if (await hasReviewed(env, authorUser, recipient)) fail(409, 'already_reviewed');
}

// GET /v1/reviews?profileId=&sort=newest|oldest|highest|lowest — published reviews + summary.
reviews.get('/', async (c) => {
  const profileId = c.req.query('profileId') ?? fail(400, 'profile_required');
  const order = { oldest: 'r.created_at ASC', highest: '(r.quality + r.speed + r.contact) DESC, r.created_at DESC',
                  lowest: '(r.quality + r.speed + r.contact) ASC, r.created_at DESC' }[c.req.query('sort') ?? ''] ?? 'r.created_at DESC';
  const limit = clampLimit(c.req.query('limit'), 30, 100);
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0);
  const [rows, summary] = await Promise.all([
    c.env.DB.prepare(`SELECT r.* FROM reviews r WHERE r.recipient_profile_id = ? AND r.status = 'published' AND r.review_status = 'approved' ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(profileId, limit, offset).all<Record<string, any>>(),
    c.env.DB.prepare(`SELECT AVG((quality + speed + contact) / 3.0) AS rating, AVG(quality) AS quality, AVG(speed) AS speed,
        AVG(contact) AS contact, COUNT(*) AS count FROM reviews WHERE recipient_profile_id = ? AND status = 'published'
        AND review_status = 'approved'`).bind(profileId).first(),
  ]);
  const [authors, media] = await Promise.all([loadCards(c.env, rows.results.map((r) => r.author_profile_id)),
                                              reviewMedia(c.env, profileId, rows.results.map((r) => r.id))]);
  return c.json({
    summary,
    items: rows.results.map((r) => ({ id: r.id, quality: r.quality, speed: r.speed, contact: r.contact, comment: r.comment,
      rating: (r.quality + r.speed + r.contact) / 3, createdAt: r.created_at, author: authors.get(r.author_profile_id) ?? null,
      authorProfileId: r.author_profile_id, media: media.get(r.id) ?? [] })),
  });
});

// POST /v1/reviews — as the acting profile, about any other account's active profile (no contact needed).
reviews.post('/', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  await rateLimit(c, 'RL_WRITE', `review:${profile.ownerUserId}`);
  const body = z.object({
    recipientProfileId: z.string(), quality: z.number().int().min(1).max(5), speed: z.number().int().min(1).max(5),
    contact: z.number().int().min(1).max(5), comment: z.string().trim().min(1).max(2000),
    requestId: z.string().optional(), inviteId: z.string().optional(),
    mediaIds: z.array(z.string()).max(REVIEW_MEDIA_LIMIT).default([]),
  }).parse(await c.req.json());
  const recipient = await c.env.DB.prepare(`SELECT status FROM profiles WHERE id = ?`).bind(body.recipientProfileId).first<{ status: string }>();
  if (!recipient || recipient.status !== 'active') fail(404, 'profile_not_found');
  await checkCanReview(c.env, profile.id, profile.ownerUserId, body.recipientProfileId);
  if (body.inviteId) {
    const invite = await c.env.DB.prepare(`SELECT status FROM review_invites WHERE id = ? AND owner_profile_id = ? AND accepted_by_profile_id = ?`)
      .bind(body.inviteId, body.recipientProfileId, profile.id).first<{ status: string }>();
    if (!invite) fail(404, 'invalid_invite');
    if (invite!.status !== 'active') fail(409, 'invite_used');
  }
  const mediaIds = await checkReviewMedia(c.env, profile.id, profile.type, body.recipientProfileId, body.mediaIds);
  const id = newId('rev');
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO reviews (id, author_profile_id, author_user_id, recipient_profile_id, quality, speed, contact, comment,
          request_id, invite_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, profile.id, profile.ownerUserId, body.recipientProfileId, body.quality, body.speed, body.contact, body.comment,
              body.requestId ?? null, body.inviteId ?? null, now()),
      c.env.DB.prepare(`UPDATE review_requests SET status = 'completed', completed_at = ? WHERE status = 'pending'
          AND requester_profile_id = ? AND contact_profile_id = ?`).bind(now(), body.recipientProfileId, profile.id),
      c.env.DB.prepare(`UPDATE review_invites SET status = 'used', used_at = ? WHERE id = ? AND status = 'active'`).bind(now(), body.inviteId ?? ''),
      ...mediaIds.map((mid, i) => c.env.DB.prepare(`INSERT INTO review_media (review_id, media_id, uploaded_by_profile_id, position, created_at)
          VALUES (?, ?, ?, ?, ?)`).bind(id, mid, profile.id, i, now())),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) fail(409, 'already_reviewed');
    throw error;
  }
  // A review whose text the automatic check flags waits for a moderator before it is shown.
  const verdict = checkText(body.comment);
  if (verdict.flagged) {
    await c.env.DB.prepare(`UPDATE reviews SET review_status = 'flagged', review_reason = ? WHERE id = ?`)
      .bind(verdict.reasons.join(', ').slice(0, 300), id).run();
    await autoReport(c.env, { type: 'review', id, profileId: profile.id }, verdict, body.comment);
    return c.json({ id, reviewStatus: 'flagged' }, 201);
  }
  await notify(c.env, body.recipientProfileId, 'new_review', profile.id, { reviewId: id },
               { dedupKey: `new_review:${id}`, targetType: 'review', targetId: id });
  return c.json({ id, reviewStatus: 'approved' }, 201);
});

/** The review, if the signed-in person wrote it (from any of their profiles). */
async function ownReview(env: Env, id: string, userId: string) {
  const review = await env.DB.prepare(`SELECT id, author_profile_id, author_user_id, recipient_profile_id FROM reviews
      WHERE id = ? AND status = 'published'`).bind(id).first<{ id: string; author_profile_id: string; author_user_id: string; recipient_profile_id: string }>();
  if (!review) fail(404, 'review_not_found');
  if (review!.author_user_id !== userId) fail(403, 'not_your_review');
  return review!;
}

// PATCH /v1/reviews/:id — the author edits their review (the ratings and the text); the text is checked again.
reviews.patch('/:id', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  await rateLimit(c, 'RL_WRITE', `review:${profile.ownerUserId}`);
  const review = await ownReview(c.env, c.req.param('id'), profile.ownerUserId);
  const body = z.object({
    quality: z.number().int().min(1).max(5), speed: z.number().int().min(1).max(5),
    contact: z.number().int().min(1).max(5), comment: z.string().trim().min(1).max(2000),
  }).parse(await c.req.json());
  const verdict = checkText(body.comment);
  await c.env.DB.prepare(`UPDATE reviews SET quality = ?, speed = ?, contact = ?, comment = ?, review_status = ?, review_reason = ?
      WHERE id = ?`).bind(body.quality, body.speed, body.contact, body.comment, verdict.flagged ? 'flagged' : 'approved',
      verdict.flagged ? verdict.reasons.join(', ').slice(0, 300) : null, review.id).run();
  if (verdict.flagged) await autoReport(c.env, { type: 'review', id: review.id, profileId: review.author_profile_id }, verdict, body.comment);
  return c.json({ id: review.id, reviewStatus: verdict.flagged ? 'flagged' : 'approved' });
});

// DELETE /v1/reviews/:id — FIX 128: a review is removed only through Report → moderation (admin), never directly.
reviews.delete('/:id', requireAuth, requireProfile, async () => fail(403, 'delete_via_report'));

// POST /v1/reviews/requests {contactProfileId} — idempotent: a repeated tap returns the waiting request.
reviews.post('/requests', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const { contactProfileId } = z.object({ contactProfileId: z.string() }).parse(await c.req.json());
  await c.env.DB.prepare(`UPDATE review_requests SET status = 'expired' WHERE status = 'pending' AND requester_profile_id = ?
      AND contact_profile_id = ? AND expires_at < ?`).bind(profile.id, contactProfileId, now()).run();
  const existing = await c.env.DB.prepare(`SELECT id FROM review_requests WHERE requester_profile_id = ? AND contact_profile_id = ?
      AND status = 'pending'`).bind(profile.id, contactProfileId).first<{ id: string }>();
  if (existing) return c.json({ id: existing.id, state: 'requested', created: false });
  const contactOwner = (await ownerOf(c.env, contactProfileId)) ?? fail(404, 'profile_not_found');
  await checkCanReview(c.env, contactProfileId, contactOwner, profile.id);
  const id = newId('rrq');
  try {
    await c.env.DB.prepare(`INSERT INTO review_requests (id, requester_profile_id, contact_profile_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)`).bind(id, profile.id, contactProfileId, now(), now() + 30 * 86_400_000).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) return c.json({ state: 'requested', created: false });
    throw error;
  }
  await notify(c.env, contactProfileId, 'review_request', profile.id, { requestId: id },
               { dedupKey: `review_request:${id}`, targetType: 'review_request', targetId: id });
  return c.json({ id, state: 'requested', created: true }, 201);
});

// GET /v1/reviews/requests/sheet — the Request a Review sheet: each contact with available / requested / reviewed.
reviews.get('/requests/sheet', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const rows = await c.env.DB.prepare(`SELECT
      CASE WHEN cr.sender_profile_id = ?1 THEN cr.recipient_profile_id ELSE cr.sender_profile_id END AS other_id,
      COALESCE(cr.responded_at, cr.created_at) AS since
      FROM contact_requests cr WHERE cr.status = 'accepted' AND (cr.sender_profile_id = ?1 OR cr.recipient_profile_id = ?1)
      ORDER BY since DESC`).bind(profile.id).all<{ other_id: string }>();
  const ids = rows.results.map((r) => r.other_id);
  if (!ids.length) return c.json({ items: [] });
  const marks = ids.map(() => '?').join(',');
  const [cards, reviewed, pending] = await Promise.all([
    loadCards(c.env, ids),
    c.env.DB.prepare(`SELECT r.author_profile_id FROM reviews r WHERE r.recipient_profile_id = ? AND r.status = 'published'
        AND r.author_user_id IN (SELECT owner_user_id FROM profiles WHERE id IN (${marks}))`).bind(profile.id, ...ids).all<{ author_profile_id: string }>(),
    c.env.DB.prepare(`SELECT contact_profile_id, id FROM review_requests WHERE requester_profile_id = ? AND status = 'pending'
        AND expires_at > ?`).bind(profile.id, now()).all<{ contact_profile_id: string; id: string }>(),
  ]);
  const reviewedSet = new Set(reviewed.results.map((r) => r.author_profile_id));
  const pendingMap = new Map(pending.results.map((r) => [r.contact_profile_id, r.id]));
  return c.json({ items: ids.map((id) => ({ profile: cards.get(id) ?? null,
    state: reviewedSet.has(id) ? 'reviewed' : pendingMap.has(id) ? 'requested' : 'available', requestId: pendingMap.get(id) ?? null })) });
});

// GET /v1/reviews/requests/incoming — contacts who asked the acting profile for a review.
reviews.get('/requests/incoming', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const rows = await c.env.DB.prepare(`SELECT * FROM review_requests WHERE contact_profile_id = ? AND status = 'pending' AND expires_at > ?
      ORDER BY created_at DESC`).bind(profile.id, now()).all<Record<string, any>>();
  const cards = await loadCards(c.env, rows.results.map((r) => r.requester_profile_id));
  return c.json({ items: rows.results.map((r) => ({ id: r.id, createdAt: r.created_at, requester: cards.get(r.requester_profile_id) ?? null })) });
});

// POST /v1/reviews/invites — a one-time link for someone outside KOLABA (token shown once, only its hash stored).
reviews.post('/invites', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  await rateLimit(c, 'RL_WRITE', `invite:${profile.ownerUserId}`);
  const recent = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM review_invites WHERE owner_profile_id = ? AND created_at > ?`)
    .bind(profile.id, now() - 86_400_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 20) fail(429, 'rate_limited');
  const token = newToken();
  const id = newId('inv');
  const expires = now() + 14 * 86_400_000;
  await c.env.DB.prepare(`INSERT INTO review_invites (id, owner_profile_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, profile.id, await sha256Hex(token), now(), expires).run();
  return c.json({ id, url: `${c.env.APP_URL}#/invite/${token}`, expiresAt: expires }, 201);
});

async function usableInvite(env: Env, token: string) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) fail(404, 'invalid_token');
  const invite = await env.DB.prepare(`SELECT * FROM review_invites WHERE token_hash = ?`).bind(await sha256Hex(token)).first<Record<string, any>>();
  if (!invite) fail(404, 'invalid_token');
  if (invite!.status === 'active' && invite!.expires_at < now()) {
    await env.DB.prepare(`UPDATE review_invites SET status = 'expired' WHERE id = ?`).bind(invite!.id).run();
    fail(410, 'invite_expired');
  }
  if (invite!.status !== 'active') fail(410, `invite_${invite!.status}`);
  return invite!;
}

// GET /v1/reviews/invites/:token — who asks (works before signing in).
reviews.get('/invites/:token', async (c) => {
  await rateLimit(c, 'RL_AUTH', `invite-resolve:${clientIP(c)}`);
  const invite = await usableInvite(c.env, c.req.param('token'));
  return c.json({ inviteId: invite.id, recipient: await loadCard(c.env, invite.owner_profile_id), expiresAt: invite.expires_at });
});

// POST /v1/reviews/invites/:token/accept — the invitee becomes a confirmed contact, then may review once.
reviews.post('/invites/:token/accept', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const invite = await usableInvite(c.env, c.req.param('token'));
  if (invite.accepted_by_profile_id && invite.accepted_by_profile_id !== profile.id) fail(410, 'invite_used');
  if ((await ownerOf(c.env, invite.owner_profile_id)) === profile.ownerUserId) fail(403, 'self_review');
  const key = pairKey(profile.id, invite.owner_profile_id);
  const live = await c.env.DB.prepare(`SELECT id, status FROM contact_requests WHERE pair_key = ? AND status IN ('pending', 'accepted')`)
    .bind(key).first<{ id: string; status: string }>();
  const statements = [
    c.env.DB.prepare(`UPDATE review_invites SET accepted_by_profile_id = ?, accepted_at = COALESCE(accepted_at, ?) WHERE id = ?`)
      .bind(profile.id, now(), invite.id),
  ];
  if (!live) {
    statements.push(c.env.DB.prepare(`INSERT INTO contact_requests (id, sender_profile_id, recipient_profile_id, pair_key, status, origin,
        created_at, responded_at) VALUES (?, ?, ?, ?, 'accepted', 'review_invite', ?, ?)`)
      .bind(newId('crq'), invite.owner_profile_id, profile.id, key, now(), now()));
  } else if (live.status === 'pending') {
    statements.push(c.env.DB.prepare(`UPDATE contact_requests SET status = 'accepted', responded_at = ? WHERE id = ?`).bind(now(), live.id));
  }
  await c.env.DB.batch(statements);
  await notify(c.env, invite.owner_profile_id, 'contact_accepted', profile.id, { via: 'review_invite' },
               { dedupKey: `contact_accepted:invite:${invite.id}:${profile.id}`, targetType: 'profile', targetId: profile.id });
  return c.json({ inviteId: invite.id, recipient: await loadCard(c.env, invite.owner_profile_id),
                  canReview: !(await hasReviewed(c.env, profile.ownerUserId, invite.owner_profile_id)) });
});

export default reviews;
