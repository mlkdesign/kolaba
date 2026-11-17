// FEATURE 130 local API checks — admin job-post slots (add / reset), Liked media.
//   cd api && npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX: --var MONETIZATION_ENABLED:true
//   node tests/feature130-local.mjs "$PWD"      (local D1 only — never against production)
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
  const uid = `usr_f130_${tag}_${stamp}`; const email = `f130.${tag}.${stamp}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const token = (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token;
  const profile = (await call({ token }, 'POST', '/v1/profiles', { type, displayName: `${type} ${tag}` })).json.id;
  return { token, profileId: profile };
}

const business = await person('biz', 'business');
const creator = await person('creator', 'creator');
const [bizUser] = sql(`SELECT owner_user_id AS u FROM profiles WHERE id = '${business.profileId}'`);
const jobBody = (extra = {}) => ({ title: 'UGC for a villa', description: 'Sunny shoot', publish: true, ...extra });
const usage = async () => (await call(business, 'GET', '/v1/me/entitlements')).json.features.job_posts;

const adminCall = async (token, method, path, body) => {
  const headers = { Origin: 'http://localhost:5174', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};
const adminToken = `f130-admin-${stamp}`;
{
  const { createHash } = await import('node:crypto');
  const [adminRow] = sql(`SELECT id FROM admins WHERE must_change_password = 0 LIMIT 1`);
  if (adminRow) sql(`INSERT INTO admin_sessions (id, admin_id, created_at, expires_at, last_seen_at) VALUES
      ('${createHash('sha256').update(adminToken).digest('hex')}', '${adminRow.id}', ${Date.now()}, ${Date.now() + 3_600_000}, ${Date.now()})`);
}

await test('free plan: the limit stops publishing', async () => {
  const before = await usage();
  for (let i = before.used; i < before.limit; i++) eq((await call(business, 'POST', '/v1/jobs', jobBody())).status, 201, `job ${i}`);
  const r = await call(business, 'POST', '/v1/jobs', jobBody());
  eq(r.json?.error?.code, 'FEATURE_LIMIT_REACHED', r.text);
});
await test('admin adds 2 slots: two more publications, then the limit again', async () => {
  const r = await adminCall(adminToken, 'POST', `/v1/admin/users/${bizUser.u}/job-posts`, { action: 'add', amount: 2, reason: 'promo' });
  eq(r.status, 200, r.text);
  const u = await usage();
  eq(u.bonus, 2, 'bonus'); eq(u.remaining, 2, 'remaining');
  eq((await call(business, 'POST', '/v1/jobs', jobBody())).status, 201, 'extra 1');
  eq((await call(business, 'POST', '/v1/jobs', jobBody())).status, 201, 'extra 2');
  eq((await call(business, 'POST', '/v1/jobs', jobBody())).json?.error?.code, 'FEATURE_LIMIT_REACHED', 'limit again');
});
await test('admin resets the used slots: nothing used, publishing works', async () => {
  const r = await adminCall(adminToken, 'POST', `/v1/admin/users/${bizUser.u}/job-posts`, { action: 'reset' });
  eq(r.status, 200, r.text);
  eq((await usage()).used, 0, 'used after reset');
  eq((await call(business, 'POST', '/v1/jobs', jobBody())).status, 201, 'after reset');
  eq((await usage()).used, 1, 'counted after reset');
  const detail = await adminCall(adminToken, 'GET', `/v1/admin/users/${bizUser.u}`);
  eq(detail.json.jobPosts.used, 1, 'admin sees it');
});
await test('admin: an account without a business profile has no slots to change', async () => {
  const [cu] = sql(`SELECT owner_user_id AS u FROM profiles WHERE id = '${creator.profileId}'`);
  eq((await adminCall(adminToken, 'POST', `/v1/admin/users/${cu.u}/job-posts`, { action: 'add', amount: 1 })).status, 422, 'no business');
});
await test('Liked media: the liked videos, latest like first; an unliked one goes', async () => {
  const ids = [1, 2].map((n) => {
    const id = `med_f130_${stamp}_${n}`;
    sql(`INSERT INTO media (id, owner_profile_id, kind, purpose, provider, url, status, is_public, review_status, duration, created_at)
         VALUES ('${id}', '${business.profileId}', 'video', 'portfolio', 'external', 'https://example.com/${id}.mp4', 'ready', 1, 'approved', 9, ${stamp})`);
    return id;
  });
  eq((await call(creator, 'PUT', `/v1/media/${ids[0]}/like`)).status, 200, 'like 1');
  await new Promise((r) => setTimeout(r, 5));
  eq((await call(creator, 'PUT', `/v1/media/${ids[1]}/like`)).status, 200, 'like 2');
  let list = await call(creator, 'GET', '/v1/me/liked-media');
  eq(list.json.items.map((m) => m.id), [ids[1], ids[0]], 'order');
  await call(creator, 'DELETE', `/v1/media/${ids[1]}/like`);
  list = await call(creator, 'GET', '/v1/me/liked-media');
  eq(list.json.items.map((m) => m.id), [ids[0]], 'after unlike');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
