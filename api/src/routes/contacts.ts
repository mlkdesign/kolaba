// Contacts: request → accept / decline; cancel; remove. Between profiles of different accounts only.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { loadCards, notify } from '../lib/cards';
import { clampLimit, fail, newId, now, pairKey } from '../lib/util';

const contacts = new Hono<AppEnv>();
contacts.use('*', requireAuth, requireProfile);

/** none / requested / incoming / connected / unavailable — the card's button. */
export async function relation(env: Env, me: string, myOwner: string, other: string) {
  if (me === other) return { relation: 'unavailable' as const, requestId: null };
  const owner = await env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(other).first<{ owner_user_id: string }>();
  if (!owner || owner.owner_user_id === myOwner) return { relation: 'unavailable' as const, requestId: null };
  const row = await env.DB.prepare(`SELECT id, status, sender_profile_id FROM contact_requests
      WHERE pair_key = ? AND status IN ('pending', 'accepted')`).bind(pairKey(me, other))
    .first<{ id: string; status: string; sender_profile_id: string }>();
  if (!row) return { relation: 'none' as const, requestId: null };
  if (row.status === 'accepted') return { relation: 'connected' as const, requestId: row.id };
  return { relation: row.sender_profile_id === me ? 'requested' as const : 'incoming' as const, requestId: row.id };
}

// GET /v1/contacts?filter=all|requests|sent&q=
contacts.get('/', async (c) => {
  const profile = actingProfile(c);
  const filter = c.req.query('filter') ?? 'all';
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const limit = clampLimit(c.req.query('limit'), 100, 200);
  const condition = filter === 'requests' ? `cr.status = 'pending' AND cr.recipient_profile_id = ?1`
    : filter === 'sent' ? `cr.status = 'pending' AND cr.sender_profile_id = ?1`
    : `cr.status = 'accepted' AND (cr.sender_profile_id = ?1 OR cr.recipient_profile_id = ?1)`;
  const rows = await c.env.DB.prepare(`SELECT cr.id, cr.status, COALESCE(cr.responded_at, cr.created_at) AS since,
      CASE WHEN cr.sender_profile_id = ?1 THEN cr.recipient_profile_id ELSE cr.sender_profile_id END AS other_id
      FROM contact_requests cr WHERE ${condition} ORDER BY since DESC LIMIT ?2`).bind(profile.id, limit)
    .all<{ id: string; status: string; since: number; other_id: string }>();
  const cards = await loadCards(c.env, rows.results.map((r) => r.other_id));
  let items = rows.results.map((r) => ({ requestId: r.id, status: r.status, since: r.since, profile: cards.get(r.other_id) ?? null }))
    .filter((i) => i.profile);
  if (q) items = items.filter((i) => `${i.profile!.displayName} ${i.profile!.username} ${i.profile!.location ?? ''}`.toLowerCase().includes(q));
  const counts = await c.env.DB.prepare(`SELECT
      SUM(status = 'accepted' AND (sender_profile_id = ?1 OR recipient_profile_id = ?1)) AS all_count,
      SUM(status = 'pending' AND recipient_profile_id = ?1) AS requests,
      SUM(status = 'pending' AND sender_profile_id = ?1) AS sent
      FROM contact_requests WHERE sender_profile_id = ?1 OR recipient_profile_id = ?1`).bind(profile.id)
    .first<{ all_count: number; requests: number; sent: number }>();
  return c.json({ items, counts: { all: counts?.all_count ?? 0, requests: counts?.requests ?? 0, sent: counts?.sent ?? 0 } });
});

contacts.get('/relation/:profileId', async (c) => {
  const profile = actingProfile(c);
  return c.json(await relation(c.env, profile.id, profile.ownerUserId, c.req.param('profileId')));
});

// POST /v1/contacts/requests {profileId} — their pending request is accepted instead of a duplicate.
contacts.post('/requests', async (c) => {
  const profile = actingProfile(c);
  await rateLimit(c, 'RL_WRITE', `contact:${profile.ownerUserId}`);
  const { profileId } = z.object({ profileId: z.string() }).parse(await c.req.json());
  if (profileId === profile.id) fail(422, 'self_contact');
  const target = await c.env.DB.prepare(`SELECT owner_user_id, status FROM profiles WHERE id = ?`).bind(profileId)
    .first<{ owner_user_id: string; status: string }>();
  if (!target || target.status !== 'active') fail(404, 'profile_not_found');
  if (target!.owner_user_id === profile.ownerUserId) fail(422, 'same_account');
  const current = await relation(c.env, profile.id, profile.ownerUserId, profileId);
  if (current.relation === 'incoming') {
    await c.env.DB.prepare(`UPDATE contact_requests SET status = 'accepted', responded_at = ? WHERE id = ?`).bind(now(), current.requestId).run();
    await notify(c.env, profileId, 'contact_accepted', profile.id, { requestId: current.requestId });
    return c.json({ relation: 'connected', requestId: current.requestId });
  }
  if (current.relation !== 'none') return c.json(current);
  const id = newId('crq');
  try {
    await c.env.DB.prepare(`INSERT INTO contact_requests (id, sender_profile_id, recipient_profile_id, pair_key, created_at)
                            VALUES (?, ?, ?, ?, ?)`).bind(id, profile.id, profileId, pairKey(profile.id, profileId), now()).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) return c.json(await relation(c.env, profile.id, profile.ownerUserId, profileId));
    throw error;
  }
  await notify(c.env, profileId, 'contact_request', profile.id, { requestId: id });
  return c.json({ relation: 'requested', requestId: id }, 201);
});

// POST /v1/contacts/requests/:id/accept|decline (recipient) | cancel (sender)
contacts.post('/requests/:id/:action{accept|decline|cancel}', async (c) => {
  const profile = actingProfile(c);
  const action = c.req.param('action');
  const row = await c.env.DB.prepare(`SELECT * FROM contact_requests WHERE id = ? AND status = 'pending'`).bind(c.req.param('id'))
    .first<{ id: string; sender_profile_id: string; recipient_profile_id: string }>();
  const allowed = row && (action === 'cancel' ? row.sender_profile_id === profile.id : row.recipient_profile_id === profile.id);
  if (!allowed) fail(404, 'request_not_found');
  const status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled';
  await c.env.DB.prepare(`UPDATE contact_requests SET status = ?, responded_at = ? WHERE id = ?`).bind(status, now(), row!.id).run();
  if (status === 'accepted') await notify(c.env, row!.sender_profile_id, 'contact_accepted', profile.id, { requestId: row!.id });
  return c.json({ status });
});

// DELETE /v1/contacts/:profileId — gone for both (chats and reviews stay).
contacts.delete('/:profileId', async (c) => {
  const profile = actingProfile(c);
  const res = await c.env.DB.prepare(`UPDATE contact_requests SET status = 'removed', responded_at = ? WHERE pair_key = ? AND status = 'accepted'`)
    .bind(now(), pairKey(profile.id, c.req.param('profileId'))).run();
  if (!res.meta.changes) fail(404, 'not_contact');
  await c.env.DB.prepare(`UPDATE review_requests SET status = 'cancelled' WHERE status = 'pending'
      AND ((requester_profile_id = ?1 AND contact_profile_id = ?2) OR (requester_profile_id = ?2 AND contact_profile_id = ?1))`)
    .bind(profile.id, c.req.param('profileId')).run();
  return c.json({ status: 'removed' });
});

export default contacts;
