// Safety: reports (users, posts, media, messages, conversations, reviews), blocks, feedback to the kolaba team.
// Everything is done as the signed-in account and its acting profile; nothing the client says about ids or roles is
// trusted — targets are looked up here, their owners decided here.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, currentUser, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { loadCards } from '../lib/cards';
import { priorityOf } from '../lib/moderation';
import { fail, newId, now } from '../lib/util';

// ─────────────────────────── Reports ───────────────────────────

export const reports = new Hono<AppEnv>();
reports.use('*', requireAuth, requireProfile);

const CATEGORIES = ['spam', 'sexual', 'violence', 'harassment', 'hate', 'scam', 'impersonation', 'copyright', 'illegal', 'other'] as const;
// Older clients (web, earlier iOS builds) send these names; they keep working.
const LEGACY_TYPES: Record<string, string> = { profile: 'user', job: 'post' };
const LEGACY_REASONS: Record<string, string> = { inappropriate: 'other' };
const REPORTS_PER_DAY = 30;
const CONTEXT_BEFORE = 4;          // messages shown before a reported message
const CONVERSATION_EXCERPT = 20;   // messages copied for a reported conversation

const ReportBody = z.object({
  targetType: z.string().transform((t) => LEGACY_TYPES[t] ?? t)
    .pipe(z.enum(['user', 'post', 'media', 'message', 'conversation', 'review'])),
  targetId: z.string().min(1).max(80),
  category: z.string().optional(),
  reason: z.string().optional(),        // legacy name of `category`
  details: z.string().trim().max(1000).optional(),
  /** Message / conversation reports: the reporter agrees to share these messages (and a little context) with moderators. */
  consentToShareMessages: z.boolean().optional(),
  conversationId: z.string().max(80).optional(),
});

interface Target { profileId: string | null; userId: string | null; conversationId?: string; context: Record<string, unknown> }

/** Finds what is reported and whose it is — or refuses (not found / not visible to the reporter). */
async function resolveTarget(env: Env, type: string, id: string, reporterProfileId: string): Promise<Target> {
  const owner = async (profileId: string | null) => profileId
    ? (await env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(profileId).first<{ owner_user_id: string }>())?.owner_user_id ?? null
    : null;
  switch (type) {
    case 'user': {
      const p = await env.DB.prepare(`SELECT id, owner_user_id, display_name, username, bio FROM profiles WHERE id = ? AND status <> 'deleted'`)
        .bind(id).first<Record<string, string>>();
      if (!p) fail(404, 'target_not_found');
      return { profileId: p!.id, userId: p!.owner_user_id, context: { title: p!.display_name, username: p!.username, excerpt: (p!.bio ?? '').slice(0, 300) } };
    }
    case 'post': {
      const j = await env.DB.prepare(`SELECT owner_profile_id, title, description FROM jobs WHERE id = ? AND status <> 'draft'`).bind(id)
        .first<Record<string, string>>();
      if (!j) fail(404, 'target_not_found');
      return { profileId: j!.owner_profile_id, userId: await owner(j!.owner_profile_id),
               context: { title: j!.title, excerpt: (j!.description ?? '').slice(0, 300) } };
    }
    case 'media': {
      const m = await env.DB.prepare(`SELECT owner_profile_id, kind, purpose, is_public FROM media WHERE id = ? AND status = 'ready'`).bind(id)
        .first<{ owner_profile_id: string; kind: string; purpose: string; is_public: number }>();
      // Only public media is reported directly; a chat attachment is reported through its message.
      if (!m || !m.is_public) fail(404, 'target_not_found');
      return { profileId: m!.owner_profile_id, userId: await owner(m!.owner_profile_id), context: { kind: m!.kind, purpose: m!.purpose } };
    }
    case 'review': {
      const r = await env.DB.prepare(`SELECT author_profile_id, author_user_id, comment FROM reviews WHERE id = ?`).bind(id)
        .first<Record<string, string>>();
      if (!r) fail(404, 'target_not_found');
      return { profileId: r!.author_profile_id, userId: r!.author_user_id, context: { excerpt: (r!.comment ?? '').slice(0, 300) } };
    }
    case 'message': {
      const m = await env.DB.prepare(`SELECT m.conversation_id, m.sender_profile_id FROM messages m
          JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.profile_id = ?
          WHERE m.id = ? AND m.deleted_at IS NULL AND m.created_at > COALESCE(cp.cleared_at, 0)`).bind(reporterProfileId, id)
        .first<{ conversation_id: string; sender_profile_id: string }>();
      if (!m) fail(404, 'target_not_found');
      return { profileId: m!.sender_profile_id, userId: await owner(m!.sender_profile_id), conversationId: m!.conversation_id, context: {} };
    }
    case 'conversation': {
      const other = await env.DB.prepare(`SELECT other.profile_id FROM conversation_participants me
          JOIN conversation_participants other ON other.conversation_id = me.conversation_id AND other.profile_id <> me.profile_id
          WHERE me.conversation_id = ? AND me.profile_id = ?`).bind(id, reporterProfileId).first<{ profile_id: string }>();
      if (!other) fail(404, 'target_not_found');
      return { profileId: other!.profile_id, userId: await owner(other!.profile_id), conversationId: id, context: {} };
    }
  }
  return fail(400, 'invalid_target');
}

/** A copy of only the messages the reporter agreed to share (the one reported + a few before it, or a recent excerpt). */
async function captureEvidence(env: Env, reportId: string, type: string, targetId: string, conversationId: string, reporterProfileId: string) {
  const cleared = await env.DB.prepare(`SELECT COALESCE(cleared_at, 0) AS t FROM conversation_participants WHERE conversation_id = ? AND profile_id = ?`)
    .bind(conversationId, reporterProfileId).first<{ t: number }>();
  let rows: Record<string, any>[];
  if (type === 'message') {
    const target = await env.DB.prepare(`SELECT created_at FROM messages WHERE id = ?`).bind(targetId).first<{ created_at: number }>();
    rows = (await env.DB.prepare(`SELECT * FROM messages WHERE conversation_id = ? AND deleted_at IS NULL AND created_at > ?
        AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(conversationId, cleared?.t ?? 0, target!.created_at, CONTEXT_BEFORE + 1).all<Record<string, any>>()).results;
  } else {
    rows = (await env.DB.prepare(`SELECT * FROM messages WHERE conversation_id = ? AND deleted_at IS NULL AND created_at > ?
        ORDER BY created_at DESC, id DESC LIMIT ?`).bind(conversationId, cleared?.t ?? 0, CONVERSATION_EXCERPT).all<Record<string, any>>()).results;
  }
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const [attachments, voices] = await Promise.all([
    env.DB.prepare(`SELECT ma.message_id, m.id, m.kind FROM message_attachments ma JOIN media m ON m.id = ma.media_id WHERE ma.message_id IN (${marks})`)
      .bind(...ids).all<{ message_id: string; id: string; kind: string }>(),
    env.DB.prepare(`SELECT message_id FROM message_voice WHERE message_id IN (${marks})`).bind(...ids).all<{ message_id: string }>(),
  ]);
  const voiceSet = new Set(voices.results.map((v) => v.message_id));
  await env.DB.batch(rows.map((r) => env.DB.prepare(`INSERT OR IGNORE INTO report_evidence (report_id, message_id, sender_profile_id, is_reported,
      body, attachments, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(reportId, r.id, r.sender_profile_id, Number(r.id === targetId), r.body ?? '',
          JSON.stringify([...attachments.results.filter((a) => a.message_id === r.id).map((a) => ({ mediaId: a.id, kind: a.kind })),
                          ...(voiceSet.has(r.id) ? [{ voiceMessageId: r.id, kind: 'voice' }] : [])]), r.created_at)));
  return rows.length;
}

// POST /v1/reports — {targetType, targetId, category, details?, consentToShareMessages?}
reports.post('/', async (c) => {
  const profile = actingProfile(c);
  const user = currentUser(c);
  await rateLimit(c, 'RL_WRITE', `report:${user.id}`);
  const body = ReportBody.parse(await c.req.json());
  const rawCategory = body.category ?? body.reason ?? '';
  const category = (LEGACY_REASONS[rawCategory] ?? rawCategory) as (typeof CATEGORIES)[number];
  if (!CATEGORIES.includes(category)) fail(422, 'invalid_category');
  // "Other" needs a few words (an old client's "inappropriate" maps to it without them).
  if (category === 'other' && rawCategory === 'other' && (body.details ?? '').length < 5) fail(422, 'details_required');
  const isMessages = body.targetType === 'message' || body.targetType === 'conversation';
  if (isMessages && body.consentToShareMessages !== true) fail(422, 'consent_required');

  const today = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM reports WHERE reporter_user_id = ? AND created_at > ?`)
    .bind(user.id, now() - 86_400_000).first<{ n: number }>();
  if ((today?.n ?? 0) >= REPORTS_PER_DAY) fail(429, 'rate_limited');

  const target = await resolveTarget(c.env, body.targetType, body.targetId, profile.id);
  if (target.userId === user.id) fail(422, 'cannot_report_self');

  // The same reporter can't file the same open report twice: the existing one is returned.
  const open = await c.env.DB.prepare(`SELECT id, status FROM reports WHERE reporter_user_id = ? AND target_type = ? AND target_id = ?
      AND status IN ('pending', 'under_review')`).bind(user.id, body.targetType, body.targetId).first<{ id: string; status: string }>();
  if (open) return c.json({ id: open.id, status: open.status, duplicate: true });

  // More open reports against the same account raise the priority.
  const others = target.userId ? await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM reports WHERE target_user_id = ?
      AND status IN ('pending', 'under_review')`).bind(target.userId).first<{ n: number }>() : null;
  let priority = priorityOf(category);
  if (priority === 'normal' && (others?.n ?? 0) >= 2) priority = 'high';

  const id = newId('rep');
  try {
    await c.env.DB.prepare(`INSERT INTO reports (id, reporter_user_id, reporter_profile_id, target_type, target_id, target_profile_id,
        target_user_id, conversation_id, category, details, priority, consent_shared_messages, context, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, user.id, profile.id, body.targetType, body.targetId, target.profileId, target.userId, target.conversationId ?? null,
            category, body.details || null, priority, isMessages ? 1 : 0, JSON.stringify(target.context), now(), now()).run();
  } catch (error) {
    if (!String(error).includes('UNIQUE')) throw error;
    const again = await c.env.DB.prepare(`SELECT id, status FROM reports WHERE reporter_user_id = ? AND target_type = ? AND target_id = ?
        AND status IN ('pending', 'under_review')`).bind(user.id, body.targetType, body.targetId).first<{ id: string; status: string }>();
    return c.json({ id: again?.id, status: again?.status ?? 'pending', duplicate: true });
  }
  if (isMessages && target.conversationId) {
    await captureEvidence(c.env, id, body.targetType, body.targetId, target.conversationId, profile.id);
  }
  return c.json({ id, status: 'pending', priority }, 201);
});

// ─────────────────────────── Blocks ───────────────────────────

export const blocks = new Hono<AppEnv>();
blocks.use('*', requireAuth, requireProfile);

// GET /v1/blocks — the account's blocked people (as the profile that was blocked).
blocks.get('/', async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare(`SELECT blocked_profile_id, created_at FROM blocks WHERE blocker_user_id = ? ORDER BY created_at DESC`)
    .bind(user.id).all<{ blocked_profile_id: string; created_at: number }>();
  const cards = await loadCards(c.env, rows.results.map((r) => r.blocked_profile_id));
  return c.json({ items: rows.results.map((r) => ({ profileId: r.blocked_profile_id, blockedAt: r.created_at,
                                                    profile: cards.get(r.blocked_profile_id) ?? null })) });
});

// POST /v1/blocks {profileId} — idempotent. Pending contact requests between the two are cancelled; chats stay.
blocks.post('/', async (c) => {
  const user = currentUser(c);
  const profile = actingProfile(c);
  await rateLimit(c, 'RL_WRITE', `block:${user.id}`);
  const { profileId } = z.object({ profileId: z.string().max(80) }).parse(await c.req.json());
  const target = await c.env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(profileId).first<{ owner_user_id: string }>();
  if (!target) fail(404, 'profile_not_found');
  if (target!.owner_user_id === user.id) fail(422, 'cannot_block_self');
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO blocks (blocker_user_id, blocked_user_id, blocker_profile_id, blocked_profile_id, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING`)
      .bind(user.id, target!.owner_user_id, profile.id, profileId, now()),
    c.env.DB.prepare(`UPDATE contact_requests SET status = 'cancelled', responded_at = ?3 WHERE status = 'pending'
        AND ((sender_profile_id IN (SELECT id FROM profiles WHERE owner_user_id = ?1) AND recipient_profile_id IN (SELECT id FROM profiles WHERE owner_user_id = ?2))
          OR (sender_profile_id IN (SELECT id FROM profiles WHERE owner_user_id = ?2) AND recipient_profile_id IN (SELECT id FROM profiles WHERE owner_user_id = ?1)))`)
      .bind(user.id, target!.owner_user_id, now()),
    // Their unread notifications to me go (nothing more arrives from them while blocked).
    c.env.DB.prepare(`DELETE FROM notifications WHERE read_at IS NULL AND recipient_profile_id IN (SELECT id FROM profiles WHERE owner_user_id = ?)
        AND actor_profile_id IN (SELECT id FROM profiles WHERE owner_user_id = ?)`).bind(user.id, target!.owner_user_id),
  ]);
  return c.json({ blocked: true, profileId });
});

// DELETE /v1/blocks/:profileId — unblock (the person, whichever of their profiles is named).
blocks.delete('/:profileId', async (c) => {
  const user = currentUser(c);
  const target = await c.env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(c.req.param('profileId')).first<{ owner_user_id: string }>();
  if (target) {
    await c.env.DB.prepare(`DELETE FROM blocks WHERE blocker_user_id = ? AND blocked_user_id = ?`).bind(user.id, target.owner_user_id).run();
  } else {
    await c.env.DB.prepare(`DELETE FROM blocks WHERE blocker_user_id = ? AND blocked_profile_id = ?`).bind(user.id, c.req.param('profileId')).run();
  }
  return c.json({ blocked: false, profileId: c.req.param('profileId') });
});

// ─────────────────────────── Feedback ───────────────────────────

export const feedback = new Hono<AppEnv>();
feedback.use('*', requireAuth);

const SCREENSHOT_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic' };

// POST /v1/feedback — multipart: category, message, appVersion, osVersion, platform, screenshot? (image ≤ MAX MB).
// Only what the user typed, the app and OS versions they can see on the form, and their account — nothing else.
feedback.post('/', async (c) => {
  const user = currentUser(c);
  await rateLimit(c, 'RL_WRITE', `feedback:${user.id}`);
  const today = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at > ?`)
    .bind(user.id, now() - 86_400_000).first<{ n: number }>();
  if ((today?.n ?? 0) >= 20) fail(429, 'rate_limited');
  const maxBytes = Number(c.env.MAX_FEEDBACK_ATTACHMENT_MB ?? 5) * 1024 * 1024;
  if (Number(c.req.header('Content-Length') ?? 0) > maxBytes + 64 * 1024) fail(413, 'file_too_large');
  const form = await c.req.formData().catch(() => fail(400, 'invalid_form'));
  const fields = z.object({
    category: z.enum(['suggestion', 'bug', 'general', 'other']),
    message: z.string().trim().min(1, 'message_required').max(4000),
    appVersion: z.string().trim().max(40).optional(),
    osVersion: z.string().trim().max(40).optional(),
    platform: z.enum(['ios', 'web']).optional(),
  }).parse({
    category: form.get('category'), message: form.get('message'),
    appVersion: form.get('appVersion') ?? undefined, osVersion: form.get('osVersion') ?? undefined, platform: form.get('platform') ?? undefined,
  });
  const id = newId('fbk');
  let key: string | null = null;
  let mime: string | null = null;
  let size: number | null = null;
  const file = form.get('screenshot');
  if (file instanceof File && file.size > 0) {
    mime = (file.type || '').toLowerCase();
    const ext = SCREENSHOT_TYPES[mime] ?? fail(415, 'invalid_mime_type');
    if (file.size > maxBytes) fail(413, 'file_too_large');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
    const ok = mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8
      : mime === 'image/png' ? ascii(1, 4) === 'PNG' : ascii(4, 8) === 'ftyp';
    if (!ok) fail(415, 'invalid_file');
    if (!c.env.MEDIA) fail(503, 'storage_unavailable');
    key = `fb/${id}.${ext}`;
    size = bytes.length;
    await c.env.MEDIA!.put(key, bytes, { httpMetadata: { contentType: mime } });
  }
  const profileId = c.req.header('X-Profile-Id');
  const ownProfile = profileId ? await c.env.DB.prepare(`SELECT id FROM profiles WHERE id = ? AND owner_user_id = ?`).bind(profileId, user.id)
    .first<{ id: string }>() : null;
  await c.env.DB.prepare(`INSERT INTO feedback (id, user_id, profile_id, category, message, attachment_key, attachment_mime, attachment_bytes,
      app_version, os_version, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.id, ownProfile?.id ?? null, fields.category, fields.message, key, key ? mime : null, size,
          fields.appVersion ?? null, fields.osVersion ?? null, fields.platform ?? null, now(), now()).run();
  return c.json({ id, status: 'open' }, 201);
});
