// Entitlements & Usage Limits — the one place that decides what a plan allows and how much of it is used.
//
// • The limits are server configuration (plan_config, migration 0014; defaults below). `null` = no numeric limit
//   (unlimited), never zero. Changing them needs neither an app nor a Worker release (PUT /v1/admin/plan-config).
// • Scope: creator.pro belongs to the creator profile that bought it (profile level); business.pro to the account —
//   any business profile of the account with an active business_pro subscription gives every business profile of that
//   account unlimited job posts. The free job-post allowance is the account's, shared by all its business profiles.
// • Usage is counted here only: portfolio videos from `media` (ready + pending uploads), job posts from `usage_events`
//   over a rolling 30 days (FEATURE 129): each publication holds a slot for 30 × 24 h from the moment it was made, then
//   frees it — deletion / archiving never gives one back earlier; re-opening a closed job is a new publication.
// • Every check that guards a write is atomic: the count and the insert are one SQL statement (D1 runs writes one at
//   a time), so parallel requests can't go past a limit.
import type { ActingProfile, Env } from '../env';
import { ApiError, newId, now } from './util';
import { monetizationEnabled } from './moderation';

export interface PlanConfig {
  creator: {
    free: CreatorPlanLimits;
    pro: CreatorPlanLimits;
  };
  business: {
    free: BusinessPlanLimits;
    pro: BusinessPlanLimits;
  };
}
interface CreatorPlanLimits {
  portfolio_video_limit: number | null;
  max_video_duration_seconds: number | null;
  collections_enabled: boolean;
  /** FIX 139: applications a creator may send in any 30 days (null: no limit). Withdrawing never gives one back. */
  applications_per_month: number | null;
}
interface BusinessPlanLimits {
  job_posts_per_month: number | null;
}

export const DEFAULT_PLAN_CONFIG: PlanConfig = {
  creator: {
    free: { portfolio_video_limit: null, max_video_duration_seconds: 30, collections_enabled: false, applications_per_month: 10 },
    pro: { portfolio_video_limit: null, max_video_duration_seconds: 30, collections_enabled: true, applications_per_month: null },
  },
  business: {
    free: { job_posts_per_month: 2 },
    pro: { job_posts_per_month: null },
  },
};

export type Feature = 'portfolio_videos' | 'job_posts' | 'collections' | 'video_duration' | 'applications';

/** The stored configuration over the defaults (a key missing from the stored JSON keeps its default). */
export async function loadPlanConfig(env: Env): Promise<PlanConfig> {
  const row = await env.DB.prepare(`SELECT config FROM plan_config WHERE id = 'current'`).first<{ config: string }>()
    .catch(() => null);
  if (!row) return DEFAULT_PLAN_CONFIG;
  try {
    const stored = JSON.parse(row.config) as Partial<PlanConfig>;
    return {
      creator: {
        // FIX 171: no plan limits the portfolio (a stored number from before is ignored — PORTFOLIO_VIDEO_CAP applies).
        free: { ...DEFAULT_PLAN_CONFIG.creator.free, ...stored.creator?.free, portfolio_video_limit: null },
        pro: { ...DEFAULT_PLAN_CONFIG.creator.pro, ...stored.creator?.pro, portfolio_video_limit: null },
      },
      business: {
        free: { ...DEFAULT_PLAN_CONFIG.business.free, ...stored.business?.free },
        pro: { ...DEFAULT_PLAN_CONFIG.business.pro, ...stored.business?.pro },
      },
    };
  } catch {
    return DEFAULT_PLAN_CONFIG;
  }
}

/** The calendar month (UTC) around `t`: [start, end) — the period a usage row is filed under (reports only). */
export function monthPeriod(t = now()): { start: number; end: number } {
  const d = new Date(t);
  return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}

/** FEATURE 129: how long one job publication holds its slot. */
export const JOB_POST_WINDOW = 30 * 86_400_000;

interface PlanState { active: boolean; scope: 'profile' | 'account'; expiresAt: number | null }

/** creator.pro of this creator profile (profile level). */
async function creatorPro(env: Env, profileId: string): Promise<PlanState> {
  const row = await env.DB.prepare(`SELECT MAX(COALESCE(expires_at, 9e15)) AS until FROM subscriptions WHERE profile_id = ?
      AND plan = 'creator_pro' AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`).bind(profileId, now())
    .first<{ until: number | null }>();
  return { active: row?.until != null, scope: 'profile', expiresAt: row?.until != null && row.until < 9e15 ? row.until : null };
}

/** business.pro of the account: any of its business profiles' active subscription (account level). */
async function businessPro(env: Env, userId: string): Promise<PlanState> {
  const row = await env.DB.prepare(`SELECT MAX(COALESCE(s.expires_at, 9e15)) AS until FROM subscriptions s
      JOIN profiles p ON p.id = s.profile_id WHERE p.owner_user_id = ? AND p.status <> 'deleted' AND p.type = 'business'
      AND s.plan = 'business_pro' AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?)`).bind(userId, now())
    .first<{ until: number | null }>();
  return { active: row?.until != null, scope: 'account', expiresAt: row?.until != null && row.until < 9e15 ? row.until : null };
}

export interface Usage {
  feature: Feature;
  scope: 'profile' | 'account';
  limit: number | null;
  used: number;
  /** Uploads authorised but not finished yet — they hold a place (portfolio videos). */
  pending?: number;
  remaining: number | null;
  unlimited: boolean;
  allowed: boolean;
  /** Why not allowed: limit_reached | pro_required | wrong_profile_type. */
  reason: string | null;
  period?: 'calendar_month' | 'rolling_30_days';
  periodStart?: number;
  periodEnd?: number;
  resetsAt?: number;
  maxDurationSeconds?: number | null;
  /** FEATURE 130: job-post slots an administrator added on top of the plan. */
  bonus?: number;
  plan: 'free' | 'pro';
}

function counted(feature: Feature, scope: Usage['scope'], limit: number | null, used: number, pending: number,
                 pro: boolean): Usage {
  const remaining = limit == null ? null : Math.max(0, limit - used - pending);
  const allowed = limit == null || used + pending < limit;
  return { feature, scope, limit, used, remaining, unlimited: limit == null, allowed,
           reason: allowed ? null : 'limit_reached', plan: pro ? 'pro' : 'free' };
}

/** SQL (with 2 bindings: profile id, stale-pending cutoff) counting a profile's portfolio videos that hold a place. */
const PORTFOLIO_VIDEOS_HELD = `SELECT
    COALESCE(SUM(status = 'ready'), 0) AS ready, COALESCE(SUM(status = 'pending'), 0) AS pending
  FROM media WHERE owner_profile_id = ? AND purpose = 'portfolio' AND kind = 'video'
   AND (status = 'ready' OR (status = 'pending' AND created_at >= ?))
   AND review_status NOT IN ('rejected', 'removed')`;
/** The same as a scalar for a conditional INSERT. */
export const PORTFOLIO_VIDEOS_COUNT_SQL = `(SELECT COUNT(*) FROM media WHERE owner_profile_id = ? AND purpose = 'portfolio'
   AND kind = 'video' AND (status = 'ready' OR (status = 'pending' AND created_at >= ?))
   AND review_status NOT IN ('rejected', 'removed'))`;
/** A pending upload older than this no longer holds its place. */
// FIX 139: an upload that never arrived stops holding its place after 15 minutes (the app also cancels it at once).
export const PENDING_UPLOAD_TTL = 900_000;

/** FIX 171: a portfolio has no plan limit any more (free or PRO): only this system ceiling, never shown in the apps. */
export const PORTFOLIO_VIDEO_CAP = 90;

/** `proActive`: the plan state when the caller already has it (the snapshot) — not asked again. */
export async function portfolioVideosUsage(env: Env, profile: ActingProfile, config?: PlanConfig,
                                           proActive?: boolean): Promise<Usage> {
  if (profile.type !== 'creator') {
    return { ...counted('portfolio_videos', 'profile', 0, 0, 0, false), allowed: false, reason: 'wrong_profile_type' };
  }
  const cfg = config ?? await loadPlanConfig(env);
  const pro = !monetizationEnabled(env) || (proActive ?? (await creatorPro(env, profile.id)).active);
  const plan = pro ? cfg.creator.pro : cfg.creator.free;
  const row = await env.DB.prepare(PORTFOLIO_VIDEOS_HELD).bind(profile.id, now() - PENDING_UPLOAD_TTL)
    .first<{ ready: number; pending: number }>();
  const usage = counted('portfolio_videos', 'profile', PORTFOLIO_VIDEO_CAP, row?.ready ?? 0, row?.pending ?? 0, pro);
  return { ...usage, pending: row?.pending ?? 0, maxDurationSeconds: plan.max_video_duration_seconds };
}

export async function jobPostsUsage(env: Env, profile: ActingProfile, config?: PlanConfig,
                                    proActive?: boolean): Promise<Usage> {
  const cfg = config ?? await loadPlanConfig(env);
  const [pro, slots] = await Promise.all([
    proActive !== undefined || !monetizationEnabled(env) ? Promise.resolve(!monetizationEnabled(env) || !!proActive)
      : businessPro(env, profile.ownerUserId).then((s) => s.active),
    jobPostSlots(env, profile.ownerUserId),
  ]);
  const base = (pro ? cfg.business.pro : cfg.business.free).job_posts_per_month;
  // FEATURE 130: slots an administrator added on top of the plan; a reset counts only what's published after it.
  const limit = base == null ? null : base + slots.bonus;
  const since = Math.max(now() - JOB_POST_WINDOW, slots.resetAt ?? 0);
  // The publications still holding a slot, oldest first: the oldest one's slot is the next to come back.
  const rows = await env.DB.prepare(`SELECT created_at FROM usage_events WHERE user_id = ? AND feature = 'job_posts'
      AND created_at > ? ORDER BY created_at`).bind(profile.ownerUserId, since).all<{ created_at: number }>();
  const used = rows.results.length;
  const usage = counted('job_posts', 'account', limit, used, 0, pro);
  const shown = profile.type === 'business' ? usage : { ...usage, allowed: false, reason: 'wrong_profile_type' };
  // When a slot comes back: the oldest counted publication + 30 days (the next one, if the limit is reached).
  const nextFree = limit != null && used >= limit && used > 0 ? rows.results[used - limit].created_at + JOB_POST_WINDOW : undefined;
  return { ...shown, bonus: slots.bonus, period: 'rolling_30_days', periodStart: since, periodEnd: now(),
           resetsAt: nextFree ?? (used ? rows.results[0].created_at + JOB_POST_WINDOW : undefined) };
}

/** FIX 139: a creator profile's applications in the last 30 days (rolling, like job posts): each one sent holds its
 *  place for 30 days — withdrawing it doesn't give it back. */
export async function applicationsUsage(env: Env, profile: ActingProfile, config?: PlanConfig,
                                        proActive?: boolean): Promise<Usage> {
  const cfg = config ?? await loadPlanConfig(env);
  const pro = !monetizationEnabled(env) || (proActive ?? (await creatorPro(env, profile.id)).active);
  const limit = (pro ? cfg.creator.pro : cfg.creator.free).applications_per_month;
  const since = now() - JOB_POST_WINDOW;
  const rows = await env.DB.prepare(`SELECT created_at FROM usage_events WHERE profile_id = ? AND feature = 'applications'
      AND created_at > ? ORDER BY created_at`).bind(profile.id, since).all<{ created_at: number }>();
  const used = rows.results.length;
  const usage = counted('applications', 'profile', limit, used, 0, pro);
  const shown = profile.type === 'creator' ? usage : { ...usage, allowed: false, reason: 'wrong_profile_type' };
  const nextFree = limit != null && used >= limit && used > 0 ? rows.results[used - limit].created_at + JOB_POST_WINDOW : undefined;
  return { ...shown, period: 'rolling_30_days', periodStart: since, periodEnd: now(),
           resetsAt: nextFree ?? (used ? rows.results[0].created_at + JOB_POST_WINDOW : undefined) };
}

/** FIX 139: spends one application for `applicationId` — atomic (the count and the insert are one statement); false when
 *  the limit is reached. */
export async function spendApplication(env: Env, profile: ActingProfile, applicationId: string): Promise<boolean> {
  const usage = await applicationsUsage(env, profile);
  if (usage.limit == null) {
    await env.DB.prepare(`INSERT OR IGNORE INTO usage_events (id, user_id, profile_id, feature, subject_id, period_start, created_at)
        VALUES (?, ?, ?, 'applications', ?, ?, ?)`).bind(newId('use'), profile.ownerUserId, profile.id, applicationId,
        monthPeriod().start, now()).run();
    return true;
  }
  const t = now();
  const res = await env.DB.prepare(`INSERT OR IGNORE INTO usage_events (id, user_id, profile_id, feature, subject_id, period_start, created_at)
      SELECT ?, ?, ?, 'applications', ?, ?, ?
       WHERE (SELECT COUNT(*) FROM usage_events WHERE profile_id = ? AND feature = 'applications' AND created_at > ?) < ?`)
    .bind(newId('use'), profile.ownerUserId, profile.id, applicationId, monthPeriod(t).start, t,
          profile.id, t - JOB_POST_WINDOW, usage.limit).run();
  return (res.meta.changes ?? 0) > 0;
}

/** FEATURE 130: the account's extra job-post slots and the last reset (an administrator's). */
export async function jobPostSlots(env: Env, userId: string): Promise<{ bonus: number; resetAt: number | null }> {
  const row = await env.DB.prepare(`SELECT job_posts_bonus, job_posts_reset_at FROM users WHERE id = ?`).bind(userId)
    .first<{ job_posts_bonus: number | null; job_posts_reset_at: number | null }>();
  return { bonus: Math.max(0, row?.job_posts_bonus ?? 0), resetAt: row?.job_posts_reset_at ?? null };
}

/** Everything the app shows about the acting profile's plan and limits (GET /v1/me/entitlements). */
export async function entitlementsSnapshot(env: Env, profile: ActingProfile) {
  const config = await loadPlanConfig(env);
  const monetization = monetizationEnabled(env);
  const [cPro, bPro] = await Promise.all([
    profile.type === 'creator' ? creatorPro(env, profile.id) : Promise.resolve<PlanState>({ active: false, scope: 'profile', expiresAt: null }),
    businessPro(env, profile.ownerUserId),
  ]);
  const creatorPlan = !monetization || cPro.active ? config.creator.pro : config.creator.free;
  // The plan states above are reused (not asked again), the two counts run side by side.
  const [jobPosts, portfolioVideos, applications] = await Promise.all([
    jobPostsUsage(env, profile, config, bPro.active),
    profile.type === 'creator' ? portfolioVideosUsage(env, profile, config, cPro.active) : Promise.resolve(null),
    profile.type === 'creator' ? applicationsUsage(env, profile, config, cPro.active) : Promise.resolve(null),
  ]);
  const features: Record<string, unknown> = { job_posts: jobPosts };
  if (applications) features.applications = applications;
  if (portfolioVideos) {
    features.portfolio_videos = portfolioVideos;
    features.video_duration = { feature: 'video_duration', scope: 'profile', maxSeconds: creatorPlan.max_video_duration_seconds };
    const enabled = creatorPlan.collections_enabled;
    features.collections = { feature: 'collections', scope: 'profile', enabled, access: enabled ? 'available' : 'locked',
                             allowed: enabled, reason: enabled ? null : 'pro_required' };
  }
  return {
    accountId: profile.ownerUserId,
    profileId: profile.id,
    profileType: profile.type,
    monetizationEnabled: monetization,
    plans: { creatorPro: profile.type === 'creator' ? cPro : null, businessPro: bPro },
    features,
    /** Every plan's limits (what Free and PRO allow) — the app's texts ("Up to 9 videos on the free plan") come from
     *  here, never from constants in the app. */
    planLimits: config,
    serverTime: now(),
  };
}

/** canPerform(feature, account, profile): may this profile of this account do it now? The profile must be the
 *  account's own (the account always comes from the session, never from the request body). */
export async function canPerform(env: Env, feature: 'portfolio_videos' | 'job_posts', accountId: string,
                                 profileId: string): Promise<Usage> {
  const row = await env.DB.prepare(`SELECT id, type, owner_user_id FROM profiles WHERE id = ? AND status = 'active'`)
    .bind(profileId).first<{ id: string; type: ActingProfile['type']; owner_user_id: string }>();
  if (!row || row.owner_user_id !== accountId) throw new ApiError(403, 'not_profile_owner');
  const profile = { id: row.id, type: row.type, ownerUserId: row.owner_user_id };
  return feature === 'job_posts' ? jobPostsUsage(env, profile) : portfolioVideosUsage(env, profile);
}

/** The structured refusal: { error: { code: 'FEATURE_LIMIT_REACHED', feature, limit, used, remaining, … } }. */
export function limitReached(usage: Usage): never {
  throw new ApiError(403, 'FEATURE_LIMIT_REACHED', 'The plan limit for this feature is reached.', {
    feature: usage.feature, scope: usage.scope, limit: usage.limit, used: usage.used, pending: usage.pending,
    remaining: 0, plan: usage.plan, period: usage.period, periodStart: usage.periodStart, periodEnd: usage.periodEnd,
    resetsAt: usage.resetsAt,
  });
}

/**
 * The statement that spends one job post for `jobId` — only if the account is under its monthly limit (or has
 * none). Atomic: count and insert are one statement. Put it in the same D1 batch as the write it pays for, and make
 * that write conditional on `jobPostSpentSQL` so nothing is published without its row.
 */
export async function spendJobPost(env: Env, profile: ActingProfile, jobId: string, subjectId = jobId) {
  const usage = await jobPostsUsage(env, profile);
  if (profile.type !== 'business') throw new ApiError(403, 'business_profile_required');
  const t = now();
  // Atomic: the count over the last 30 days and the insert are one statement (parallel publications can't pass the
  // limit). `subjectId`: the job for a first publication, the job + its close for a re-opening (UNIQUE — a retry of the
  // same publication never spends twice).
  const statement = env.DB.prepare(`INSERT OR IGNORE INTO usage_events (id, user_id, profile_id, feature, subject_id, period_start, created_at)
      SELECT ?, ?, ?, 'job_posts', ?, ?, ?
       WHERE ? IS NULL OR (SELECT COUNT(*) FROM usage_events WHERE user_id = ? AND feature = 'job_posts' AND created_at > ?) < ?`)
    .bind(newId('use'), profile.ownerUserId, profile.id, subjectId, monthPeriod(t).start, t,
          usage.limit, profile.ownerUserId, Math.max(t - JOB_POST_WINDOW, usage.periodStart ?? 0), usage.limit);
  return { statement, usage, subjectId };
}
export const jobPostSpentSQL = `EXISTS (SELECT 1 FROM usage_events WHERE feature = 'job_posts' AND subject_id = ?)`;

/** Validated replacement of the stored configuration (admin). */
export function validPlanConfig(input: unknown): PlanConfig {
  const limit = (v: unknown, name: string) => {
    if (v === null) return null;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000) return v;
    throw new ApiError(422, 'invalid_plan_config', `${name}: a whole number ≥ 0, or null (unlimited)`);
  };
  const cfg = input as PlanConfig;
  const out = structuredClone(DEFAULT_PLAN_CONFIG);
  for (const tier of ['free', 'pro'] as const) {
    const c = cfg?.creator?.[tier];
    if (c) {
      if ('portfolio_video_limit' in c) out.creator[tier].portfolio_video_limit = limit(c.portfolio_video_limit, `creator.${tier}.portfolio_video_limit`);
      if ('max_video_duration_seconds' in c) out.creator[tier].max_video_duration_seconds = limit(c.max_video_duration_seconds, `creator.${tier}.max_video_duration_seconds`);
      if ('collections_enabled' in c) out.creator[tier].collections_enabled = Boolean(c.collections_enabled);
    }
    const b = cfg?.business?.[tier];
    if (b && 'job_posts_per_month' in b) out.business[tier].job_posts_per_month = limit(b.job_posts_per_month, `business.${tier}.job_posts_per_month`);
  }
  return out;
}
