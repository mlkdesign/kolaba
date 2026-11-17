// FIX 126 local API checks — reviews only between different kinds of profiles; the author edits / deletes their review.
//   cd api && npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX:
//   node tests/reviews126-local.mjs "$PWD"      (local D1 only — never against production)
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
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`); };

// Two fresh accounts (the demo account's password hash), each with a creator and a business.
const demo = Object.keys(creds)[1];
const [src] = sql(`SELECT password_hash, password_salt, password_scheme FROM users WHERE email = '${demo}'`);
async function person(tag) {
  const uid = `usr_r126_${tag}_${Date.now()}`; const email = `r126.${tag}.${Date.now()}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${Date.now()}, 'owner', 0, ${Date.now()}, ${Date.now()})`);
  const token = (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token;
  const creator = (await call({ token }, 'POST', '/v1/profiles', { type: 'creator', displayName: `Creator ${tag}` })).json.id;
  const business = (await call({ token }, 'POST', '/v1/profiles', { type: 'business', displayName: `Business ${tag}` })).json.id;
  return { token, creator, business, as: (profileId) => ({ token, profileId }) };
}
const a = await person('a');
const b = await person('b');
const body = (recipientProfileId, comment = 'Clear brief, paid on time.') =>
  ({ recipientProfileId, quality: 5, speed: 4, contact: 5, comment });

console.log('Only the other kind reviews');
await test('creator → creator refused', async () => {
  const r = await call(a.as(a.creator), 'POST', '/v1/reviews', body(b.creator));
  eq(r.json?.error?.code, 'same_profile_type', r.text);
});
await test('business → business refused', async () => {
  const r = await call(a.as(a.business), 'POST', '/v1/reviews', body(b.business));
  eq(r.json?.error?.code, 'same_profile_type', r.text);
});
let reviewId;
await test('creator → business published', async () => {
  const r = await call(a.as(a.creator), 'POST', '/v1/reviews', body(b.business));
  eq(r.status, 201, r.text); reviewId = r.json.id;
});
await test('business → creator published', async () => {
  const r = await call(b.as(b.business), 'POST', '/v1/reviews', body(a.creator, 'Great content, fast delivery.'));
  eq(r.status, 201, r.text);
});

console.log('The author edits and deletes');
await test('someone else cannot edit or delete it', async () => {
  const e = await call(b.as(b.creator), 'PATCH', `/v1/reviews/${reviewId}`, { quality: 1, speed: 1, contact: 1, comment: 'x' });
  eq(e.json?.error?.code, 'not_your_review', e.text);
  const d = await call(b.as(b.creator), 'DELETE', `/v1/reviews/${reviewId}`);
  eq(d.status, 403, d.text);
});
await test('the author edits: scores and text replaced, one review', async () => {
  const r = await call(a.as(a.creator), 'PATCH', `/v1/reviews/${reviewId}`, { quality: 3, speed: 3, contact: 4, comment: 'Updated after the second job.' });
  eq(r.status, 200, r.text);
  const list = await call(null, 'GET', `/v1/reviews?profileId=${b.business}`);
  eq(list.json.items.length, 1, 'one review');
  eq(list.json.items[0].comment, 'Updated after the second job.', 'text');
  eq(list.json.items[0].quality, 3, 'quality');
});
await test('FIX 128: nobody deletes a review directly (only Report → moderation); it stays', async () => {
  const r = await call(a.as(a.creator), 'DELETE', `/v1/reviews/${reviewId}`);
  eq(r.json?.error?.code, 'delete_via_report', r.text);
  const list = await call(null, 'GET', `/v1/reviews?profileId=${b.business}`);
  eq(list.json.items.length, 1, 'still one review');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
