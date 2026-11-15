// Notifications (profile / account scope, de-duplication, isolation) — local checks only.
//   cd api && npx wrangler d1 migrations apply kolaba-db --local --env local
//   npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX:
//   node tests/notifications-local.mjs "$PWD"      (local D1 only — never against production)
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API_DIR = process.argv[2];
const API = 'http://127.0.0.1:8799';
const ORIGIN = 'http://localhost:5173';
const ADMIN_ORIGIN = 'http://localhost:5174';
const creds = JSON.parse(readFileSync(`${API_DIR}/seed/.demo-credentials.json`, 'utf8'));
const sha = (t) => createHash('sha256').update(t).digest('hex');
let passed = 0; const failures = [];
const sql = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'kolaba-db', '--local', '--env', 'local', '--json', '--command', q],
  { cwd: API_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;
async function call(s, method, path, body, extra = {}) {
  const headers = { Origin: extra.origin ?? ORIGIN };
  if (s?.token) headers.Authorization = `Bearer ${s.token}`;
  const profile = extra.profileId ?? s?.profileId;
  if (profile) headers['X-Profile-Id'] = profile;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`); };
const ok = (v, m) => { if (!v) throw new Error(m); };

const demo = Object.keys(creds)[1];
const [src] = sql(`SELECT password_hash, password_salt, password_scheme FROM users WHERE email = '${demo}'`);
async function account(tag) {
  const uid = `usr_ntf_${tag}_${Date.now()}`; const email = `ntf.${tag}.${Date.now()}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${Date.now()}, 'owner', 0, ${Date.now()}, ${Date.now()})`);
  const s = { uid, email, token: (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token };
  return s;
}
async function profile(s, type, name) {
  const r = await call(s, 'POST', '/v1/profiles', { type, displayName: name }, { profileId: '' });
  eq(r.status, 201, r.text);
  return r.json.id;
}
const feed = async (s, profileId, filter) =>
  (await call(s, 'GET', `/v1/notifications${filter ? `?filter=${filter}` : ''}`, undefined, { profileId })).json;

// Account A: one creator. Account B: a creator and TWO businesses.
const A = await account('a');
const aCreator = await profile(A, 'creator', 'Emma Tester');
const B = await account('b');
const bCreator = await profile(B, 'creator', 'Lisa Milka');
const bBiz1 = await profile(B, 'business', 'AMARA Beauty');
const bBiz2 = await profile(B, 'business', 'Second Biz');

let job;
console.log('Jobs & Apply');
await test('1–2: an Apply reaches only the business that published the job', async () => {
  const j = await call(B, 'POST', '/v1/jobs', { title: 'UGC for AMARA', description: 'x', publish: true }, { profileId: bBiz1 });
  eq(j.status, 201, j.text); job = j.json.id;
  const r = await call(A, 'POST', `/v1/jobs/${job}/apply`, { message: 'Hi!' }, { profileId: aCreator });
  eq(r.status, 201, r.text);
  const biz1 = await feed(B, bBiz1);
  ok(biz1.items.some((n) => n.type === 'application_received' && n.targetId === job), 'biz1 has the apply');
  eq((await feed(B, bBiz2)).items.some((n) => n.type === 'application_received'), false, 'biz2 must not see it');
  eq((await feed(B, bCreator)).items.some((n) => n.type === 'application_received'), false, 'creator must not see it');
});

await test('saved job closed → the saver hears it once, no row for others', async () => {
  eq((await call(A, 'PUT', `/v1/jobs/${job}/save`, undefined, { profileId: aCreator })).status, 200, 'save');
  eq((await call(B, 'POST', `/v1/jobs/${job}/close`, undefined, { profileId: bBiz1 })).status, 200, 'close');
  const rows = (await feed(A, aCreator)).items.filter((n) => n.type === 'saved_job_closed');
  eq(rows.length, 1, 'one closed notice');
});

console.log('Contacts');
let requestId;
await test('3: a contact request reaches that profile only', async () => {
  const r = await call(A, 'POST', '/v1/contacts/requests', { profileId: bCreator }, { profileId: aCreator });
  eq(r.status, 201, r.text); requestId = r.json.requestId;
  const row = (await feed(B, bCreator)).items.find((n) => n.type === 'contact_request');
  ok(row, 'creator has the request'); eq(row.requestStatus, 'pending', 'pending');
  eq((await feed(B, bBiz1)).items.some((n) => n.type === 'contact_request'), false, 'business must not see it');
});
await test('4 + 13: accepted → the sender hears it once, the row no longer offers Accept', async () => {
  eq((await call(B, 'POST', `/v1/contacts/requests/${requestId}/accept`, undefined, { profileId: bCreator })).status, 200, 'accept');
  eq((await call(B, 'POST', `/v1/contacts/requests/${requestId}/accept`, undefined, { profileId: bCreator })).status, 200, 'repeat');
  eq((await feed(A, aCreator)).items.filter((n) => n.type === 'contact_accepted').length, 1, 'one accepted notice');
  eq((await feed(B, bCreator)).items.find((n) => n.type === 'contact_request').requestStatus, 'accepted', 'no Accept any more');
});
await test('5: removing a contact makes no notification', async () => {
  const before = (await feed(A, aCreator)).items.length;
  await call(B, 'DELETE', `/v1/contacts/${aCreator}`, undefined, { profileId: bCreator });
  eq((await feed(A, aCreator)).items.length, before, 'nothing new');
});

console.log('Reviews');
await test('6–7: review request and published review go to their profiles', async () => {
  await call(A, 'POST', '/v1/contacts/requests', { profileId: bBiz1 }, { profileId: aCreator });
  const req = (await feed(B, bBiz1)).items.find((n) => n.type === 'contact_request');
  await call(B, 'POST', `/v1/contacts/requests/${req.payload.requestId}/accept`, undefined, { profileId: bBiz1 });
  const rr = await call(B, 'POST', '/v1/reviews/requests', { contactProfileId: aCreator }, { profileId: bBiz1 });
  eq(rr.status, 201, rr.text);
  ok((await feed(A, aCreator)).items.some((n) => n.type === 'review_request'), 'request at the creator');
  const rv = await call(A, 'POST', '/v1/reviews', { recipientProfileId: bBiz1, quality: 5, speed: 5, contact: 5, comment: 'Great to work with.' },
                        { profileId: aCreator });
  eq(rv.status, 201, rv.text);
  ok((await feed(B, bBiz1)).items.some((n) => n.type === 'new_review'), 'review at AMARA');
  eq((await feed(B, bCreator)).items.some((n) => n.type === 'new_review'), false, 'not at the creator');
});

console.log('Messages');
await test('8: a message is never a notification', async () => {
  const conv = (await call(A, 'POST', '/v1/conversations', { profileId: bCreator }, { profileId: aCreator })).json.id;
  const m = await call(A, 'POST', `/v1/conversations/${conv}/messages`, { body: 'hello', clientId: 'client-ntf-0001' }, { profileId: aCreator });
  ok(m.status === 201 || m.status === 200, m.text);
  const [n] = sql(`SELECT COUNT(*) AS n FROM notifications WHERE type = 'new_message' AND recipient_user_id = '${B.uid}'`);
  eq(n.n, 0, 'no message rows');
});

console.log('Account scope');
const adminToken = randomUUID() + randomUUID();
// The local allow-listed administrator (the same row tests/feature115-local.mjs uses).
const [adm] = sql(`SELECT id FROM admins ORDER BY created_at LIMIT 1`);
sql(`INSERT INTO admin_sessions (id, admin_id, created_at, expires_at, last_seen_at) VALUES ('${sha(adminToken)}', '${adm.id}', ${Date.now()}, ${Date.now() + 3600000}, ${Date.now()})`);
const ADM = { token: adminToken };
const key = randomUUID();
await test('10: an account notice shows on every profile, stored once; repeated submit makes no duplicate', async () => {
  const body = { scope: 'account', userId: B.uid, title: 'Security', message: 'Please review your account.', requestKey: key };
  eq((await call(ADM, 'POST', '/v1/admin/notifications', body, { origin: ADMIN_ORIGIN })).status, 200, 'send');
  eq((await call(ADM, 'POST', '/v1/admin/notifications', body, { origin: ADMIN_ORIGIN })).status, 200, 'resend');
  for (const p of [bCreator, bBiz1, bBiz2]) ok((await feed(B, p)).items.some((n) => n.type === 'account_message'), `visible on ${p}`);
  const [n] = sql(`SELECT COUNT(*) AS n FROM notifications WHERE type = 'account_message' AND recipient_user_id = '${B.uid}'`);
  eq(n.n, 1, 'one stored row');
  eq((await feed(A, aCreator)).items.some((n) => n.type === 'account_message'), false, 'not another account');
  const [log] = sql(`SELECT COUNT(*) AS n FROM admin_logs WHERE action = 'notification.send' AND entity_id = '${B.uid}'`);
  ok(log.n >= 1, 'audited');
});
await test('admin profile notice reaches only that profile', async () => {
  const r = await call(ADM, 'POST', '/v1/admin/notifications', { scope: 'profile', profileId: bBiz2, title: 'Hi', message: 'For Biz 2.',
                                                                 requestKey: randomUUID() }, { origin: ADMIN_ORIGIN });
  eq(r.status, 200, r.text);
  ok((await feed(B, bBiz2)).items.some((n) => n.type === 'profile_message'), 'biz2 has it');
  eq((await feed(B, bBiz1)).items.some((n) => n.type === 'profile_message'), false, 'biz1 does not');
});

console.log('Unread and read');
await test('Unread filter, unread-by-profile and mark all as read stay per profile', async () => {
  const unread = await feed(B, bBiz1, 'unread');
  ok(unread.items.length > 0 && unread.items.every((n) => n.readAt == null), 'only unread rows');
  const by = (await call(B, 'GET', '/v1/notifications/unread-by-profile', undefined, { profileId: bCreator })).json.items;
  ok(by.some((x) => x.profileId === bBiz1 && x.unread > 0), 'biz1 counted for the switcher');
  eq((await call(B, 'POST', '/v1/notifications/read-all', {}, { profileId: bBiz1 })).status, 200, 'read all');
  eq((await feed(B, bBiz1)).unreadCount, 0, 'biz1 read');
  const [left] = sql(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_profile_id = '${bBiz2}' AND read_at IS NULL`);
  ok(left.n > 0, 'biz2 rows untouched by biz1 read-all');
});
await test('a profile cannot read another profile’s rows by id', async () => {
  const [row] = sql(`SELECT id FROM notifications WHERE recipient_profile_id = '${bBiz2}' AND read_at IS NULL LIMIT 1`);
  await call(A, 'POST', '/v1/notifications/read', { ids: [row.id] }, { profileId: aCreator });
  const [after] = sql(`SELECT read_at FROM notifications WHERE id = '${row.id}'`);
  eq(after.read_at, null, 'still unread');
  const del = await call(A, 'DELETE', `/v1/notifications/${row.id}`, undefined, { profileId: aCreator });
  eq(del.status, 404, 'cannot delete');
});
await test('X-Profile-Id of another account is refused', async () => {
  const r = await call(A, 'GET', '/v1/notifications', undefined, { profileId: bBiz1 });
  ok(r.status === 403 || r.status === 404, `status ${r.status}`);
});

console.log('FIX 125 preferences');
await test('preferences: defaults on, saved per profile, the other profile untouched', async () => {
  const d = (await call(B, 'GET', '/v1/notifications/preferences', undefined, { profileId: bBiz1 })).json;
  ok(d.pushEnabled && d.jobsEnabled && d.contactsEnabled && d.activityEnabled && d.messagesEnabled, 'defaults on');
  const body = { pushEnabled: true, jobsEnabled: false, contactsEnabled: true, activityEnabled: false, messagesEnabled: true };
  const r = await call(B, 'PUT', '/v1/notifications/preferences', body, { profileId: bBiz1 });
  eq(r.status, 200, r.text); eq(r.json.jobsEnabled, false, 'saved'); ok(r.json.updatedAt, 'updatedAt');
  const again = (await call(B, 'GET', '/v1/notifications/preferences', undefined, { profileId: bBiz1 })).json;
  eq(again.activityEnabled, false, 'kept');
  const other = (await call(B, 'GET', '/v1/notifications/preferences', undefined, { profileId: bCreator })).json;
  eq(other.jobsEnabled, true, 'the creator keeps its own');
  const bad = await call(B, 'PUT', '/v1/notifications/preferences', { pushEnabled: true }, { profileId: bBiz1 });
  ok(bad.status >= 400, 'incomplete body refused');
});
await test('switches change pushes only: the feed still gets the event', async () => {
  await call(B, 'PUT', '/v1/notifications/preferences', { pushEnabled: false, jobsEnabled: false, contactsEnabled: false,
                                                          activityEnabled: false, messagesEnabled: false }, { profileId: bCreator });
  const before = (await feed(B, bCreator)).items.length;
  const r = await call(A, 'POST', '/v1/contacts/requests', { profileId: bCreator }, { profileId: aCreator });
  ok(r.status < 300, r.text);
  ok((await feed(B, bCreator)).items.length > before, 'the request is in the feed');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
