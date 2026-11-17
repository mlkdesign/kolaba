// FEATURE 135 local API checks — a deleted account frees its e-mail, a blocked one keeps it.
//   cd api && npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX: --var MONETIZATION_ENABLED:true
//   node tests/feature135-local.mjs "$PWD"      (local D1 only — never against production)
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
  const uid = `usr_f135_${tag}_${stamp}`; const email = `f135.${tag}.${stamp}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const token = (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token;
  const profile = (await call({ token }, 'POST', '/v1/profiles', { type, displayName: `${type} ${tag}` })).json.id;
  return { token, profileId: profile };
}


const adminCall = async (token, method, path, body) => {
  const headers = { Origin: 'http://localhost:5174', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};
const adminToken = `f135-admin-${stamp}`;
{
  const { createHash } = await import('node:crypto');
  const [adminRow] = sql(`SELECT id FROM admins WHERE must_change_password = 0 LIMIT 1`);
  if (adminRow) sql(`INSERT INTO admin_sessions (id, admin_id, created_at, expires_at, last_seen_at) VALUES
      ('${createHash('sha256').update(adminToken).digest('hex')}', '${adminRow.id}', ${Date.now()}, ${Date.now() + 3_600_000}, ${Date.now()})`);
}
const password = creds[demo].password;
const signup = (email) => call(null, 'POST', '/v1/auth/signup', { email, password, acceptTerms: true });

const del = await person('del', 'creator');
const [delUser] = sql(`SELECT id, email FROM users WHERE id = 'usr_f135_del_${stamp}'`);
await test('admin deletes: sign-in says the account was deleted', async () => {
  eq((await adminCall(adminToken, 'PATCH', `/v1/admin/users/${delUser.id}/status`, { action: 'delete', reason: 'test delete' })).status, 200, 'deleted');
  const r = await call(null, 'POST', '/v1/auth/login', { email: delUser.email, password });
  eq(r.json?.error?.code, 'account_deleted', r.text);
});
await test('registering again frees the e-mail (the old account keeps its data)', async () => {
  const r = await signup(delUser.email);
  eq(r.json?.error?.code !== 'email_taken' && r.json?.error?.code !== 'account_suspended', true, r.text);
  const [row] = sql(`SELECT email, released_email, status FROM users WHERE id = '${delUser.id}'`);
  eq(row.released_email, delUser.email, 'kept'); eq(row.status, 'deleted', 'still deleted'); eq(row.email === delUser.email, false, 'freed');
  const detail = await adminCall(adminToken, 'GET', `/v1/admin/users/${delUser.id}`);
  eq(detail.json.email, delUser.email, 'admin sees its e-mail'); eq(detail.json.emailReused, true, 'marked');
});
await test('restore puts the e-mail back while no new account took it', async () => {
  eq((await adminCall(adminToken, 'PATCH', `/v1/admin/users/${delUser.id}/status`, { action: 'restore' })).status, 200, 'restored');
  const [row] = sql(`SELECT email, released_email, status FROM users WHERE id = '${delUser.id}'`);
  eq(row.email, delUser.email, 'back'); eq(row.released_email, null, 'cleared'); eq(row.status, 'active', 'active');
  eq((await call(null, 'POST', '/v1/auth/login', { email: delUser.email, password })).status, 200, 'signs in');
});
await test('restore is refused once a new account uses the e-mail', async () => {
  eq((await adminCall(adminToken, 'PATCH', `/v1/admin/users/${delUser.id}/status`, { action: 'delete', reason: 'again' })).status, 200, 'deleted');
  await signup(delUser.email);
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('usr_f135_new_${stamp}', '${delUser.email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const r = await adminCall(adminToken, 'PATCH', `/v1/admin/users/${delUser.id}/status`, { action: 'restore' });
  eq(r.json?.error?.code, 'email_reused', r.text);
});
const blk = await person('blk', 'creator');
const [blkUser] = sql(`SELECT id, email FROM users WHERE id = 'usr_f135_blk_${stamp}'`);
await test('a blocked account keeps its e-mail: no new account, sign-in refused', async () => {
  eq((await adminCall(adminToken, 'PATCH', `/v1/admin/users/${blkUser.id}/status`, { action: 'block', reason: 'test block' })).status, 200, 'blocked');
  eq((await signup(blkUser.email)).json?.error?.code, 'account_suspended', 'no new account');
  eq((await call(null, 'POST', '/v1/auth/login', { email: blkUser.email, password })).json?.error?.code, 'account_suspended', 'no sign-in');
  const [row] = sql(`SELECT email FROM users WHERE id = '${blkUser.id}'`);
  eq(row.email, blkUser.email, 'kept');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
