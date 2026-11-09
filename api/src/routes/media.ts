// Media: authorize an upload → PUT the file (streamed to R2, never buffered) → ready. Serving with Range (Safari
// video needs it), signed URLs for private files, safe delete. Collections. Likes and views (Reels).
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, currentUser, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { isPro, mediaColumns, mediaJSON, type MediaRow, notify } from '../lib/cards';
import { fail, newId, now, sha256Hex } from '../lib/util';

const media = new Hono<AppEnv>();

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
/** How many of a purpose a profile may keep (the iOS limits). */
const COUNT_LIMITS: Record<string, Record<string, number>> = {
  portfolio: { photo: 30, video: 12 },
  avatar: { photo: 10 },
  intro: { video: 1 },
};
const PRO_PURPOSES = new Set(['intro', 'collection', 'application']);

const UploadRequest = z.object({
  purpose: z.enum(['avatar', 'portfolio', 'intro', 'collection', 'job', 'application', 'chat', 'poster']),
  kind: z.enum(['photo', 'video']),
  mime: z.string().toLowerCase(),
  bytes: z.number().int().positive(),
  width: z.number().int().positive().max(10000).optional(),
  height: z.number().int().positive().max(10000).optional(),
  duration: z.number().positive().max(3600).optional(),
  title: z.string().max(200).optional(),
  posterMediaId: z.string().optional(),
});

/** Does the first bytes' signature match the declared type? (A renamed .exe is not a JPEG.) */
function signatureMatches(mime: string, head: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  switch (mime) {
    case 'image/jpeg': return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/png': return head[0] === 0x89 && ascii(1, 4) === 'PNG';
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/heic': case 'image/heif': case 'video/mp4': case 'video/quicktime': return ascii(4, 8) === 'ftyp';
    default: return false;
  }
}

// POST /v1/media/uploads — checks type, size, limits and plan; returns where to PUT the file.
media.post('/uploads', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  await rateLimit(c, 'RL_WRITE', `upload:${profile.ownerUserId}`);
  if (!c.env.MEDIA) fail(503, 'storage_unavailable', 'File storage (R2) is not enabled yet.');
  const body = UploadRequest.parse(await c.req.json());
  const types = body.kind === 'photo' ? PHOTO_TYPES : VIDEO_TYPES;
  if (!types.includes(body.mime)) fail(415, 'invalid_mime_type');
  const maxBytes = Number(body.kind === 'photo' ? c.env.MAX_PHOTO_MB : c.env.MAX_VIDEO_MB) * 1024 * 1024;
  if (body.bytes > maxBytes) fail(413, 'file_too_large', `Limit: ${Math.round(maxBytes / 1048576)} MB`);
  if (body.kind === 'video' && body.duration && body.duration > Number(c.env.MAX_VIDEO_SECONDS)) fail(422, 'video_too_long');
  if (['portfolio', 'intro', 'collection'].includes(body.purpose) && profile.type !== 'creator') fail(403, 'creator_profile_required');
  if (PRO_PURPOSES.has(body.purpose) && !(await isPro(c.env, profile.id))) fail(403, 'pro_required');
  // A business has one photo, its logo (FEATURE 19): a new one may be uploaded only to replace the current one
  // (PATCH avatarMediaId then retires the old), never a second next to it. A creator keeps up to 10.
  if (body.purpose === 'avatar' && profile.type === 'business') {
    const others = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM media m JOIN profiles p ON p.id = m.owner_profile_id
        WHERE m.owner_profile_id = ? AND m.purpose = 'avatar' AND m.status IN ('pending', 'ready')
        AND m.created_at > ? AND m.id IS NOT COALESCE(p.avatar_media_id, '')`).bind(profile.id, now() - 3_600_000).first<{ n: number }>();
    if ((others?.n ?? 0) >= 1) fail(409, 'media_limit_reached', 'A business profile has one photo.');
  }
  const limit = body.purpose === 'avatar' && profile.type === 'business' ? 0 : COUNT_LIMITS[body.purpose]?.[body.kind];
  if (limit) {
    const used = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM media WHERE owner_profile_id = ? AND purpose = ? AND kind = ?
        AND status IN ('pending', 'ready')`).bind(profile.id, body.purpose, body.kind).first<{ n: number }>();
    if ((used?.n ?? 0) >= limit) fail(409, 'media_limit_reached');
  }
  // Abandoned pending uploads don't hold the quota for ever.
  await c.env.DB.prepare(`UPDATE media SET status = 'failed' WHERE owner_profile_id = ? AND status = 'pending' AND created_at < ?`)
    .bind(profile.id, now() - 3_600_000).run();
  const id = newId('med');
  const ext = body.mime.split('/')[1].replace('quicktime', 'mov').replace('jpeg', 'jpg');
  const key = `u/${profile.id}/${body.purpose}/${id}.${ext}`;
  await c.env.DB.prepare(`INSERT INTO media (id, owner_profile_id, kind, purpose, provider, storage_key, mime, bytes, width, height,
      duration, title, poster_media_id, status, is_public, created_at) VALUES (?, ?, ?, ?, 'r2', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .bind(id, profile.id, body.kind, body.purpose, key, body.mime, body.bytes, body.width ?? null, body.height ?? null,
          body.duration ?? null, body.title ?? null, body.posterMediaId ?? null,
          ['chat', 'application'].includes(body.purpose) ? 0 : 1, now()).run();
  return c.json({ mediaId: id, uploadUrl: `${c.env.API_URL}/v1/media/uploads/${id}`, method: 'PUT', maxBytes }, 201);
});

// PUT /v1/media/uploads/:id — the file body, streamed straight into R2 (checked: owner, size, signature).
media.put('/uploads/:id', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  if (!c.env.MEDIA) fail(503, 'storage_unavailable');
  const row = await c.env.DB.prepare(`SELECT ${mediaColumns}, m.storage_key, m.bytes, m.status FROM media m WHERE m.id = ?`)
    .bind(c.req.param('id')).first<MediaRow & { storage_key: string; bytes: number; status: string }>();
  if (!row || row.owner_profile_id !== profile.id) fail(404, 'media_not_found');
  if (row!.status !== 'pending') fail(409, 'upload_closed');
  const length = Number(c.req.header('Content-Length') ?? NaN);
  if (!Number.isFinite(length) || length !== row!.bytes) fail(422, 'length_mismatch');
  if (c.req.header('Content-Type')?.toLowerCase() !== row!.mime) fail(415, 'invalid_mime_type');
  const body = c.req.raw.body ?? fail(400, 'empty_body');

  // Read the first chunk to check the file signature, then stream it and the rest to R2.
  const reader = body.getReader();
  const first = await reader.read();
  const head = first.value ?? new Uint8Array();
  if (head.length < 12 || !signatureMatches(row!.mime!, head)) {
    await reader.cancel();
    await c.env.DB.prepare(`UPDATE media SET status = 'failed' WHERE id = ?`).bind(row!.id).run();
    fail(415, 'invalid_file');
  }
  let seen = head.length;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(head); },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { controller.close(); return; }
      seen += value.length;
      if (seen > row!.bytes) { controller.error(new Error('too large')); return; }
      controller.enqueue(value);
    },
    cancel() { reader.cancel(); },
  });
  const fixed = new FixedLengthStream(row!.bytes);
  stream.pipeTo(fixed.writable).catch(() => {});
  try {
    await c.env.MEDIA!.put(row!.storage_key, fixed.readable, { httpMetadata: { contentType: row!.mime! } });
  } catch {
    await c.env.DB.prepare(`UPDATE media SET status = 'failed' WHERE id = ?`).bind(row!.id).run();
    fail(422, 'upload_failed');
  }
  await c.env.DB.prepare(`UPDATE media SET status = 'ready' WHERE id = ?`).bind(row!.id).run();
  return c.json(mediaJSON(c.env, { ...row!, status: 'ready' } as MediaRow));
});

async function signature(env: Env, id: string, expires: number) {
  return (await sha256Hex(`${env.MEDIA_URL_SECRET ?? 'unset'}:${id}:${expires}`)).slice(0, 32);
}

/** A time-limited URL for a private file (chat / application attachments) — <video>/<img> can't send headers. */
export async function signedMediaURL(env: Env, id: string): Promise<string> {
  const expires = now() + 3_600_000;
  return `${env.API_URL}/v1/media/${id}/file?exp=${expires}&sig=${await signature(env, id, expires)}`;
}

// GET /v1/media/:id/file — the bytes, with Range support. Public files are cacheable; private ones need a signature.
media.get('/:id/file', async (c) => {
  const row = await c.env.DB.prepare(`SELECT storage_key, provider, url, mime, is_public, status FROM media WHERE id = ?`)
    .bind(c.req.param('id')).first<{ storage_key: string | null; provider: string; url: string | null; mime: string; is_public: number; status: string }>();
  if (!row || row.status !== 'ready') fail(404, 'media_not_found');
  if (row!.provider === 'external') return c.redirect(row!.url!, 302);
  if (!row!.is_public) {
    const exp = Number(c.req.query('exp'));
    if (!exp || exp < now() || c.req.query('sig') !== (await signature(c.env, c.req.param('id'), exp))) fail(403, 'forbidden');
  }
  if (!c.env.MEDIA) fail(503, 'storage_unavailable');
  const rangeHeader = c.req.header('Range');
  let range: R2Range | undefined;
  const m = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
  if (m) {
    if (m[1] === '' && m[2] !== '') range = { suffix: Number(m[2]) };
    else if (m[2] === '') range = { offset: Number(m[1]) };
    else range = { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 };
  }
  const object = await c.env.MEDIA!.get(row!.storage_key!, range ? { range } : undefined);
  if (!object) fail(404, 'media_not_found');
  const headers = new Headers();
  object!.writeHttpMetadata(headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('ETag', object!.httpEtag);
  headers.set('Cache-Control', row!.is_public ? 'public, max-age=86400' : 'private, max-age=3600');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (range && 'range' in object! && object!.range) {
    const r = object!.range as { offset?: number; length?: number; suffix?: number };
    const size = object!.size;
    const start = r.suffix !== undefined ? size - r.suffix : (r.offset ?? 0);
    const length = r.suffix !== undefined ? r.suffix : (r.length ?? size - start);
    headers.set('Content-Range', `bytes ${start}-${start + length - 1}/${size}`);
    headers.set('Content-Length', String(length));
    return new Response(object!.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object!.size));
  return new Response(object!.body, { status: 200, headers });
});

// DELETE /v1/media/:id — owner only: hidden at once everywhere, the R2 object removed.
media.delete('/:id', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const row = await c.env.DB.prepare(`SELECT owner_profile_id, storage_key, provider, poster_media_id FROM media WHERE id = ? AND status <> 'deleted'`)
    .bind(c.req.param('id')).first<{ owner_profile_id: string; storage_key: string | null; provider: string; poster_media_id: string | null }>();
  if (!row || row.owner_profile_id !== profile.id) fail(404, 'media_not_found');
  const id = c.req.param('id');
  // A video's poster frame (uploaded with it, same owner) goes with it.
  const poster = row!.poster_media_id ? await c.env.DB.prepare(`SELECT id, storage_key, provider FROM media WHERE id = ? AND owner_profile_id = ? AND purpose = 'poster'`)
    .bind(row!.poster_media_id, profile.id).first<{ id: string; storage_key: string | null; provider: string }>() : null;
  if (poster) {
    await c.env.DB.prepare(`UPDATE media SET status = 'deleted', deleted_at = ? WHERE id = ?`).bind(now(), poster.id).run();
    if (poster.provider === 'r2' && poster.storage_key && c.env.MEDIA) c.executionCtx.waitUntil(c.env.MEDIA.delete(poster.storage_key));
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE media SET status = 'deleted', deleted_at = ? WHERE id = ?`).bind(now(), id),
    c.env.DB.prepare(`DELETE FROM collection_items WHERE media_id = ?`).bind(id),
    c.env.DB.prepare(`UPDATE profiles SET avatar_media_id = NULL WHERE avatar_media_id = ?`).bind(id),
    c.env.DB.prepare(`UPDATE profiles SET intro_video_media_id = NULL WHERE intro_video_media_id = ?`).bind(id),
    c.env.DB.prepare(`UPDATE collections SET cover_media_id = NULL WHERE cover_media_id = ?`).bind(id),
  ]);
  if (row!.provider === 'r2' && row!.storage_key && c.env.MEDIA) c.executionCtx.waitUntil(c.env.MEDIA.delete(row!.storage_key));
  return c.json({ status: 'deleted' });
});

// PUT / DELETE /v1/media/:id/like — Reels like / unlike (idempotent).
media.put('/:id/like', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const id = c.req.param('id');
  const target = await c.env.DB.prepare(`SELECT owner_profile_id FROM media WHERE id = ? AND status = 'ready' AND is_public = 1`)
    .bind(id).first<{ owner_profile_id: string }>();
  if (!target) fail(404, 'media_not_found');
  const res = await c.env.DB.prepare(`INSERT OR IGNORE INTO likes (media_id, profile_id, created_at) VALUES (?, ?, ?)`)
    .bind(id, profile.id, now()).run();
  if (res.meta.changes) {
    await c.env.DB.prepare(`UPDATE media SET likes_count = likes_count + 1 WHERE id = ?`).bind(id).run();
    await notify(c.env, target!.owner_profile_id, 'liked_video', profile.id, { mediaId: id });
  }
  const count = await c.env.DB.prepare(`SELECT likes_count FROM media WHERE id = ?`).bind(id).first<{ likes_count: number }>();
  return c.json({ liked: true, likesCount: count?.likes_count ?? 0 });
});

media.delete('/:id/like', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const id = c.req.param('id');
  const res = await c.env.DB.prepare(`DELETE FROM likes WHERE media_id = ? AND profile_id = ?`).bind(id, profile.id).run();
  if (res.meta.changes) await c.env.DB.prepare(`UPDATE media SET likes_count = MAX(likes_count - 1, 0) WHERE id = ?`).bind(id).run();
  const count = await c.env.DB.prepare(`SELECT likes_count FROM media WHERE id = ?`).bind(id).first<{ likes_count: number }>();
  return c.json({ liked: false, likesCount: count?.likes_count ?? 0 });
});

// POST /v1/media/:id/view — a Reels view (counted, not per-frame).
media.post('/:id/view', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO media_views (media_id, viewer_profile_id, created_at)
                      SELECT id, ?, ? FROM media WHERE id = ? AND owner_profile_id <> ?`).bind(profile.id, now(), id, profile.id),
    c.env.DB.prepare(`UPDATE media SET views_count = views_count + 1 WHERE id = ? AND owner_profile_id <> ?`).bind(id, profile.id),
  ]);
  return c.json({ ok: true });
});

// ─── Collections (creator.pro) ───

const CollectionBody = z.object({
  title: z.string().trim().min(1).max(40),
  description: z.string().max(300).optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

media.post('/collections', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'creator');
  if (!(await isPro(c.env, profile.id))) fail(403, 'pro_required');
  const body = CollectionBody.parse(await c.req.json());
  const id = newId('col');
  await c.env.DB.prepare(`INSERT INTO collections (id, owner_profile_id, title, description, visibility, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM collections WHERE owner_profile_id = ?), ?)`)
    .bind(id, profile.id, body.title, body.description ?? '', body.visibility ?? 'public', profile.id, now()).run();
  return c.json({ id, ...body }, 201);
});

async function ownedCollection(env: Env, id: string, profileId: string) {
  const row = await env.DB.prepare(`SELECT owner_profile_id FROM collections WHERE id = ?`).bind(id).first<{ owner_profile_id: string }>();
  if (!row || row.owner_profile_id !== profileId) fail(404, 'collection_not_found');
}

media.patch('/collections/:id', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'creator');
  await ownedCollection(c.env, c.req.param('id'), profile.id);
  if (!(await isPro(c.env, profile.id))) fail(403, 'pro_required');
  const body = CollectionBody.partial().parse(await c.req.json());
  await c.env.DB.prepare(`UPDATE collections SET title = COALESCE(?, title), description = COALESCE(?, description),
      visibility = COALESCE(?, visibility) WHERE id = ?`).bind(body.title ?? null, body.description ?? null, body.visibility ?? null,
      c.req.param('id')).run();
  return c.json({ status: 'updated' });
});

// Deleting a collection never deletes its media.
media.delete('/collections/:id', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'creator');
  await ownedCollection(c.env, c.req.param('id'), profile.id);
  await c.env.DB.prepare(`DELETE FROM collections WHERE id = ?`).bind(c.req.param('id')).run();
  return c.json({ status: 'deleted' });
});

// PUT /v1/media/collections/:id/items {mediaIds} — the collection's media, in order (own ready media only).
media.put('/collections/:id/items', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'creator');
  const id = c.req.param('id');
  await ownedCollection(c.env, id, profile.id);
  if (!(await isPro(c.env, profile.id))) fail(403, 'pro_required');
  const { mediaIds } = z.object({ mediaIds: z.array(z.string()).max(100) }).parse(await c.req.json());
  if (mediaIds.length) {
    const owned = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM media WHERE owner_profile_id = ? AND status = 'ready'
        AND id IN (${mediaIds.map(() => '?').join(',')})`).bind(profile.id, ...mediaIds).first<{ n: number }>();
    if (owned?.n !== new Set(mediaIds).size) fail(422, 'media_not_found');
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM collection_items WHERE collection_id = ?`).bind(id),
    ...[...new Set(mediaIds)].map((mid, i) =>
      c.env.DB.prepare(`INSERT INTO collection_items (collection_id, media_id, position) VALUES (?, ?, ?)`).bind(id, mid, i)),
  ]);
  return c.json({ status: 'updated', count: new Set(mediaIds).size });
});

// GET /v1/media/collections/:id/items
media.get('/collections/:id/items', async (c) => {
  const id = c.req.param('id');
  const col = await c.env.DB.prepare(`SELECT col.*, p.owner_user_id FROM collections col JOIN profiles p ON p.id = col.owner_profile_id
      WHERE col.id = ?`).bind(id).first<Record<string, any>>();
  if (!col || (col.visibility !== 'public' && col.owner_user_id !== c.get('user')?.id)) fail(404, 'collection_not_found');
  const rows = await c.env.DB.prepare(`SELECT ${mediaColumns} FROM collection_items ci JOIN media m ON m.id = ci.media_id
      WHERE ci.collection_id = ? AND m.status = 'ready' ORDER BY ci.position`).bind(id).all<MediaRow>();
  return c.json({ collection: { id: col!.id, title: col!.title, description: col!.description, visibility: col!.visibility },
                  items: rows.results.map((m) => mediaJSON(c.env, m)) });
});

export { media, currentUser };
export default media;
