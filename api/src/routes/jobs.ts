// Jobs (draft → published → closed), Apply / Withdraw, Saved, applicants for the owner.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { cardColumns, avatarJoin, card, type CardRow, isPro, loadCards, mediaColumns, mediaJSON, type MediaRow, notify } from '../lib/cards';
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
  mediaIds: z.array(z.string()).max(10).optional(),
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
    env.DB.prepare(`SELECT jm.job_id, ${mediaColumns} FROM job_media jm JOIN media m ON m.id = jm.media_id AND m.status = 'ready'
                    WHERE jm.job_id IN (${marks}) ORDER BY jm.position`).bind(...ids).all<MediaRow & { job_id: string }>(),
    env.DB.prepare(`SELECT j.id,
        (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'submitted') AS applications_count,
        (SELECT a.id FROM applications a WHERE a.job_id = j.id AND a.creator_profile_id = ? AND a.status = 'submitted') AS my_application_id,
        EXISTS (SELECT 1 FROM saved_jobs s WHERE s.job_id = j.id AND s.profile_id = ?) AS is_saved
        FROM jobs j WHERE j.id IN (${marks})`).bind(viewer, viewer, ...ids).all<Record<string, any>>(),
  ]);
  const mediaByJob = new Map<string, ReturnType<typeof mediaJSON>[]>();
  for (const m of mediaRows.results) mediaByJob.set(m.job_id, [...(mediaByJob.get(m.job_id) ?? []), mediaJSON(env, m)]);
  const statsById = new Map(stats.results.map((s) => [s.id, s]));
  return rows.map((j) => {
    const s = statsById.get(j.id) ?? {};
    return {
      id: j.id, ownerProfileId: j.owner_profile_id, owner: owners.get(j.owner_profile_id) ?? null, title: j.title,
      description: j.description, category: j.category, tags: parseJSON(j.tags, []), location: j.location,
      countryCode: j.country_code, city: j.city, flag: j.is_worldwide ? '🌍' : j.flag, isWorldwide: j.is_worldwide === 1,
      languages: parseJSON(j.languages, []), compensationType: j.compensation_type, budgetMin: j.budget_min,
      budgetMax: j.budget_max, currency: j.currency, deliverables: parseJSON(j.deliverables, []), deadline: j.deadline,
      status: j.status, publishedAt: j.published_at, closedAt: j.closed_at, createdAt: j.created_at, viewsCount: j.views_count,
      isDemo: j.is_demo === 1, media: mediaByJob.get(j.id) ?? [], applicationsCount: s.applications_count ?? 0,
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
    where.push(`j.status = 'published'`);
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
  if (!row || ((row.status === 'draft' || row.status === 'removed') && row.owner_user_id !== profile.ownerUserId)) fail(404, 'job_not_found');
  if (row!.owner_user_id !== profile.ownerUserId && row!.status === 'published') {
    c.executionCtx.waitUntil(c.env.DB.prepare(`UPDATE jobs SET views_count = views_count + 1 WHERE id = ?`).bind(row!.id).run());
  }
  return c.json((await jobsJSON(c.env, [row!], profile.id))[0]);
});

async function setJobMedia(env: Env, jobId: string, ownerId: string, mediaIds: string[] | undefined) {
  if (!mediaIds) return;
  const unique = [...new Set(mediaIds)];
  if (unique.length) {
    const owned = await env.DB.prepare(`SELECT COUNT(*) AS n FROM media WHERE owner_profile_id = ? AND status = 'ready'
        AND id IN (${unique.map(() => '?').join(',')})`).bind(ownerId, ...unique).first<{ n: number }>();
    if (owned?.n !== unique.length) fail(422, 'media_not_found');
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM job_media WHERE job_id = ?`).bind(jobId),
    ...unique.map((mid, i) => env.DB.prepare(`INSERT INTO job_media (job_id, media_id, position) VALUES (?, ?, ?)`).bind(jobId, mid, i)),
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
  await setJobMedia(c.env, id, profile.id, body.mediaIds);
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
  await setJobMedia(c.env, job.id, profile.id, body.mediaIds);
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(job.id).first<Record<string, any>>();
  return c.json((await jobsJSON(c.env, [row!], profile.id))[0]);
});

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
  }
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(job.id).first<Record<string, any>>();
  return c.json((await jobsJSON(c.env, [row!], profile.id))[0]);
});

jobs.delete('/:id', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'business');
  const job = await ownedJob(c.env, c.req.param('id'), profile.id);
  await c.env.DB.prepare(`DELETE FROM jobs WHERE id = ?`).bind(job.id).run();
  return c.json({ status: 'deleted' });
});

// PUT / DELETE /v1/jobs/:id/save — independent of Apply.
jobs.put('/:id/save', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c);
  const job = await c.env.DB.prepare(`SELECT 1 AS ok FROM jobs WHERE id = ? AND status IN ('published', 'closed')`).bind(c.req.param('id')).first();
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
  const ids = rows.map((r) => r.id);
  const [cards, mediaRows] = await Promise.all([
    loadCards(env, rows.map((r) => r.creator_profile_id)),
    env.DB.prepare(`SELECT am.application_id, ${mediaColumns} FROM application_media am JOIN media m ON m.id = am.media_id
                    AND m.status = 'ready' WHERE am.application_id IN (${ids.map(() => '?').join(',')}) ORDER BY am.position`)
      .bind(...ids).all<MediaRow & { application_id: string }>(),
  ]);
  const { signedMediaURL } = await import('./media');
  const byApp = new Map<string, unknown[]>();
  for (const m of mediaRows.results) {
    const json = mediaJSON(env, m);
    if (m.provider === 'r2' && m.purpose === 'application') json.url = await signedMediaURL(env, m.id);
    byApp.set(m.application_id, [...(byApp.get(m.application_id) ?? []), json]);
  }
  return rows.map((a) => ({
    id: a.id, jobId: a.job_id, message: a.message, status: a.status, createdAt: a.created_at, updatedAt: a.updated_at,
    withdrawnAt: a.withdrawn_at, isShortlisted: Boolean(a.shortlisted_at), applicant: cards.get(a.creator_profile_id) ?? null,
    media: byApp.get(a.id) ?? [],
  }));
}

// POST /v1/jobs/:id/apply — creator only; one active application; media only with creator.pro.
jobs.post('/:id/apply', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'creator');
  await rateLimit(c, 'RL_WRITE', `apply:${profile.ownerUserId}`);
  const body = ApplyBody.parse(await c.req.json());
  const job = await c.env.DB.prepare(`SELECT j.*, p.owner_user_id FROM jobs j JOIN profiles p ON p.id = j.owner_profile_id WHERE j.id = ?`)
    .bind(c.req.param('id')).first<Record<string, any>>();
  if (!job || job.status === 'draft' || job.status === 'removed') fail(404, 'job_not_found');
  if (job!.owner_user_id === profile.ownerUserId) fail(403, 'own_job');
  if (job!.status !== 'published') fail(409, 'job_closed');
  if (job!.deadline && job!.deadline < now()) fail(409, 'deadline_passed');
  if (body.mediaIds.length) {
    if (!(await isPro(c.env, profile.id))) fail(403, 'pro_required');
    const owned = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM media WHERE owner_profile_id = ? AND status = 'ready'
        AND id IN (${body.mediaIds.map(() => '?').join(',')})`).bind(profile.id, ...body.mediaIds).first<{ n: number }>();
    if (owned?.n !== new Set(body.mediaIds).size) fail(422, 'media_not_found');
  }
  const id = newId('app');
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO applications (id, job_id, creator_profile_id, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, job!.id, profile.id, body.message, now(), now()),
      ...[...new Set(body.mediaIds)].map((mid, i) =>
        c.env.DB.prepare(`INSERT INTO application_media (application_id, media_id, position) VALUES (?, ?, ?)`).bind(id, mid, i)),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) fail(409, 'already_applied');
    throw error;
  }
  await notify(c.env, job!.owner_profile_id, 'application_received', profile.id, { jobId: job!.id, applicationId: id, jobTitle: job!.title });
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
jobs.get('/:id/applications', requireAuth, requireProfile, async (c) => {
  const profile = actingProfile(c, 'business');
  await ownedJob(c.env, c.req.param('id'), profile.id);
  const sort = c.req.query('sort');
  const order = sort === 'oldest' ? 'a.created_at ASC' : sort === 'rating'
    ? `(SELECT AVG((r.quality + r.speed + r.contact) / 3.0) FROM reviews r WHERE r.recipient_profile_id = a.creator_profile_id
         AND r.status = 'published') DESC NULLS LAST, a.created_at DESC` : 'a.created_at DESC';
  const rows = await c.env.DB.prepare(`SELECT a.* FROM applications a WHERE a.job_id = ? AND a.status = 'submitted'
      AND (? = 0 OR a.shortlisted_at IS NOT NULL) ORDER BY ${order} LIMIT 200`)
    .bind(c.req.param('id'), c.req.query('shortlisted') === '1' ? 1 : 0).all<Record<string, any>>();
  return c.json({ items: await applicationsJSON(c.env, rows.results) });
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
