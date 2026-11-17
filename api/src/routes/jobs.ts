// Jobs (draft → published → closed), Apply / Withdraw, Saved, applicants for the owner.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { cardColumns, avatarJoin, card, type CardRow, isPro, loadCards, mediaColumns, mediaJSON, type MediaRow, notify } from '../lib/cards';
import { blockedBetweenUsers, checkText, monetizationEnabled, notBlockedSQL } from '../lib/moderation';
import { clampLimit, decodeCursor, encodeCursor, fail, newId, now, parseJSON } from '../lib/util';

const jobs = new Hono<AppEnv>();

const JobBody = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(2000).default(''),
  category: z.string().trim().max(60).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  location: z.string().trim().max(120).default('Worldwide'),
  countryCode: z.string().toUpperCase().regex(/^[A-Z]{2}$/).nullable().optional(),
  city: z.string().trim().max(60).nullable().optional(),
  isWorldwide: z.boolean().default(false),
  languages: z.array(z.string().regex(/^[a-z]{2,3}$/)).max(3).default([]),
  compensationType: z.enum(['not_selected', 'barter', 'fixed', 'range']).default('not_selected'),
  budgetMin: z.number().nonnegative().max(10_000_000).nullable().optional(),
  budgetMax: z.number().nonnegative().max(10_000_000).nullable().optional(),
  currency: z.string().toUpperCase().regex(/^[A-Z]{3}$/).nullable().optional(),
  deliverables: z.array(z.object({ kind: z.enum(['reels', 'photos', 'stories', 'videos']), count: z.number().int().min(1).max(100) }))
    .max(8).default([]),
  deadline: z.number().int().positive().nullable().optional(),
  /** Legacy (before FIX 128): the old top gallery — its first photo becomes the Cover, the rest References. */
  mediaIds: z.array(z.string()).max(11).optional(),
  /** FIX 128: one optional Cover photo (null removes it) and up to 10 Reference Media, the Cover not counted. */
  coverMediaId: z.string().nullable().optional(),
  referenceMediaIds: z.array(z.string()).max(10).optional(),
}).superRefine((j, ctx) => {
  if (j.compensationType === 'fixed' && (j.budgetMin == null || !j.currency)) ctx.addIssue({ code: 'custom', message: 'budget_required' });
  if (j.compensationType === 'range' && (j.budgetMin == null || j.budgetMax == null || !j.currency || j.budgetMin > j.budgetMax)) {
    ctx.addIssue({ code: 'custom', message: 'invalid_budget' });
  }
});

const flagOf = (code?: string | null) =>
  code ? String.fromCodePoint(...[...code].map((ch) => 127397 + ch.charCodeAt(0))) : null;

/** Jobs as the app shows them, with owner cards, media, counts and the viewer's saved/applied state — 3 queries. */
async function jobsJSON(env: Env, rows: Record<string, any>[], viewer: string | null) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const [owners, mediaRows, stats] = await Promise.all([
    loadCards(env, rows.map((r) => r.owner_profile_id)),
    // A job's Cover and References: approved ones for everyone; its owner also sees those still waiting for review.
    env.DB.prepare(`SELECT x.job_id, x.is_cover, ${mediaColumns} FROM (
          SELECT id AS job_id, cover_media_id AS media_id, 1 AS is_cover, -1 AS position FROM jobs WHERE id IN (${marks}) AND cover_media_id IS NOT NULL
          UNION ALL SELECT job_id, media_id, 0, position FROM job_media WHERE job_id IN (${marks})) x
        JOIN media m ON m.id = x.media_id AND m.status = 'ready'
          AND (m.review_status = 'approved' OR (m.owner_profile_id = ? AND m.review_status IN ('pending', 'flagged')))
        ORDER BY x.position, m.id`).bind(...ids, ...ids, viewer).all<MediaRow & { job_id: string; is_cover: number }>(),
    env.DB.prepare(`SELECT j.id,
        (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'submitted' AND EXISTS (SELECT 1 FROM profiles cp WHERE cp.id = a.creator_profile_id AND cp.status = 'active')) AS applications_count,
        (SELECT a.id FROM applications a WHERE a.job_id = j.id AND a.creator_profile_id = ? AND a.status = 'submitted') AS my_application_id,
        EXISTS (SELECT 1 FROM saved_jobs s WHERE s.job_id = j.id AND s.profile_id = ?) AS is_saved
        FROM jobs j WHERE j.id IN (${marks})`).bind(viewer, viewer, ...ids).all<Record<string, any>>(),
  ]);
  const covers = new Map<string, ReturnType<typeof mediaJSON>>();
  const references = new Map<string, ReturnType<typeof mediaJSON>[]>();
  for (const m of mediaRows.results) {
    if (m.is_cover) covers.set(m.job_id, mediaJSON(env, m));
    else references.set(m.job_id, [...(references.get(m.job_id) ?? []), mediaJSON(env, m)]);
  }
  const statsById = new Map(stats.results.map((s) => [s.id, s]));
  return rows.map((j) => {
    const s = statsById.get(j.id) ?? {};
    return {
      id: j.id, ownerProfileId: j.owner_profile_id, owner: owners.get(j.owner_profile_id) ?? null, title: j.title,
      description: j.description, category: j.category, tags: parseJSON(j.tags, []), location: j.location,
      countryCode: j.country_code, city: j.city, flag: j.is_worldwide ? '🌍' : j.flag, isWorldwide: j.is_worldwide === 1,
      languages: parseJSON(j.languages, []), compensationType: j.compensation_type, budgetMin: j.budget_min,
      budgetMax: j.budget_max, currency: j.currency, deliverables: parseJSON(j.deliverables, []), deadline: j.deadline,
      status: j.status, reviewStatus: j.review_status ?? 'approved', publishedAt: j.published_at, closedAt: j.closed_at, createdAt: j.created_at, viewsCount: j.views_count,
      isDemo: j.is_demo === 1, cover: covers.get(j.id) ?? null, references: references.get(j.id) ?? [],
      // Older apps read one list: the Cover first, then the References.
      media: [...(covers.has(j.id) ? [covers.get(j.id)!] : []), ...(references.get(j.id) ?? [])], applicationsCount: s.applications_count ?? 0,
      myApplicationId: s.my_application_id ?? null, isSaved: s.is_saved === 1,
      acceptsApplications: j.status === 'published' && (!j.deadline || j.deadline > now()),
    };
  });
}

// GET /v1/jobs?tab=all|applied|saved|mine&q=&cursor= — keyset by (published_at, id).
jobs.get('/', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const tab = c.req.query('tab') ?? 'all';
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 60);
  const limit = clampLimit(c.req.query('limit'), 15, 30);
  const cursor = decodeCursor<{ t: number; id: string }>(c.req.query('cursor'));
  const where: string[] = [];
  const params: unknown[] = [];
  if (tab === 'mine') {
    where.push(`j.owner_profile_id = ? AND j.status <> 'removed'`);
    params.push(profile.id);
  } else if (tab === 'applied') {
    where.push(`j.id IN (SELECT job_id FROM applications WHERE creator_profile_id = ? AND status = 'submitted') AND j.status <> 'removed'`);
    params.push(profile.id);
  } else if (tab === 'saved') {
    where.push(`j.id IN (SELECT job_id FROM saved_jobs WHERE profile_id = ?) AND j.status IN ('published', 'closed')`);
    params.push(profile.id);
  } else {
    // The public feed: approved posts only, nobody the viewer blocked (or was blocked by).
    where.push(`j.status = 'published' AND j.review_status = 'approved' AND ${notBlockedSQL('o.owner_user_id', '?')}`);
    params.push(profile.ownerUserId, profile.ownerUserId); // notBlockedSQL names the viewer twice
  }
  if (q) {
    where.push(`lower(j.title || ' ' || j.description || ' ' || j.location || ' ' || j.tags || ' ' || COALESCE(j.category, '')) LIKE ?`);
    params.push(`%${q}%`);
  }
  const sortKey = `COALESCE(j.published_at, j.created_at)`;
  if (cursor) {
    where.push(`(${sortKey}, j.id) < (?, ?)`);
    params.push(cursor.t, cursor.id);
  }
  const rows = await c.env.DB.prepare(`SELECT j.*, ${sortKey} AS sort_at FROM jobs j
      JOIN profiles o ON o.id = j.owner_profile_id AND o.status = 'active'
      WHERE ${where.join(' AND ')} ORDER BY sort_at DESC, j.id DESC LIMIT ?`).bind(...params, limit + 1).all<Record<string, any>>();
  const page = rows.results.slice(0, limit);
  const last = rows.results.length > limit ? page[page.length - 1] : null;
  return c.json({ items: await jobsJSON(c.env, page, profile.id), nextCursor: last ? encodeCursor({ t: last.sort_at, id: last.id }) : null });
});

jobs.get('/:id', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const row = await c.env.DB.prepare(`SELECT j.*, p.owner_user_id FROM jobs j JOIN profiles p ON p.id = j.owner_profile_id WHERE j.id = ?`)
    .bind(c.req.param('id')).first<Record<string, any>>();
  if (!row || ((row.status === 'draft' || row.status === 'removed' || !['approved', undefined].includes(row.review_status))
      && row.owner_user_id !== profile.ownerUserId)) fail(404, 'job_not_found');
  if (row!.owner_user_id !== profile.ownerUserId && row!.status === 'published') {
    c.executionCtx.waitUntil(c.env.DB.prepare(`UPDATE jobs SET views_count = views_count + 1 WHERE id = ?`).bind(row!.id).run());
  }
  return c.json((await jobsJSON(c.env, [row!], profile.id))[0]);
});

/** FIX 128: a job's Cover (one photo, optional) and References (up to 10 photos / videos, in order) — separate: the
 *  Cover is never a Reference, removing one never touches the other. Only the owner's own ready media. A field left
 *  out is left as it was; the legacy `mediaIds` list sets both (its first photo is the Cover). */
async function setJobMedia(env: Env, jobId: string, ownerId: string, body: { mediaIds?: string[]; coverMediaId?: string | null;
                                                                             referenceMediaIds?: string[] }) {
  let cover = body.coverMediaId;
  let refs = body.referenceMediaIds;
  if (cover === undefined && refs === undefined && body.mediaIds) {
    const unique = [...new Set(body.mediaIds)];
    const kinds = unique.length ? new Map((await env.DB.prepare(`SELECT id, kind FROM media WHERE id IN (${unique.map(() => '?').join(',')})`)
      .bind(...unique).all<{ id: string; kind: string }>()).results.map((r) => [r.id, r.kind])) : new Map<string, string>();
    cover = unique.find((id) => kinds.get(id) === 'photo') ?? null;
    refs = unique.filter((id) => id !== cover);
  }
  if (cover === undefined && refs === undefined) return;
  refs = refs ? [...new Set(refs)].filter((id) => id !== cover) : undefined;
  if (refs && refs.length > 10) fail(422, 'too_many_references');
  const check = [...(cover ? [cover] : []), ...(refs ?? [])];
  if (check.length) {
    const owned = await env.DB.prepare(`SELECT id, kind FROM media WHERE owner_profile_id = ? AND status = 'ready'
        AND id IN (${check.map(() => '?').join(',')})`).bind(ownerId, ...check).all<{ id: string; kind: string }>();
    if (owned.results.length !== new Set(check).size) fail(422, 'media_not_found');
    if (cover && owned.results.find((m) => m.id === cover)?.kind !== 'photo') fail(422, 'cover_must_be_photo');
  }
  await env.DB.batch([
    ...(cover !== undefined ? [env.DB.prepare(`UPDATE jobs SET cover_media_id = ? WHERE id = ?`).bind(cover, jobId),
                               env.DB.prepare(`DELETE FROM job_media WHERE job_id = ? AND media_id = ?`).bind(jobId, cover ?? '')] : []),
    ...(refs ? [env.DB.prepare(`DELETE FROM job_media WHERE job_id = ?`).bind(jobId),
                ...refs.map((mid, i) => env.DB.prepare(`INSERT INTO job_media (job_id, media_id, position) VALUES (?, ?, ?)`).bind(jobId, mid, i))] : []),
  ]);
}

// POST /v1/jobs {…, publish} — business only.
jobs.post('/', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'business');
  await rateLimit(c, 'RL_WRITE', `job:${profile.ownerUserId}`);
  const raw = await c.req.json();
  const body = JobBody.parse(raw);
  const publish = raw?.publish === true;
  const id = newId('job');
  await c.env.DB.prepare(`INSERT INTO jobs (id, owner_profile_id, title, description, category, tags, location, country_code, city, flag,
      is_worldwide, languages, compensation_type, budget_min, budget_max, currency, deliverables, deadline, status, published_at,
      created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, profile.id, body.title, body.description, body.category ?? null, JSON.stringify(body.tags), body.isWorldwide ? 'Worldwide' : body.location,
          body.countryCode ?? null, body.city ?? null, flagOf(body.countryCode), Number(body.isWorldwide), JSON.stringify(body.languages),
          body.compensationType, body.compensationType === 'fixed' || body.compensationType === 'range' ? body.budgetMin ?? null : null,
          body.compensationType === 'range' ? body.budgetMax ?? null : null,
          ['fixed', 'range'].includes(body.compensationType) ? body.currency ?? null : null, JSON.stringify(body.deliverables),
          body.deadline ?? null, publish ? 'published' : 'draft', publish ? now() : null, now(), now()).run();
  await setJobMedia(c.env, id, profile.id, body);
  await screenJob(c.env, id, body.title, body.description, body.tags);
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first<Record<string, any>>();
  return c.json((await jobsJSON(c.env, [row!], profile.id))[0], 201);
});

async function ownedJob(env: Env, id: string, profileId: string) {
  const row = await env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first<Record<string, any>>();
  if (!row || row.owner_profile_id !== profileId) fail(404, 'job_not_found');
  if (row!.status === 'removed') fail(409, 'job_removed');
  return row!;
}

// PATCH /v1/jobs/:id — owner edits (the whole editable set).
jobs.patch('/:id', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'business');
  const job = await ownedJob(c.env, c.req.param('id'), profile.id);
  const body = JobBody.parse(await c.req.json());
  await c.env.DB.prepare(`UPDATE jobs SET title = ?, description = ?, category = ?, tags = ?, location = ?, country_code = ?, city = ?,
      flag = ?, is_worldwide = ?, languages = ?, compensation_type = ?, budget_min = ?, budget_max = ?, currency = ?, deliverables = ?,
      deadline = ?, updated_at = ? WHERE id = ?`)
    .bind(body.title, body.description, body.category ?? null, JSON.stringify(body.tags), body.isWorldwide ? 'Worldwide' : body.location,
          body.countryCode ?? null, body.city ?? null, flagOf(body.countryCode), Number(body.isWorldwide), JSON.stringify(body.languages),
          body.compensationType, ['fixed', 'range'].includes(body.compensationType) ? body.budgetMin ?? null : null,
          body.compensationType === 'range' ? body.budgetMax ?? null : null,
          ['fixed', 'range'].includes(body.compensationType) ? body.currency ?? null : null, JSON.stringify(body.deliverables),
          body.deadline ?? null, now(), job.id).run();
  await setJobMedia(c.env, job.id, profile.id, body);
  await screenJob(c.env, job.id, body.title, body.description, body.tags);
  if (job.status === 'published') await notifySavers(c.env, job.id, 'saved_job_updated', body.title);
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(job.id).first<Record<string, any>>();
  return c.json((await jobsJSON(c.env, [row!], profile.id))[0]);
});

/** The profiles that saved a job hear that it changed or closed — one row per job per day for edits (small edits
 *  don't pile up), one for the close; no push for either (Settings: Job updates). */
export async function notifySavers(env: Env, jobId: string, type: 'saved_job_updated' | 'saved_job_closed', title: string) {
  const owner = await env.DB.prepare(`SELECT owner_profile_id FROM jobs WHERE id = ?`).bind(jobId).first<{ owner_profile_id: string }>();
  const savers = await env.DB.prepare(`SELECT profile_id FROM saved_jobs WHERE job_id = ?`).bind(jobId).all<{ profile_id: string }>();
  const day = Math.floor(now() / 86_400_000);
  for (const s of savers.results) {
    await notify(env, s.profile_id, type, owner?.owner_profile_id ?? null, { jobId, jobTitle: title },
                 { dedupKey: type === 'saved_job_closed' ? `${type}:${jobId}:${s.profile_id}` : `${type}:${jobId}:${s.profile_id}:${day}`,
                   targetType: 'job', targetId: jobId });
  }
}

/** Automatic text check of a job post: a flagged post leaves the public feed until a moderator looks at it (it is never
 *  rejected automatically). A post a moderator rejected / removed stays so after an edit. */
async function screenJob(env: Env, id: string, title: string, description: string, tags: string[]) {
  const verdict = checkText(title, description, tags.join(' '));
  if (verdict.flagged) {
    await env.DB.prepare(`UPDATE jobs SET review_status = CASE WHEN review_status IN ('rejected', 'removed') THEN review_status ELSE 'flagged' END,
        auto_flags = ? WHERE id = ?`).bind(JSON.stringify(verdict), id).run();
  } else {
    await env.DB.prepare(`UPDATE jobs SET auto_flags = NULL WHERE id = ?`).bind(id).run();
  }
}

// POST /v1/jobs/:id/publish | /close — Closed = no more applications (not "work done").
jobs.post('/:id/:action{publish|close}', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'business');
  const job = await ownedJob(c.env, c.req.param('id'), profile.id);
  if (c.req.param('action') === 'publish') {
    await c.env.DB.prepare(`UPDATE jobs SET status = 'published', published_at = COALESCE(published_at, ?), closed_at = NULL,
        updated_at = ? WHERE id = ?`).bind(now(), now(), job.id).run();
  } else {
    if (job.status !== 'published') fail(409, 'invalid_transition');
    await c.env.DB.prepare(`UPDATE jobs SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?`).bind(now(), now(), job.id).run();
    await notifySavers(c.env, job.id, 'saved_job_closed', job.title);
  }
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(job.id).first<Record<string, any>>();
  return c.json((await jobsJSON(c.env, [row!], profile.id))[0]);
});

jobs.delete('/:id', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'business');
  const job = await ownedJob(c.env, c.req.param('id'), profile.id);
  if (job.status === 'published') await notifySavers(c.env, job.id, 'saved_job_closed', job.title);
  await c.env.DB.prepare(`DELETE FROM jobs WHERE id = ?`).bind(job.id).run();
  return c.json({ status: 'deleted' });
});

// PUT / DELETE /v1/jobs/:id/save — independent of Apply.
jobs.put('/:id/save', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const job = await c.env.DB.prepare(`SELECT 1 AS ok FROM jobs WHERE id = ? AND status IN ('published', 'closed') AND review_status = 'approved'`)
    .bind(c.req.param('id')).first();
  if (!job) fail(404, 'job_not_found');
  await c.env.DB.prepare(`INSERT OR IGNORE INTO saved_jobs (profile_id, job_id, created_at) VALUES (?, ?, ?)`)
    .bind(profile.id, c.req.param('id'), now()).run();
  return c.json({ saved: true });
});

jobs.delete('/:id/save', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  await c.env.DB.prepare(`DELETE FROM saved_jobs WHERE profile_id = ? AND job_id = ?`).bind(profile.id, c.req.param('id')).run();
  return c.json({ saved: false });
});

// ─── Apply ───

const ApplyBody = z.object({ message: z.string().trim().min(1).max(2000), mediaIds: z.array(z.string()).max(10).default([]) });

async function applicationsJSON(env: Env, rows: Record<string, any>[]) {
  if (!rows.length) return [];
  const creators = [...new Set(rows.map((r) => r.creator_profile_id as string))];
  const [cards, videos] = await Promise.all([loadCards(env, creators), latestPortfolioVideos(env, creators)]);
  return rows.map((a) => ({
    id: a.id, jobId: a.job_id, message: a.message, status: a.status, createdAt: a.created_at, updatedAt: a.updated_at,
    withdrawnAt: a.withdrawn_at, isShortlisted: Boolean(a.shortlisted_at), applicant: cards.get(a.creator_profile_id) ?? null,
    media: videos.get(a.creator_profile_id) ?? [],
  }));
}

/** FIX 128: an application shows its creator's portfolio as it is now — the latest published videos (at most 10,
 *  newest first, the id breaking ties), picked when the application is read, and only while the creator has PRO
 *  (checked here, on the server). Nothing is stored with the application: a video deleted, hidden or rejected leaves
 *  every application at once, a new one joins them, and PRO lost hides them all (PRO back shows what's there then).
 *  One query for every creator on the page. */
export const APPLY_VIDEO_LIMIT = 10;
export async function latestPortfolioVideos(env: Env, profileIds: string[]): Promise<Map<string, ReturnType<typeof mediaJSON>[]>> {
  const byOwner = new Map<string, ReturnType<typeof mediaJSON>[]>();
  if (!profileIds.length) return byOwner;
  const marks = profileIds.map(() => '?').join(',');
  const pro = monetizationEnabled(env)
    ? new Set((await env.DB.prepare(`SELECT DISTINCT profile_id FROM subscriptions WHERE profile_id IN (${marks})
          AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`).bind(...profileIds, Date.now())
        .all<{ profile_id: string }>()).results.map((r) => r.profile_id))
    : new Set(profileIds);
  const owners = profileIds.filter((id) => pro.has(id));
  if (!owners.length) return byOwner;
  const rows = await env.DB.prepare(`SELECT * FROM (SELECT ${mediaColumns},
        ROW_NUMBER() OVER (PARTITION BY m.owner_profile_id ORDER BY m.created_at DESC, m.id DESC) AS rn
      FROM media m WHERE m.owner_profile_id IN (${owners.map(() => '?').join(',')}) AND m.kind = 'video'
        AND m.purpose = 'portfolio' AND m.status = 'ready' AND m.is_public = 1 AND m.review_status = 'approved'
        AND m.moderation_status IS NULL) WHERE rn <= ? ORDER BY owner_profile_id, rn`)
    .bind(...owners, APPLY_VIDEO_LIMIT).all<MediaRow>();
  for (const m of rows.results) byOwner.set(m.owner_profile_id, [...(byOwner.get(m.owner_profile_id) ?? []), mediaJSON(env, m)]);
  return byOwner;
}

// POST /v1/jobs/:id/apply — creator only; one active application. Its videos are the creator's own latest (FIX 128).
jobs.post('/:id/apply', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'creator');
  await rateLimit(c, 'RL_WRITE', `apply:${profile.ownerUserId}`);
  const body = ApplyBody.parse(await c.req.json());
  const job = await c.env.DB.prepare(`SELECT j.*, p.owner_user_id FROM jobs j JOIN profiles p ON p.id = j.owner_profile_id WHERE j.id = ?`)
    .bind(c.req.param('id')).first<Record<string, any>>();
  if (!job || job.status === 'draft' || job.status === 'removed') fail(404, 'job_not_found');
  if (job!.owner_user_id === profile.ownerUserId) fail(403, 'own_job');
  if (job!.review_status !== 'approved') fail(404, 'job_not_found');
  if (await blockedBetweenUsers(c.env, profile.ownerUserId, job!.owner_user_id)) fail(403, 'blocked');
  if (job!.status !== 'published') fail(409, 'job_closed');
  if (job!.deadline && job!.deadline < now()) fail(409, 'deadline_passed');
  // FIX 128: nothing is attached here — the application shows the creator's latest videos while they have PRO
  // (`latestPortfolioVideos`); media ids a client still sends are ignored.
  const id = newId('app');
  try {
    await c.env.DB.prepare(`INSERT INTO applications (id, job_id, creator_profile_id, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, job!.id, profile.id, body.message, now(), now()).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) fail(409, 'already_applied');
    throw error;
  }
  // Only the business that published the job (never another profile of the same account).
  await notify(c.env, job!.owner_profile_id, 'application_received', profile.id, { jobId: job!.id, applicationId: id, jobTitle: job!.title },
               { dedupKey: `apply:${id}`, targetType: 'job', targetId: job!.id });
  const row = await c.env.DB.prepare(`SELECT * FROM applications WHERE id = ?`).bind(id).first<Record<string, any>>();
  return c.json((await applicationsJSON(c.env, [row!]))[0], 201);
});

// PATCH /v1/jobs/applications/:id — the applicant edits the message.
jobs.patch('/applications/:id', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'creator');
  const body = ApplyBody.pick({ message: true }).parse(await c.req.json());
  const res = await c.env.DB.prepare(`UPDATE applications SET message = ?, updated_at = ? WHERE id = ? AND creator_profile_id = ?
      AND status = 'submitted'`).bind(body.message, now(), c.req.param('id'), profile.id).run();
  if (!res.meta.changes) fail(404, 'application_not_found');
  return c.json({ status: 'updated' });
});

// POST /v1/jobs/applications/:id/withdraw — the applicant only; kept in history as withdrawn.
jobs.post('/applications/:id/withdraw', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'creator');
  const res = await c.env.DB.prepare(`UPDATE applications SET status = 'withdrawn', withdrawn_at = ?, shortlisted_at = NULL, updated_at = ?
      WHERE id = ? AND creator_profile_id = ? AND status = 'submitted'`).bind(now(), now(), c.req.param('id'), profile.id).run();
  if (!res.meta.changes) fail(404, 'application_not_found');
  return c.json({ status: 'withdrawn' });
});

// GET /v1/jobs/:id/applications?sort=newest|oldest|rating&shortlisted=1 — the job owner only.
// Everyone signed in sees a published job's applicants (iOS FIX 31); the owner also gets shortlists. Counted and
// listed by one rule: submitted applications of active profiles.
jobs.get('/:id/applications', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const job = await c.env.DB.prepare(`SELECT owner_profile_id, status FROM jobs WHERE id = ?`).bind(c.req.param('id')).first<{ owner_profile_id: string; status: string }>();
  const isOwner = job?.owner_profile_id === profile.id;
  if (!job || (!isOwner && job.status !== 'published' && job.status !== 'closed')) fail(404, 'job_not_found');
  const sort = c.req.query('sort');
  const order = sort === 'oldest' ? 'a.created_at ASC' : sort === 'rating'
    ? `(SELECT AVG((r.quality + r.speed + r.contact) / 3.0) FROM reviews r WHERE r.recipient_profile_id = a.creator_profile_id
         AND r.status = 'published') DESC NULLS LAST, a.created_at DESC` : 'a.created_at DESC';
  const rows = await c.env.DB.prepare(`SELECT a.* FROM applications a WHERE a.job_id = ? AND a.status = 'submitted' AND EXISTS (SELECT 1 FROM profiles cp WHERE cp.id = a.creator_profile_id AND cp.status = 'active')
      AND (? = 0 OR a.shortlisted_at IS NOT NULL) ORDER BY ${order} LIMIT 200`)
    .bind(c.req.param('id'), isOwner && c.req.query('shortlisted') === '1' ? 1 : 0).all<Record<string, any>>();
  const items = await applicationsJSON(c.env, rows.results);
  return c.json({ items: isOwner ? items : items.map((i: any) => ({ ...i, isShortlisted: false })), isOwner });
});

// PUT /v1/jobs/applications/:id/shortlist {shortlisted} — the job owner only.
jobs.put('/applications/:id/shortlist', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'business');
  const { shortlisted } = z.object({ shortlisted: z.boolean() }).parse(await c.req.json());
  const res = await c.env.DB.prepare(`UPDATE applications SET shortlisted_at = ? WHERE id = ? AND status = 'submitted'
      AND job_id IN (SELECT id FROM jobs WHERE owner_profile_id = ?)`).bind(shortlisted ? now() : null, c.req.param('id'), profile.id).run();
  if (!res.meta.changes) fail(404, 'application_not_found');
  return c.json({ shortlisted });
});

// GET /v1/jobs/applications/mine — the creator's Applied list with each job.
jobs.get('/applications/mine', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'creator');
  const rows = await c.env.DB.prepare(`SELECT * FROM applications WHERE creator_profile_id = ? AND status = 'submitted'
      ORDER BY created_at DESC LIMIT 100`).bind(profile.id).all<Record<string, any>>();
  return c.json({ items: await applicationsJSON(c.env, rows.results) });
});

export { jobsJSON, card, cardColumns, avatarJoin };
export type { CardRow };
export default jobs;
