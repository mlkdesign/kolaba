#!/usr/bin/env node
// End-to-end API checks with independent demo accounts (scenarios B, C, D, E, F, G, H of WEB MVP 01).
//   API=https://kolaba-api.mlkdesignweb.workers.dev node tests/e2e.mjs      (default: http://127.0.0.1:8787)
// Uses seed/.demo-credentials.json. Cleans up what it creates where the API allows it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API ?? 'http://127.0.0.1:8787';
const ORIGIN = process.env.ORIGIN ?? 'https://mlkdesign.github.io';
const creds = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'seed', '.demo-credentials.json'), 'utf8'));
let passed = 0;
const failures = [];

async function call(session, method, path, body, profileId, extraHeaders = {}) {
  const headers = { Origin: ORIGIN, ...extraHeaders };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  if (profileId ?? session?.profileId) headers['X-Profile-Id'] = profileId ?? session.profileId;
  if (body !== undefined && !(body instanceof Uint8Array)) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers, text };
}

async function login(email) {
  const r = await call(null, 'POST', '/v1/auth/login', { email, password: creds[email].password });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${r.text}`);
  return { token: r.json.token, user: r.json.user, profiles: r.json.profiles, profileId: r.json.profiles[0].id };
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const expectError = (r, status, code) =>
  expect(r.status === status && r.json?.error?.code === code, `expected ${status} ${code}, got ${r.status} ${r.text.slice(0, 160)}`);

console.log(`API ${API}\n`);
const creator = await login('creator.pro@demo.kolaba.test');      // Sofiia Kovalenko (creator PRO)
const free = await login('creator.free@demo.kolaba.test');         // Marta Nowak (creator FREE)
const business = await login('business.pro@demo.kolaba.test');    // Lumière Skin Lab (business PRO)
const multi = await login('multi@demo.kolaba.test');               // creator + 2 businesses
const multiBusiness = multi.profiles.find((p) => p.type === 'business');

await test('health, CORS allowlist (no "*")', async () => {
  const r = await call(null, 'GET', '/v1/health');
  expect(r.json.status === 'ok', 'health not ok');
  expect(r.headers.get('access-control-allow-origin') === ORIGIN, `ACAO=${r.headers.get('access-control-allow-origin')}`);
  const evil = await call(null, 'GET', '/v1/health', undefined, undefined, { Origin: 'https://evil.example' });
  expect(!evil.headers.get('access-control-allow-origin'), 'foreign origin got CORS');
});

await test('G: exactly 40 demo creators and 40 businesses, ≤10 videos each, no duplicates', async () => {
  const all = [];
  for (const type of ['creator', 'business']) {
    let cursor = null;
    do {
      const r = await call(creator, 'GET', `/v1/profiles?type=${type}&limit=50${cursor ? `&cursor=${cursor}` : ''}`);
      all.push(...r.json.items);
      cursor = r.json.nextCursor;
    } while (cursor);
  }
  const demo = all.filter((p) => p.isDemo);
  expect(demo.filter((p) => p.type === 'creator').length === 40, `creators ${demo.filter((p) => p.type === 'creator').length}`);
  expect(demo.filter((p) => p.type === 'business').length === 40, `businesses ${demo.filter((p) => p.type === 'business').length}`);
  expect(new Set(demo.map((p) => p.id)).size === 80, 'duplicate profiles');
  const ratings = new Set(demo.map((p) => p.rating?.toFixed(2)));
  expect(ratings.size > 8, 'ratings not varied');
  const cities = new Set(demo.map((p) => p.city));
  expect(cities.size > 25, `only ${cities.size} cities`);
  for (const p of demo.filter((d) => d.type === 'creator')) {
    const m = await call(creator, 'GET', `/v1/profiles/${p.id}/media?purpose=portfolio&kind=video`);
    expect(m.json.items.length <= 10, `${p.displayName} has ${m.json.items.length} videos`);
  }
});

await test('G: 40 published demo jobs, each a different business', async () => {
  const items = [];
  let cursor = null;
  do {
    const r = await call(creator, 'GET', `/v1/jobs?tab=all&limit=30${cursor ? `&cursor=${cursor}` : ''}`);
    items.push(...r.json.items);
    cursor = r.json.nextCursor;
  } while (cursor);
  const demo = items.filter((j) => j.isDemo);
  expect(demo.length === 40, `demo jobs ${demo.length}`);
  expect(new Set(demo.map((j) => j.ownerProfileId)).size === 40, 'owners repeat');
  expect(new Set(demo.map((j) => j.title)).size === 40, 'titles repeat');
});

let jobId = null;
await test('B: business publishes a job, creator applies, business sees it, creator withdraws', async () => {
  const create = await call(business, 'POST', '/v1/jobs', { title: 'E2E test shoot', description: 'Created by the e2e test',
    compensationType: 'fixed', budgetMin: 100, currency: 'USD', isWorldwide: true, publish: true });
  expect(create.status === 201 && create.json.status === 'published', `create ${create.status} ${create.text}`);
  jobId = create.json.id;
  const found = await call(free, 'GET', `/v1/jobs?q=e2e%20test%20shoot`);
  expect(found.json.items.some((j) => j.id === jobId), 'creator cannot find the job');
  const applied = await call(free, 'POST', `/v1/jobs/${jobId}/apply`, { message: 'E2E application' });
  expect(applied.status === 201, `apply ${applied.status} ${applied.text}`);
  expectError(await call(free, 'POST', `/v1/jobs/${jobId}/apply`, { message: 'again' }), 409, 'already_applied');
  const list = await call(business, 'GET', `/v1/jobs/${jobId}/applications`);
  expect(list.json.items.some((a) => a.id === applied.json.id), 'business does not see the application');
  const notes = await call(business, 'GET', '/v1/notifications');
  expect(notes.json.items.some((n) => n.type === 'application_received' && n.payload.jobId === jobId), 'no application notification');
  const withdrawn = await call(free, 'POST', `/v1/jobs/applications/${applied.json.id}/withdraw`);
  expect(withdrawn.json.status === 'withdrawn', 'withdraw failed');
  const after = await call(business, 'GET', `/v1/jobs/${jobId}/applications`);
  expect(!after.json.items.some((a) => a.id === applied.json.id), 'withdrawn application still listed');
});

await test('H: creator cannot publish a job, business cannot apply, nobody acts as someone else\'s profile', async () => {
  expectError(await call(creator, 'POST', '/v1/jobs', { title: 'nope', publish: true }), 403, 'business_profile_required');
  expectError(await call(business, 'POST', `/v1/jobs/${jobId}/apply`, { message: 'nope' }), 403, 'creator_profile_required');
  expectError(await call(free, 'GET', '/v1/notifications', undefined, business.profileId), 403, 'not_profile_owner');
  expectError(await call(free, 'PATCH', `/v1/profiles/${business.profileId}`, { displayName: 'Hacked' }), 403, 'not_profile_owner');
  expectError(await call(free, 'POST', `/v1/jobs/${jobId}/close`), 403, 'business_profile_required');
  expectError(await call(multi, 'POST', `/v1/jobs/${jobId}/close`, undefined, multiBusiness.id), 404, 'job_not_found');
  expectError(await call(null, 'GET', '/v1/notifications'), 401, 'not_signed_in');
});

await test('H: FREE creator cannot attach media or create collections (server decides PRO)', async () => {
  const media = await call(free, 'GET', `/v1/profiles/${free.profileId}/media?purpose=portfolio`);
  const mediaId = media.json.items[0]?.id;
  expect(mediaId, 'free creator has no media in seed');
  expectError(await call(free, 'POST', `/v1/jobs/${jobId}/apply`, { message: 'with media', mediaIds: [mediaId] }), 403, 'pro_required');
  expectError(await call(free, 'POST', '/v1/media/collections', { title: 'Mine' }), 403, 'pro_required');
  expectError(await call(free, 'POST', `/v1/admin/profiles/${free.profileId}/pro`, { enabled: true }), 403, 'admin_required');
});

await test('C: contact request → notification → accept → both see it', async () => {
  const other = multiBusiness.id;
  const rel = await call(free, 'GET', `/v1/contacts/relation/${other}`);
  if (rel.json.relation === 'connected') await call(free, 'DELETE', `/v1/contacts/${other}`);
  const sent = await call(free, 'POST', '/v1/contacts/requests', { profileId: other });
  expect(['requested', 'connected'].includes(sent.json.relation), `request ${sent.text}`);
  const notes = await call(multi, 'GET', '/v1/notifications', undefined, other);
  expect(notes.json.items.some((n) => n.type === 'contact_request' && n.actor?.id === free.profileId), 'no contact_request notification');
  const requests = await call(multi, 'GET', '/v1/contacts?filter=requests', undefined, other);
  const req = requests.json.items.find((i) => i.profile.id === free.profileId);
  expect(req, 'request not in Requests');
  const accepted = await call(multi, 'POST', `/v1/contacts/requests/${req.requestId}/accept`, undefined, other);
  expect(accepted.json.status === 'accepted', 'accept failed');
  const mine = await call(free, 'GET', '/v1/contacts?filter=all');
  const theirs = await call(multi, 'GET', '/v1/contacts?filter=all', undefined, other);
  expect(mine.json.items.some((i) => i.profile.id === other) && theirs.json.items.some((i) => i.profile.id === free.profileId), 'not both');
  expectError(await call(free, 'POST', '/v1/contacts/requests', { profileId: free.profileId }), 422, 'self_contact');
  expectError(await call(multi, 'POST', '/v1/contacts/requests', { profileId: multi.profiles.find((p) => p.type === 'creator').id }, other), 422, 'same_account');
});

await test('D: two accounts exchange messages; history persists; outsider cannot read', async () => {
  const conv = await call(free, 'POST', '/v1/conversations', { profileId: multiBusiness.id });
  expect(conv.json.id, `conversation ${conv.text}`);
  const stamp = Date.now();
  await call(free, 'POST', `/v1/conversations/${conv.json.id}/messages`, { body: `Hello from e2e ${stamp}` });
  const list = await call(multi, 'GET', '/v1/conversations', undefined, multiBusiness.id);
  const row = list.json.items.find((c) => c.id === conv.json.id);
  expect(row && row.unreadCount >= 1, 'recipient has no unread');
  const history = await call(multi, 'GET', `/v1/conversations/${conv.json.id}/messages`, undefined, multiBusiness.id);
  expect(history.json.items.some((m) => m.body === `Hello from e2e ${stamp}`), 'message missing');
  await call(multi, 'POST', `/v1/conversations/${conv.json.id}/messages`, { body: `Reply ${stamp}` }, multiBusiness.id);
  await call(multi, 'POST', `/v1/conversations/${conv.json.id}/read`, undefined, multiBusiness.id);
  const after = await call(multi, 'GET', '/v1/conversations', undefined, multiBusiness.id);
  expect(after.json.items.find((c) => c.id === conv.json.id).unreadCount === 0, 'unread not cleared');
  const mine = await call(free, 'GET', `/v1/conversations/${conv.json.id}/messages`);
  expect(mine.json.items[0].body === `Reply ${stamp}`, 'reply missing');
  expectError(await call(creator, 'GET', `/v1/conversations/${conv.json.id}/messages`), 404, 'conversation_not_found');
  expectError(await call(creator, 'POST', `/v1/conversations/${conv.json.id}/messages`, { body: 'intrude' }), 404, 'conversation_not_found');
  const search = await call(free, 'GET', `/v1/search?q=${stamp}&scope=messages`);
  expect(search.json.messages.length >= 1, 'message search');
  const foreign = await call(creator, 'GET', `/v1/search?q=${stamp}&scope=messages`);
  expect(foreign.json.messages.length === 0, 'search leaked a private message');
});

await test('H: no review without a confirmed contact, no self review, one per account', async () => {
  expectError(await call(free, 'POST', '/v1/reviews', { recipientProfileId: free.profileId, quality: 5, speed: 5, contact: 5, comment: 'me' }), 403, 'self_review');
  let stranger = null;
  for (const p of (await call(free, 'GET', '/v1/profiles?type=business&limit=50')).json.items) {
    if ((await call(free, 'GET', `/v1/contacts/relation/${p.id}`)).json.relation === 'none') { stranger = p; break; }
  }
  expect(stranger, 'no non-contact business found');
  expectError(await call(free, 'POST', '/v1/reviews', { recipientProfileId: stranger.id, quality: 5, speed: 5, contact: 5, comment: 'x' }), 403, 'not_contact');
  const rr = await call(free, 'POST', '/v1/reviews/requests', { contactProfileId: multiBusiness.id });
  const again = await call(free, 'POST', '/v1/reviews/requests', { contactProfileId: multiBusiness.id });
  expect(rr.json.state === 'requested' || rr.json.error?.code === 'already_reviewed', `request ${rr.text}`);
  if (rr.json.state) expect(again.json.created === false && again.json.id === rr.json.id, 'duplicate review request');
  const first = await call(multi, 'POST', '/v1/reviews', { recipientProfileId: free.profileId, quality: 5, speed: 4, contact: 5, comment: 'E2E review' }, multiBusiness.id);
  expect(first.status === 201 || first.json?.error?.code === 'already_reviewed', `review ${first.text}`);
  expectError(await call(multi, 'POST', '/v1/reviews', { recipientProfileId: free.profileId, quality: 1, speed: 1, contact: 1, comment: 'again' }, multiBusiness.id), 409, 'already_reviewed');
});

await test('F: Reels — 10+ videos with cursor pagination, like persists, author opens', async () => {
  const first = await call(creator, 'GET', '/v1/reels?limit=8');
  const second = await call(creator, 'GET', `/v1/reels?limit=8&cursor=${first.json.nextCursor}`);
  const items = [...first.json.items, ...second.json.items];
  expect(items.length >= 10 && new Set(items.map((i) => i.id)).size === items.length, 'not 10 unique videos');
  const target = items.find((i) => !i.isLiked) ?? items[0];
  const liked = await call(creator, 'PUT', `/v1/media/${target.id}/like`);
  expect(liked.json.liked, 'like failed');
  const again = await call(creator, 'GET', '/v1/reels?limit=8');
  const refetched = [...again.json.items, ...(await call(creator, 'GET', `/v1/reels?limit=8&cursor=${again.json.nextCursor}`)).json.items];
  expect(refetched.find((i) => i.id === target.id)?.isLiked, 'like not persisted');
  await call(creator, 'DELETE', `/v1/media/${target.id}/like`);
  const author = await call(creator, 'GET', `/v1/profiles/${target.author.id}`);
  expect(author.json.displayName === target.author.displayName, 'author profile');
  const head = await fetch(target.url, { headers: { Range: 'bytes=0-1' } });
  expect([200, 206].includes(head.status), `video url ${head.status}`);
});

await test('E: uploads need R2 — honest 503 until it is enabled, or a full upload/delete cycle', async () => {
  const health = (await call(null, 'GET', '/v1/health')).json;
  const req = await call(creator, 'POST', '/v1/media/uploads', { purpose: 'portfolio', kind: 'photo', mime: 'image/jpeg', bytes: 1000 });
  if (!health.storage) return expectError(req, 503, 'storage_unavailable');
  expect(req.status === 201, `upload request ${req.text}`);
  const jpeg = new Uint8Array(1000); jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
  const put = await call(creator, 'PUT', `/v1/media/uploads/${req.json.mediaId}`, jpeg, undefined, { 'Content-Type': 'image/jpeg' });
  expect(put.status === 200, `put ${put.status} ${put.text}`);
  const seen = await call(free, 'GET', `/v1/profiles/${creator.profileId}/media?purpose=portfolio&kind=photo`);
  expect(seen.json.items.some((m) => m.id === req.json.mediaId), 'other user cannot see the photo');
  expectError(await call(free, 'DELETE', `/v1/media/${req.json.mediaId}`), 404, 'media_not_found');
  const bad = await call(creator, 'POST', '/v1/media/uploads', { purpose: 'portfolio', kind: 'photo', mime: 'application/x-msdownload', bytes: 10 });
  expectError(bad, 415, 'invalid_mime_type');
  expectError(await call(creator, 'POST', '/v1/media/uploads', { purpose: 'portfolio', kind: 'video', mime: 'video/mp4', bytes: 900 * 1024 * 1024 }), 413, 'file_too_large');
  await call(creator, 'DELETE', `/v1/media/${req.json.mediaId}`);
  const gone = await call(free, 'GET', `/v1/profiles/${creator.profileId}/media?purpose=portfolio&kind=photo`);
  expect(!gone.json.items.some((m) => m.id === req.json.mediaId), 'deleted photo still visible');
});

await test('I: follow / unfollow → notification, counts; Reels grouped by creator; catalog has bios', async () => {
  const target = business.profileId;
  await call(creator, 'DELETE', `/v1/profiles/${target}/follow`);
  const before = (await call(free, 'GET', `/v1/profiles/${target}`)).json.counts.followers;
  const put = await call(creator, 'PUT', `/v1/profiles/${target}/follow`);
  expect(put.status === 200 && put.json.following === true, `follow ${put.text}`);
  expect((await call(creator, 'GET', `/v1/profiles/${target}/follow`)).json.following === true, 'follow not stored');
  const after = (await call(free, 'GET', `/v1/profiles/${target}`)).json.counts.followers;
  expect(after === before + 1, `followers ${before} → ${after}`);
  const notes = (await call(business, 'GET', '/v1/notifications?limit=20')).json.items;
  expect(notes.some((n) => n.type === 'followed' && n.actor?.id === creator.profileId), 'no followed notification');
  expectError(await call(creator, 'PUT', `/v1/profiles/${creator.profileId}/follow`), 422, 'same_account');
  await call(creator, 'DELETE', `/v1/profiles/${target}/follow`);
  expect((await call(creator, 'GET', `/v1/profiles/${target}/follow`)).json.following === false, 'unfollow failed');
  const reels = await call(creator, 'GET', '/v1/reels/creators?limit=4');
  expect(reels.status === 200 && reels.json.items.length > 0, `reels/creators ${reels.text}`);
  const first = reels.json.items[0];
  expect(first.author && Array.isArray(first.videos) && first.videos.length >= 1 && first.videos.length <= 10, 'creator page shape');
  expect(first.videos.every((v) => v.kind === 'video' && v.ownerProfileId === first.author.id), 'videos of another author');
  if (reels.json.nextCursor) {
    const next = await call(creator, 'GET', `/v1/reels/creators?limit=4&cursor=${reels.json.nextCursor}`);
    expect(!next.json.items.some((x) => reels.json.items.some((y) => y.author.id === x.author.id)), 'cursor repeats a creator');
  }
  const catalog = await call(free, 'GET', '/v1/profiles?type=creator&limit=5');
  expect(catalog.json.items.every((c) => typeof c.bio === 'string'), 'catalog without bio');
});

await test('J: A edits the profile; A asks contact B for a review; B gets it and publishes (or already has)', async () => {
  const own = (await call(creator, 'GET', `/v1/profiles/${creator.profileId}`)).json;
  const edited = `${own.bio} · e2e`;
  expect((await call(creator, 'PATCH', `/v1/profiles/${creator.profileId}`, { bio: edited })).status === 200, 'patch failed');
  expect((await call(free, 'GET', `/v1/profiles/${creator.profileId}`)).json.bio === edited, 'edit not visible to others');
  await call(creator, 'PATCH', `/v1/profiles/${creator.profileId}`, { bio: own.bio });
  // B = the business, a confirmed contact after scenario C.
  const sheet = (await call(creator, 'GET', '/v1/reviews/requests/sheet')).json.items;
  const row = sheet.find((i) => i.profile.id === business.profileId);
  expect(row, 'business is not in the review sheet (contact missing)');
  if (row.state === 'available') {
    const r = await call(creator, 'POST', '/v1/reviews/requests', { contactProfileId: business.profileId });
    expect(r.status < 300, `request ${r.text}`);
    const notes = (await call(business, 'GET', '/v1/notifications?limit=30')).json.items;
    expect(notes.some((n) => n.type === 'review_request' && n.actor?.id === creator.profileId), 'no review_request notification');
    const pub = await call(business, 'POST', '/v1/reviews', { recipientProfileId: creator.profileId, quality: 5, speed: 5, contact: 4, comment: 'E2E: smooth collaboration, on time.' });
    expect(pub.status < 300 || pub.json?.error?.code === 'already_reviewed', `publish ${pub.text}`);
  }
  const list = (await call(free, 'GET', `/v1/reviews?profileId=${creator.profileId}`)).json;
  expect(list.items.some((x) => x.author?.id === business.profileId) || row.state !== 'available', 'published review not listed');
});

await test('cleanup: the e2e job is deleted', async () => {
  if (jobId) expect((await call(business, 'DELETE', `/v1/jobs/${jobId}`)).json.status === 'deleted', 'delete failed');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
