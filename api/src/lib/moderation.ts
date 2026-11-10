// Moderation helpers shared by the routes: automatic pre-checks (free, rule based; optional Google Cloud Vision
// SafeSearch only when its key is configured), blocks between accounts, account restrictions, the monetization switch.
//
// Automatic checks never decide anything irreversible: they only route content to a moderator (review_status
// 'flagged' or an automatic report). New public media always waits for a moderator ('pending' / 'flagged').
import type { Context } from 'hono';
import type { AppEnv, Env } from '../env';
import { fail, newId, now, sha256Hex } from './util';

// ─── Monetization ───

/** Paid plans are switched off until StoreKit 2 exists: nobody sees PRO, every feature is open to everyone. */
export const monetizationEnabled = (env: Env) => (env.MONETIZATION_ENABLED ?? 'false') === 'true';

// ─── Text checks ───

export interface TextVerdict { flagged: boolean; categories: string[]; reasons: string[] }

// Short, conservative patterns: they only send text to a human. Word boundaries keep ordinary words out.
const RULES: { category: string; pattern: RegExp; reason: string }[] = [
  { category: 'scam', reason: 'payment outside platform / advance fee',
    pattern: /\b(western union|moneygram|gift ?cards?|wire (me|the) money|send (me )?(btc|bitcoin|usdt|crypto)|double your (money|crypto)|guaranteed (profit|returns?)|investment opportunity)\b/i },
  { category: 'scam', reason: 'credential phishing',
    pattern: /\b(verify your (account|password)|send (me )?your (password|code|login)|(your|the) (sms|verification) code)\b/i },
  { category: 'sexual', reason: 'explicit sexual content',
    pattern: /\b(porn\w*|xxx|nudes?|onlyfans|sex ?chat|escort service|blow ?job|hand ?job|cum ?shot|camgirl|sugar ?daddy)\b/i },
  { category: 'sexual', reason: 'explicit sexual content (ru)',
    pattern: /(порн\p{L}*|интим[\s-]?услуг\p{L}*|эскорт|секс[\s-]?чат|голые фото)/iu },
  { category: 'violence', reason: 'threat of violence',
    pattern: /\b(i('| a)?m going to|i will|gonna) (kill|shoot|stab|hurt|rape) (you|u|him|her|them)\b|\b(kill yourself|kys)\b/i },
  { category: 'violence', reason: 'threat of violence (ru)',
    pattern: /(убью тебя|я тебя убью|убейся|зарежу|пристрелю)/iu },
  { category: 'illegal', reason: 'drugs / weapons trade',
    pattern: /\b(buy|sell|selling) (cocaine|heroin|meth|mdma|fentanyl|guns?|firearms?)\b/i },
];

/** Rule-based screening of public text (job posts, bios, reviews, application messages). */
export function checkText(...parts: (string | null | undefined)[]): TextVerdict {
  const text = parts.filter(Boolean).join('\n');
  const categories = new Set<string>();
  const reasons: string[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(text)) { categories.add(rule.category); reasons.push(rule.reason); }
  }
  // Spam shapes: many links, a long run of one character, shouting.
  const links = text.match(/https?:\/\/|www\.|t\.me\/|wa\.me\//gi)?.length ?? 0;
  if (links >= 4) { categories.add('spam'); reasons.push(`${links} links`); }
  if (/(.)\1{14,}/u.test(text)) { categories.add('spam'); reasons.push('repeated characters'); }
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 40 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    categories.add('spam'); reasons.push('all caps');
  }
  return { flagged: categories.size > 0, categories: [...categories], reasons };
}

// ─── Image checks (optional) ───

export interface ImageVerdict { checked: boolean; flagged: boolean; detail: Record<string, string> }

/**
 * Google Cloud Vision SafeSearch — only when the GOOGLE_VISION_API_KEY secret is set (off by default: it sends the
 * image to Google, which the Privacy Policy must name first). Unavailable / failed check → { checked: false }:
 * the item then simply stays in the manual queue.
 */
export async function checkImage(env: Env, bytes: ArrayBuffer): Promise<ImageVerdict> {
  if (!env.GOOGLE_VISION_API_KEY || bytes.byteLength > 8 * 1024 * 1024) return { checked: false, flagged: false, detail: {} };
  try {
    let binary = '';
    const view = new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${env.GOOGLE_VISION_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: btoa(binary) }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { checked: false, flagged: false, detail: {} };
    const json = (await res.json()) as { responses?: { safeSearchAnnotation?: Record<string, string> }[] };
    const s = json.responses?.[0]?.safeSearchAnnotation;
    if (!s) return { checked: false, flagged: false, detail: {} };
    const high = ['LIKELY', 'VERY_LIKELY'];
    const flagged = high.includes(s.adult) || high.includes(s.violence) || s.racy === 'VERY_LIKELY';
    return { checked: true, flagged, detail: { adult: s.adult, violence: s.violence, racy: s.racy } };
  } catch {
    return { checked: false, flagged: false, detail: {} };
  }
}

// ─── Automatic reports ───

/** Puts flagged text (a bio, a display name) in the moderators' queue without hiding anything. */
export async function autoReport(env: Env, target: { type: 'user' | 'post' | 'review' | 'media'; id: string; profileId: string | null },
                                 verdict: TextVerdict, excerpt: string) {
  const ownerRow = target.profileId
    ? await env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(target.profileId).first<{ owner_user_id: string }>()
    : null;
  const open = await env.DB.prepare(`SELECT id FROM reports WHERE source = 'auto' AND target_type = ? AND target_id = ?
      AND status IN ('pending', 'under_review')`).bind(target.type, target.id).first();
  if (open) return;
  const category = verdict.categories[0] ?? 'other';
  await env.DB.prepare(`INSERT INTO reports (id, source, target_type, target_id, target_profile_id, target_user_id, category, details,
      priority, context, created_at, updated_at) VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(newId('rep'), target.type, target.id, target.profileId, ownerRow?.owner_user_id ?? null, category,
          `Automatic check: ${verdict.reasons.join(', ')}`.slice(0, 1000), priorityOf(category),
          JSON.stringify({ excerpt: excerpt.slice(0, 500) }), now(), now()).run();
}

export function priorityOf(category: string): 'normal' | 'high' | 'urgent' {
  if (category === 'violence' || category === 'illegal') return 'urgent';
  if (category === 'sexual' || category === 'harassment' || category === 'hate') return 'high';
  return 'normal';
}

// ─── Blocks ───

/** True when either account blocked the other. */
export async function blockedBetweenUsers(env: Env, a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM blocks WHERE (blocker_user_id = ?1 AND blocked_user_id = ?2)
      OR (blocker_user_id = ?2 AND blocked_user_id = ?1) LIMIT 1`).bind(a, b).first();
  return Boolean(row);
}

/** Same, for two profiles (their owner accounts). */
export async function blockedBetweenProfiles(env: Env, a: string, b: string): Promise<boolean> {
  const rows = await env.DB.prepare(`SELECT id, owner_user_id FROM profiles WHERE id IN (?, ?)`).bind(a, b)
    .all<{ id: string; owner_user_id: string }>();
  const ua = rows.results.find((r) => r.id === a)?.owner_user_id;
  const ub = rows.results.find((r) => r.id === b)?.owner_user_id;
  return ua && ub ? blockedBetweenUsers(env, ua, ub) : false;
}

/** SQL fragment (for a profile alias's owner column) that leaves out everyone the viewer blocked or was blocked by. */
export const notBlockedSQL = (ownerColumn: string, viewerParam: string) =>
  `${ownerColumn} NOT IN (SELECT blocked_user_id FROM blocks WHERE blocker_user_id = ${viewerParam}
     UNION SELECT blocker_user_id FROM blocks WHERE blocked_user_id = ${viewerParam})`;

// ─── Restrictions ───

/** Posting is refused while a moderator's restriction lasts (sign-in still works). */
export async function assertCanPost(c: Context<AppEnv>) {
  const user = c.get('user');
  if (!user) return;
  const row = await c.env.DB.prepare(`SELECT restricted_until FROM users WHERE id = ?`).bind(user.id).first<{ restricted_until: number | null }>();
  if (row?.restricted_until && row.restricted_until > now()) fail(403, 'account_restricted');
}

export const emailHash = (email: string) => sha256Hex(`kolaba-ban:${email.trim().toLowerCase()}`);

export async function isBannedEmail(env: Env, email: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM banned_identities WHERE email_hash = ?`).bind(await emailHash(email)).first();
  return Boolean(row);
}

// ─── Media review ───

/** Purposes whose files are shown publicly and therefore wait for a moderator. */
export const PUBLIC_REVIEW_PURPOSES = new Set(['avatar', 'portfolio', 'intro', 'collection', 'job']);

/** SQL: media alias `m` visible to everyone (approved), or also to its owner profile (any state but rejected/removed). */
export const visibleMediaSQL = (alias = 'm', ownerParam?: string) => ownerParam
  ? `(${alias}.review_status = 'approved' OR (${alias}.owner_profile_id = ${ownerParam} AND ${alias}.review_status IN ('pending', 'flagged')))`
  : `${alias}.review_status = 'approved'`;
