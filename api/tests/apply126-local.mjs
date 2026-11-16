// FEATURE 126 local API checks — a PRO Apply carries the creator's latest published portfolio videos (server-chosen,
// at most 10, newest first, kept with the application); a FREE Apply carries none.
//   cd api && npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX: --var MONETIZATION_ENABLED:true
//   node tests/apply126-local.mjs "$PWD"      (local D1 only — never against production)
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
  const uid = `usr_a126_${tag}_${stamp}`; const email = `a126.${tag}.${stamp}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const token = (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token;
  const profile = (await call({ token }, 'POST', '/v1/profiles', { type, displayName: `${type} ${tag}` })).json.id;
  return { token, profileId: profile };
}
/** A portfolio video of `owner`, `ageMinutes` old. */
function video(owner, n, ageMinutes, extra = {}) {
  const id = `med_a126_${owner.profileId}_${n}`;
  const f = { status: 'ready', is_public: 1, review_status: 'approved', purpose: 'portfolio', ...extra };
  sql(`INSERT INTO media (id, owner_profile_id, kind, purpose, provider, url, status, is_public, review_status, duration, created_at)
       VALUES ('${id}', '${owner.profileId}', 'video', '${f.purpose}', 'external', 'https://example.com/${id}.mp4', '${f.status}', ${f.is_public},
               '${f.review_status}', 12, ${stamp - ageMinutes * 60_000})`);
  return id;
}

const business = await person('biz', 'business');
const pro = await person('pro', 'creator');
const free = await person('free', 'creator');
sql(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at) VALUES ('sub_a126_${stamp}', '${pro.profileId}', 'creator_pro', 'active', 'test', ${stamp})`);

// The PRO creator: 12 published videos (1 = newest) and some that must never go: private, rejected, deleted, a photo.
const published = Array.from({ length: 12 }, (_, i) => video(pro, i + 1, i + 1));
video(pro, 'private', 0, { is_public: 0 });
video(pro, 'rejected', 0, { review_status: 'rejected' });
video(pro, 'deleted', 0, { status: 'deleted' });
video(free, 1, 1);
const job = (await call(business, 'POST', '/v1/jobs', { title: 'UGC for a villa', description: 'x', publish: true })).json?.id;

console.log('PRO Apply');
let proApplication;
await test('carries the 10 newest published videos, newest first', async () => {
  const r = await call(pro, 'POST', `/v1/jobs/${job}/apply`, { message: 'Hi!' });
  eq(r.status, 201, r.text);
  proApplication = r.json.id;
  eq(r.json.media.map((m) => m.id), published.slice(0, 10), 'videos');
});
await test('videos the client sends are ignored (no duplicates, nobody else\'s)', async () => {
  const j2 = (await call(business, 'POST', '/v1/jobs', { title: 'Second job', description: 'x', publish: true })).json.id;
  const r = await call(pro, 'POST', `/v1/jobs/${j2}/apply`, { message: 'Hi!', mediaIds: [published[11], published[0]] });
  eq(r.status, 201, r.text);
  eq(r.json.media.map((m) => m.id), published.slice(0, 10), 'still the server\'s ten');
});
await test('the set stays as it was sent; a video deleted later leaves it', async () => {
  video(pro, 'newer', 0);
  sql(`UPDATE media SET status = 'deleted' WHERE id = '${published[0]}'`);
  const list = await call(business, 'GET', `/v1/jobs/${job}/applications`);
  const app = (list.json.items ?? list.json).find((a) => a.id === proApplication);
  eq(app.media.map((m) => m.id), published.slice(1, 10), 'nine left, no new one');
});

console.log('FREE Apply');
await test('carries no videos', async () => {
  const r = await call(free, 'POST', `/v1/jobs/${job}/apply`, { message: 'Hi!' });
  eq(r.status, 201, r.text);
  eq(r.json.media.length, 0, 'media');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
