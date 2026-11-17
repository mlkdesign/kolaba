// FEATURE 129 local API checks — rolling 30-day job posts, idempotent publication, Apply video choice, text limits.
//   cd api && npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX: --var MONETIZATION_ENABLED:true
//   node tests/feature129-local.mjs "$PWD"      (local D1 only — never against production)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API_DIR = process.argv[2];
const API = 'http://127.0.0.1:8799';
const ORIGIN = 'http://localhost:5173';
const creds = JSON.parse(readFileSync(`${API_DIR}/seed/.demo-credentials.json`, 'utf8'));
let passed = 0; const failures = [];
const sql = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'kolaba-db', '--local', '--env', 'local', '--json', '--command', q],
  { cwd: API_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;

async function call(s, method, path, body) {
  const headers = { Origin: ORIGIN };
  if (s?.token) headers.Authorization = `Bearer ${s.token}`;
  if (s?.profileId) headers['X-Profile-Id'] = s.profileId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const send = () => fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  // A kept-alive socket can be closed by the dev server during the slow D1 calls in between: one fresh try.
  const res = await send().catch(() => send());
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const demo = Object.keys(creds)[1];
const [src] = sql(`SELECT password_hash, password_salt, password_scheme FROM users WHERE email = '${demo}'`);
const stamp = Date.now();
async function person(tag, type) {
  const uid = `usr_f129_${tag}_${stamp}`; const email = `f129.${tag}.${stamp}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const token = (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token;
  const profile = (await call({ token }, 'POST', '/v1/profiles', { type, displayName: `${type} ${tag}` })).json.id;
  return { token, profileId: profile };
}
/** A portfolio video of `owner`, `ageMinutes` old. */
function video(owner, n, ageMinutes, extra = {}) {
  const id = `med_f129_${owner.profileId}_${n}`;
  const f = { status: 'ready', is_public: 1, review_status: 'approved', purpose: 'portfolio', ...extra };
  sql(`INSERT INTO media (id, owner_profile_id, kind, purpose, provider, url, status, is_public, review_status, duration, created_at)
       VALUES ('${id}', '${owner.profileId}', 'video', '${f.purpose}', 'external', 'https://example.com/${id}.mp4', '${f.status}', ${f.is_public},
               '${f.review_status}', 12, ${stamp - ageMinutes * 60_000})`);
  return id;
}



const DAY = 86_400_000;
const business = await person('biz', 'business');
const pro = await person('pro', 'creator');
const free = await person('free', 'creator');
sql(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at) VALUES ('sub_f129_pro_${stamp}', '${pro.profileId}', 'creator_pro', 'active', 'test', ${stamp})`);
const [bizUser] = sql(`SELECT owner_user_id AS u FROM profiles WHERE id = '${business.profileId}'`);
const jobBody = (extra = {}) => ({ title: 'UGC for a villa', description: 'Sunny shoot', publish: true, ...extra });
const usage = async () => (await call(business, 'GET', '/v1/me/entitlements')).json.features.job_posts;

console.log('Create Job — rolling 30 days');
let firstJob;
await test('Free: 2 publications, then refused with FEATURE_LIMIT_REACHED', async () => {
  firstJob = (await call(business, 'POST', '/v1/jobs', jobBody())).json.id;
  eq((await call(business, 'POST', '/v1/jobs', jobBody())).status, 201, 'second');
  const third = await call(business, 'POST', '/v1/jobs', jobBody());
  eq(third.json?.error?.code, 'FEATURE_LIMIT_REACHED', third.text);
  const u = await usage(); eq([u.used, u.limit, u.allowed, u.period], [2, 2, false, 'rolling_30_days'], 'usage');
});
await test('a slot comes back 30 days after its publication (not at the month\'s turn)', async () => {
  sql(`UPDATE usage_events SET created_at = ${Date.now() - 31 * DAY} WHERE subject_id = '${firstJob}'`);
  const u = await usage(); eq([u.used, u.allowed], [1, true], 'one back');
  eq((await call(business, 'POST', '/v1/jobs', jobBody())).status, 201, 'published again');
});
await test('the next free slot is the oldest counted publication + 30 days', async () => {
  const u = await usage();
  const [oldest] = sql(`SELECT MIN(created_at) AS t FROM usage_events WHERE user_id = '${bizUser.u}' AND created_at > ${Date.now() - 30 * DAY}`);
  eq(u.resetsAt, oldest.t + 30 * DAY, 'resetsAt');
});
await test('deleting a job never gives its slot back', async () => {
  const jobs = (await call(business, 'GET', '/v1/jobs?tab=mine')).json.items;
  await call(business, 'DELETE', `/v1/jobs/${jobs[0].id}`);
  eq((await usage()).used, 2, 'still 2');
});
await test('the same Idempotency-Key twice: one job, one slot', async () => {
  sql(`DELETE FROM usage_events WHERE user_id = '${bizUser.u}'`);
  const send = () => fetch('http://127.0.0.1:8799/v1/jobs', { method: 'POST', headers: { Origin: 'http://localhost:5173',
    Authorization: `Bearer ${business.token}`, 'X-Profile-Id': business.profileId, 'Content-Type': 'application/json',
    'Idempotency-Key': `idem-${stamp}` }, body: JSON.stringify(jobBody()) }).then((r) => r.json());
  const a = await send(); const b = await send();
  eq(a.id, b.id, 'same job'); eq((await usage()).used, 1, 'one slot');
});
await test('editing a published job spends nothing', async () => {
  const before = (await usage()).used;
  const jobs = (await call(business, 'GET', '/v1/jobs?tab=mine')).json.items;
  await call(business, 'PATCH', `/v1/jobs/${jobs[0].id}`, { title: 'Edited', description: 'Still sunny' });
  eq((await usage()).used, before, 'unchanged');
});
await test('re-opening a closed job is a new publication', async () => {
  const jobs = (await call(business, 'GET', '/v1/jobs?tab=mine')).json.items;
  const id = jobs[0].id;
  await call(business, 'POST', `/v1/jobs/${id}/close`);
  const before = (await usage()).used;
  eq((await call(business, 'POST', `/v1/jobs/${id}/publish`)).status, 200, 'reopened');
  eq((await usage()).used, before + 1, 'one more');
  const again = await call(business, 'POST', `/v1/jobs/${id}/publish`);
  eq((await usage()).used, before + 1, 'a repeat spends nothing'); eq(again.status < 500, true, again.text);
});
await test('Business PRO: unlimited', async () => {
  sql(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at) VALUES ('sub_f129_biz_${stamp}', '${business.profileId}', 'business_pro', 'active', 'test', ${stamp})`);
  for (let i = 0; i < 3; i++) eq((await call(business, 'POST', '/v1/jobs', jobBody())).status, 201, `job ${i}`);
  eq((await usage()).unlimited, true, 'unlimited');
});
await test('a creator can\'t create a job', async () => {
  eq((await call(pro, 'POST', '/v1/jobs', jobBody())).status, 403, 'creator');
});
await test('validation: description required, any number of languages (≤ 50), positive price, 100-char title', async () => {
  const bad = async (b) => (await call(business, 'POST', '/v1/jobs', jobBody(b))).status;
  eq(await bad({ description: '   ' }), 400, 'description');
  eq(await bad({ languages: ['en', 'tr', 'uk', 'de', 'fr'] }), 201, 'five languages');
  eq(await bad({ languages: Array.from({ length: 51 }, () => 'en') }), 400, 'over 50');
  eq(await bad({ compensationType: 'fixed', budgetMin: 0, currency: 'USD' }), 400, 'price 0');
  eq(await bad({ compensationType: 'fixed', budgetMin: -5, currency: 'USD' }), 400, 'negative');
  eq(await bad({ title: 'x'.repeat(101) }), 400, 'title');
  eq(await bad({ description: 'x'.repeat(2001) }), 400, 'long description');
  eq(await bad({ compensationType: 'fixed', budgetMin: 300, currency: 'USD' }), 201, 'a price');
});

await test('several places: kept in order, no duplicates, the first is the job\'s country', async () => {
  const r = await call(business, 'POST', '/v1/jobs', jobBody({ countryCode: 'ID', city: 'Bali', places: [
    { countryCode: 'ID', city: 'Bali' }, { countryCode: 'TR' }, { countryCode: 'ID', city: 'Bali' }] }));
  eq(r.status, 201, r.text);
  eq(r.json.places, [{ countryCode: 'ID', city: 'Bali' }, { countryCode: 'TR', city: null }], 'places');
  eq(r.json.countryCode, 'ID', 'primary');
  eq((await call(business, 'POST', '/v1/jobs', jobBody({ places: Array.from({ length: 6 }, () => ({ countryCode: 'ID' })) }))).status, 400, 'six');
});

console.log('Apply');
const job = (await call(business, 'POST', '/v1/jobs', jobBody())).json.id;
const vids = Array.from({ length: 12 }, (_, i) => video(pro, i + 1, i + 1));
const listed = async (appId) => ((await call(business, 'GET', `/v1/jobs/${job}/applications`)).json.items).find((a) => a.id === appId);
let manualApp;
await test('message: required, at most 1 000', async () => {
  eq((await call(free, 'POST', `/v1/jobs/${job}/apply`, { message: '   ' })).status, 400, 'blank');
  eq((await call(free, 'POST', `/v1/jobs/${job}/apply`, { message: 'x'.repeat(1001) })).status, 400, 'too long');
});
await test('FREE: text only; choosing videos needs PRO', async () => {
  eq((await call(free, 'POST', `/v1/jobs/${job}/apply`, { message: 'Hi', videoIds: [] })).status, 403, 'videos');
  eq((await call(free, 'POST', `/v1/jobs/${job}/apply`, { message: 'Hi' })).status, 201, 'text');
});
await test('PRO: a manual choice (3 videos, in order), only own portfolio', async () => {
  eq((await call(pro, 'POST', `/v1/jobs/${job}/apply`, { message: 'Hi', videoIds: ['med_nope'] })).status, 422, 'foreign');
  const r = await call(pro, 'POST', `/v1/jobs/${job}/apply`, { message: 'Hi', videoIds: [vids[5], vids[0], vids[9]] });
  eq(r.status, 201, r.text); manualApp = r.json.id;
  eq(r.json.media.map((m) => m.id), [vids[5], vids[0], vids[9]], 'chosen'); eq(r.json.mediaMode, 'manual', 'mode');
});
await test('a chosen video deleted leaves the application; PRO lost hides all; PRO back shows the rest', async () => {
  sql(`UPDATE media SET status = 'deleted' WHERE id = '${vids[0]}'`);
  eq((await listed(manualApp)).media.map((m) => m.id), [vids[5], vids[9]], 'two left');
  sql(`UPDATE subscriptions SET status = 'cancelled' WHERE profile_id = '${pro.profileId}'`);
  eq((await listed(manualApp)).media, [], 'hidden');
  sql(`UPDATE subscriptions SET status = 'active' WHERE profile_id = '${pro.profileId}'`);
  eq((await listed(manualApp)).media.map((m) => m.id), [vids[5], vids[9]], 'back');
});
await test('a second application to the same job is refused', async () => {
  eq((await call(pro, 'POST', `/v1/jobs/${job}/apply`, { message: 'Again' })).status, 409, 'duplicate');
});

console.log('Reviews');
await test('review text: at most 1 000', async () => {
  const r = await call(business, 'POST', '/v1/reviews', { recipientProfileId: free.profileId, quality: 5, speed: 5, contact: 5, comment: 'x'.repeat(1001) });
  eq(r.status, 400, r.text);
  eq((await call(business, 'POST', '/v1/reviews', { recipientProfileId: free.profileId, quality: 5, speed: 5, contact: 5, comment: 'Great' })).status, 201, 'ok');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
