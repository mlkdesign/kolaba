// FIX 131 local API checks — Delete all data: the account becomes an anonymous tombstone, its files go, chats stay.
//   cd api && npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX: --var MONETIZATION_ENABLED:true
//   node tests/fix131-erase-local.mjs "$PWD"      (local D1 only — never against production)
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
  const uid = `usr_x131_${tag}_${stamp}`; const email = `x131.${tag}.${stamp}@example.com`;
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
const adminToken = `x131-admin-${stamp}`;
{
  const { createHash } = await import('node:crypto');
  const [adminRow] = sql(`SELECT id FROM admins WHERE must_change_password = 0 LIMIT 1`);
  if (adminRow) sql(`INSERT INTO admin_sessions (id, admin_id, created_at, expires_at, last_seen_at) VALUES
      ('${createHash('sha256').update(adminToken).digest('hex')}', '${adminRow.id}', ${Date.now()}, ${Date.now() + 3_600_000}, ${Date.now()})`);
}
const password = creds[demo].password;
const signup = (email) => call(null, 'POST', '/v1/auth/signup', { email, password, acceptTerms: true });


const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function upload(s, purpose) {
  const up = await call(s, 'POST', '/v1/media/uploads', { purpose, kind: 'photo', mime: 'image/png', bytes: png.length });
  const put = await fetch(up.json.uploadUrl.replace(/^https?:\/\/[^/]+/, API), { method: 'PUT', body: png, headers: { Authorization: `Bearer ${s.token}`, 'X-Profile-Id': s.profileId,
    'Content-Type': 'image/png', 'Content-Length': String(png.length), Origin: ORIGIN } });
  if (put.status !== 200) throw new Error(`upload ${put.status} ${await put.text()}`);
  return up.json.mediaId;
}
const a = await person('a', 'creator');
const aBiz = { token: a.token, profileId: (await call(a, 'POST', '/v1/profiles', { type: 'business', displayName: 'A Biz' })).json.id };
const b = await person('b', 'creator');
const [aUser] = sql(`SELECT id, email FROM users WHERE id = 'usr_x131_a_${stamp}'`);
let conv, aPhoto, bPhoto, aPortfolio, aFileId, job;
await test('setup: a chat both ways with photos, a file, a portfolio photo, a job', async () => {
  conv = (await call(a, 'POST', '/v1/conversations', { profileId: b.profileId })).json.id;
  aPhoto = await upload(a, 'chat');
  eq((await call(a, 'POST', `/v1/conversations/${conv}/messages`, { body: 'hello from A', mediaIds: [aPhoto] })).status, 201, 'A sends');
  bPhoto = await upload(b, 'chat');
  eq((await call(b, 'POST', `/v1/conversations/${conv}/messages`, { body: 'hi A', mediaIds: [bPhoto] })).status, 201, 'B sends');
  const form = new FormData(); form.set('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'a.pdf');
  const f = await fetch(`${API}/v1/conversations/${conv}/files`, { method: 'POST', body: form,
    headers: { Authorization: `Bearer ${a.token}`, 'X-Profile-Id': a.profileId, Origin: ORIGIN } });
  eq(f.status, 201, await f.text());
  aPortfolio = await upload(a, 'portfolio');
  job = (await call(aBiz, 'POST', '/v1/jobs', { title: 'A job', description: 'secret text', publish: true })).json.id;
  sql(`UPDATE jobs SET review_status = 'approved' WHERE id = '${job}'`);
  eq((await fetch(`${API}/v1/media/${aPortfolio}/file`)).status, 200, 'portfolio served before');
});
let erasure;
await test('admin Delete all data: the erasure completes, files removed', async () => {
  const r = await adminCall(adminToken, 'PATCH', `/v1/admin/users/${aUser.id}/status`, { action: 'delete', reason: 'GDPR request', deleteAllData: true });
  eq(r.status, 200, r.text); erasure = r.json.erasure;
  eq(erasure.status, 'completed', 'completed'); eq(erasure.filesFailed, 0, 'no failures'); eq(erasure.filesTotal >= 3, true, `files ${erasure.filesTotal}`);
  eq((await fetch(`${API}/v1/media/${aPortfolio}/file`)).status, 404, 'portfolio file gone');
  const [left] = sql(`SELECT COUNT(*) AS n FROM account_deletion_files WHERE deletion_id = '${erasure.id}' AND deleted_at IS NULL`);
  eq(left.n, 0, 'every file marked removed');
});
await test('the tombstone: no e-mail, no names, no sessions, profiles "Deleted account"', async () => {
  const [u] = sql(`SELECT email, password_hash, erased_at, status FROM users WHERE id = '${aUser.id}'`);
  eq(u.email.endsWith('@users.kolaba.invalid'), true, 'email replaced'); eq(u.password_hash, null, 'no password'); eq(u.status, 'deleted', 'status');
  const ps = sql(`SELECT display_name, bio, city, avatar_media_id, erased_at FROM profiles WHERE owner_user_id = '${aUser.id}'`);
  eq(ps.length, 2, 'both profiles kept as ids'); eq(ps.every((p) => p.display_name === 'Deleted account' && p.erased_at), true, 'anonymous');
  eq((await call(a, 'GET', '/v1/conversations')).status, 401, 'session ended');
  eq((await call(b, 'GET', `/v1/profiles/${a.profileId}`)).json?.error?.code, 'account_deleted', 'profile 410');
});
await test('B keeps the chat: A shown as Deleted account, text kept, A\'s media unavailable, B\'s own photo intact', async () => {
  const list = await call(b, 'GET', '/v1/conversations');
  const item = list.json.items.find((i) => i.id === conv);
  eq(item.partner.displayName, 'Deleted account', 'name'); eq(item.partner.isDeleted, true, 'flag'); eq(item.partner.avatarUrl, null, 'no avatar');
  const msgs = (await call(b, 'GET', `/v1/conversations/${conv}/messages`)).json.items;
  const fromA = msgs.find((m) => m.body === 'hello from A');
  eq(Boolean(fromA), true, 'A text kept'); eq(fromA.attachments[0]?.unavailable, true, 'A photo unavailable'); eq(fromA.attachments[0]?.url, null, 'no url');
  const fileMsg = msgs.find((m) => m.files?.length);
  eq(fileMsg.files[0].unavailable, true, 'file unavailable'); eq(fileMsg.files[0].url, null, 'no file url');
  const fromB = msgs.find((m) => m.body === 'hi A');
  eq(fromB.attachments[0]?.unavailable ?? false, false, 'B photo kept'); eq(Boolean(fromB.attachments[0]?.url), true, 'B photo url');
  const [bMedia] = sql(`SELECT status FROM media WHERE id = '${bPhoto}'`); eq(bMedia.status, 'ready', 'B file not touched');
});
await test('no new message can be sent to the deleted account', async () => {
  const r = await call(b, 'POST', `/v1/conversations/${conv}/messages`, { body: 'still there?' });
  eq(r.status, 410, r.text); eq(r.json.error.code, 'account_deleted', 'code');
});
await test('its job is off the feed, kept for the admin without its text', async () => {
  const [j] = sql(`SELECT status, description, title FROM jobs WHERE id = '${job}'`);
  eq(j.status, 'removed', 'removed'); eq(j.description, '', 'text cleared'); eq(j.title, 'A job', 'title kept');
  eq((await call(b, 'GET', `/v1/jobs/${job}`)).status >= 400, true, 'not public');
});
await test('the same e-mail registers as a brand-new account', async () => {
  // Sign-up isn't refused for this e-mail (no "taken" / "deleted" — the old account no longer holds it).
  const r = await signup(aUser.email);
  eq(['email_taken', 'account_deleted', 'account_suspended'].includes(r.json?.error?.code), false, r.text);
  eq(sql(`SELECT COUNT(*) AS n FROM users WHERE email = '${aUser.email}'`)[0].n <= 1, true, 'never the old row');
  // The new account (made directly: local e-mail delivery is off) signs in with its own id and nothing of A's.
  sql(`INSERT OR IGNORE INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('usr_x131_new_${stamp}', '${aUser.email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const login = await call(null, 'POST', '/v1/auth/login', { email: aUser.email, password });
  eq(login.status, 200, login.text);
  const [row] = sql(`SELECT id FROM users WHERE email = '${aUser.email}'`);
  eq(row.id === aUser.id, false, 'new id');
  const session = await call({ token: login.json.token }, 'GET', '/v1/auth/session');
  eq(session.status, 200, session.text); eq((session.json.profiles ?? []).length, 0, 'no old profiles');
});
await test('an erased account cannot be restored or blocked; retry is idempotent', async () => {
  eq((await adminCall(adminToken, 'PATCH', `/v1/admin/users/${aUser.id}/status`, { action: 'restore' })).json?.error?.code, 'account_erased', 'restore');
  eq((await adminCall(adminToken, 'PATCH', `/v1/admin/users/${aUser.id}/status`, { action: 'block', reason: 'x x x' })).json?.error?.code, 'account_erased', 'block');
  const retry = await adminCall(adminToken, 'POST', `/v1/admin/users/${aUser.id}/erasure/retry`);
  eq(retry.json.erasure.status, 'completed', 'still completed');
  const detail = await adminCall(adminToken, 'GET', `/v1/admin/users/${aUser.id}`);
  eq(detail.json.erased, true, 'erased'); eq(detail.json.email, 'Deleted account', 'no email shown');
});
const c2 = await person('self', 'creator');
await test('Settings → Delete account in the app goes through the same erasure', async () => {
  const r = await call(c2, 'DELETE', '/v1/me', { confirm: 'DELETE', password });
  eq(r.status, 200, r.text); eq(r.json.erasure, 'completed', 'completed');
  const [u] = sql(`SELECT erased_at FROM users WHERE id = 'usr_x131_self_${stamp}'`); eq(Boolean(u.erased_at), true, 'tombstone');
});
await test('admin soft delete without the box stays restorable (nothing erased)', async () => {
  const soft = await person('soft', 'creator');
  const id = `usr_x131_soft_${stamp}`;
  eq((await adminCall(adminToken, 'PATCH', `/v1/admin/users/${id}/status`, { action: 'delete', reason: 'soft one' })).status, 200, 'deleted');
  const [u] = sql(`SELECT erased_at, status FROM users WHERE id = '${id}'`); eq(u.erased_at, null, 'not erased');
  eq((await adminCall(adminToken, 'PATCH', `/v1/admin/users/${id}/status`, { action: 'restore' })).status, 200, 'restored');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
