// FEATURE 115 local API checks (wrangler dev --env local on :8799; local D1 only).
//   cd api && npx wrangler dev --env local --port 8799 --test-scheduled --var RESEND_API_KEY: --var TEST_CODE_INBOX:
//   node tests/feature115-local.mjs "$PWD"      (local D1 only — never against production)
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

const demo = Object.keys(creds)[1];
const [src] = sql(`SELECT password_hash, password_salt, password_scheme FROM users WHERE email = '${demo}'`);
const uid = `usr_t115_${Date.now()}`; const email = `t115.${Date.now()}@example.com`;
sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
     VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${Date.now()}, 'owner', 0, ${Date.now()}, ${Date.now()})`);
const password = creds[demo].password;
const login = async (pw = password) => call(null, 'POST', '/v1/auth/login', { email, password: pw });
let s = { token: (await login()).json.token };

console.log('Profiles: 1 creator + 5 business, atomic');
let creatorId;
await test('business-only account: first profile can be Business', async () => {
  const r = await call(s, 'POST', '/v1/profiles', { type: 'business', displayName: 'Biz 1' });
  eq(r.status, 201, r.text);
});
await test('creator created, second creator refused', async () => {
  const a = await call(s, 'POST', '/v1/profiles', { type: 'creator', displayName: 'Me' }); eq(a.status, 201, a.text); creatorId = a.json.id;
  const b = await call(s, 'POST', '/v1/profiles', { type: 'creator', displayName: 'Me 2' }); eq(b.json?.error?.code, 'creator_profile_exists', b.text);
});
await test('businesses up to 5; parallel extra requests cannot pass the limit', async () => {
  for (let i = 2; i <= 3; i++) eq((await call(s, 'POST', '/v1/profiles', { type: 'business', displayName: `Biz ${i}` })).status, 201, 'biz');
  const rs = await Promise.all([4, 5, 6, 7].map((i) => call(s, 'POST', '/v1/profiles', { type: 'business', displayName: `Biz ${i}` })));
  eq(rs.filter((r) => r.status === 201).length, 2, 'parallel successes');
  const [n] = sql(`SELECT COUNT(*) AS n FROM profiles WHERE owner_user_id = '${uid}' AND type = 'business'`); eq(n.n, 5, 'business count');
});

console.log('Password recovery');
await test('forgot: unknown e-mail gets the same answer', async () => {
  const r = await call(null, 'POST', '/v1/auth/password/forgot', { email: 'nobody.f115@example.com' });
  eq(r.status, 200, r.text); eq(r.json.status, 'sent', 'status'); eq(r.json.resendAfter, 30, 'resendAfter');
});
const code = '482913';
sql(`INSERT INTO email_codes (id, user_id, purpose, code_hash, expires_at, created_at) VALUES ('code_t115_${Date.now()}', '${uid}', 'reset', '${sha(`${uid}:${code}`)}', ${Date.now() + 600000}, ${Date.now()})`);
await test('forgot within 30 s: no new code, server cooldown returned', async () => {
  const r = await call(null, 'POST', '/v1/auth/password/forgot', { email });
  eq(r.status, 200, r.text); if (!(r.json.resendAfter > 0 && r.json.resendAfter <= 30)) throw new Error(`resendAfter ${r.json.resendAfter}`);
  const [n] = sql(`SELECT COUNT(*) AS n FROM email_codes WHERE user_id = '${uid}' AND purpose = 'reset'`); eq(n.n, 1, 'codes');
});
await test('wrong code refused', async () => {
  const r = await call(null, 'POST', '/v1/auth/password/verify', { email, code: '000000' }); eq(r.json?.error?.code, 'code_invalid', r.text);
});
let resetToken;
await test('right code gives a reset token; the code is then spent', async () => {
  const r = await call(null, 'POST', '/v1/auth/password/verify', { email, code }); eq(r.status, 200, r.text); resetToken = r.json.resetToken;
  const again = await call(null, 'POST', '/v1/auth/password/verify', { email, code }); eq(again.json?.error?.code, 'code_expired', again.text);
});
await test('weak password refused by policy', async () => {
  const r = await call(null, 'POST', '/v1/auth/password/reset', { resetToken, password: '123' }); eq(r.status, 422, r.text);
});
const newPassword = `Nw-${randomUUID().slice(0, 12)}!a`;
await test('reset sets the password once; sessions end; old password dead; new works', async () => {
  const r = await call(null, 'POST', '/v1/auth/password/reset', { resetToken, password: newPassword }); eq(r.status, 200, r.text);
  const reuse = await call(null, 'POST', '/v1/auth/password/reset', { resetToken, password: newPassword }); eq(reuse.json?.error?.code, 'reset_token_expired', reuse.text);
  eq((await call(s, 'GET', '/v1/auth/session')).status, 401, 'old session');
  eq((await login()).status, 401, 'old password');
  const ok = await login(newPassword); eq(ok.status, 200, ok.text); s = { token: ok.json.token };
});
await test('five wrong tries end a code', async () => {
  const c2 = '111222';
  sql(`INSERT INTO email_codes (id, user_id, purpose, code_hash, expires_at, created_at) VALUES ('code_t115b_${Date.now()}', '${uid}', 'reset', '${sha(`${uid}:${c2}`)}', ${Date.now() + 600000}, ${Date.now()})`);
  for (let i = 0; i < 5; i++) await call(null, 'POST', '/v1/auth/password/verify', { email, code: '999999' });
  const r = await call(null, 'POST', '/v1/auth/password/verify', { email, code: c2 }); eq(r.json?.error?.code, 'code_expired', r.text);
});

console.log('Admin PRO grant');
const adminToken = randomUUID() + randomUUID();
sql(`INSERT OR IGNORE INTO admins (id, email, password_hash, password_salt, password_scheme, must_change_password, created_at, updated_at)
     VALUES ('adm_t115', 'milka19051995@gmail.com', 'x', 'x', 'x', 0, 0, 0)`);
const [adm] = sql(`SELECT id FROM admins WHERE email = 'milka19051995@gmail.com'`);
sql(`UPDATE admins SET must_change_password = 0 WHERE id = '${adm.id}'`);
sql(`INSERT INTO admin_sessions (id, admin_id, created_at, expires_at, last_seen_at) VALUES ('${sha(adminToken)}', '${adm.id}', ${Date.now()}, ${Date.now() + 3600000}, ${Date.now()})`);
const A = { token: adminToken };
const requestKey = randomUUID();
await test('grant: one month, one notification, only this profile', async () => {
  const r = await call(A, 'PATCH', `/v1/admin/profiles/${creatorId}/pro`, { action: 'grant', months: 1, requestKey }, { origin: ADMIN_ORIGIN });
  eq(r.status, 200, r.text);
  const exp = new Date(r.json.expiresAt), nowD = new Date();
  const expected = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() + 1, Math.min(nowD.getUTCDate(), new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() + 2, 0)).getUTCDate())));
  eq(exp.toISOString().slice(0, 10), expected.toISOString().slice(0, 10), 'expiry date');
  const again = await call(A, 'PATCH', `/v1/admin/profiles/${creatorId}/pro`, { action: 'grant', months: 1, requestKey }, { origin: ADMIN_ORIGIN });
  eq(again.json.repeated, true, 'same request key is a no-op');
  const dup = await call(A, 'PATCH', `/v1/admin/profiles/${creatorId}/pro`, { action: 'grant', months: 1, requestKey: randomUUID() }, { origin: ADMIN_ORIGIN });
  eq(dup.json?.error?.code, 'pro_already_active', dup.text);
  const n = sql(`SELECT payload FROM notifications WHERE recipient_profile_id = '${creatorId}' AND type = 'pro_granted'`);
  eq(n.length, 1, 'notifications');
  if (!JSON.parse(n[0].payload).message.includes('CREATOR.PRO')) throw new Error(n[0].payload);
  const others = sql(`SELECT COUNT(*) AS n FROM subscriptions s JOIN profiles p ON p.id = s.profile_id WHERE p.owner_user_id = '${uid}' AND s.status = 'active'`);
  eq(others[0].n, 1, 'only one profile has PRO');
  const logs = sql(`SELECT COUNT(*) AS n FROM admin_logs WHERE entity_id = '${creatorId}' AND action = 'pro.grant'`); eq(logs[0].n, 1, 'audit');
});
await test('the owner sees PRO (badge + entitlements) with paid plans off; feed has the notification', async () => {
  const ss = await call(s, 'GET', '/v1/auth/session');
  const p = ss.json.profiles.find((x) => x.id === creatorId);
  eq(p.isPro, true, 'card isPro'); eq(p.entitlements.isPro, true, 'entitlements isPro');
  const biz = ss.json.profiles.find((x) => x.type === 'business'); eq(biz.isPro, false, 'business untouched');
  const feed = await call({ ...s, profileId: creatorId }, 'GET', '/v1/notifications');
  eq(feed.json.items[0].type, 'pro_granted', 'feed');
});
await test('BUSINESS.PRO text for a business profile', async () => {
  const [b] = sql(`SELECT id FROM profiles WHERE owner_user_id = '${uid}' AND type = 'business' LIMIT 1`);
  const r = await call(A, 'PATCH', `/v1/admin/profiles/${b.id}/pro`, { action: 'grant', requestKey: randomUUID() }, { origin: ADMIN_ORIGIN }); eq(r.status, 200, r.text);
  const [n] = sql(`SELECT payload FROM notifications WHERE recipient_profile_id = '${b.id}' AND type = 'pro_granted'`);
  if (!JSON.parse(n.payload).message.includes('BUSINESS.PRO')) throw new Error(n.payload);
});
await test('expiry is the server’s: an ended grant is not PRO, the cron marks it expired, no new notification', async () => {
  sql(`UPDATE subscriptions SET expires_at = ${Date.now() - 1000} WHERE profile_id = '${creatorId}' AND source = 'admin'`);
  const ss = await call(s, 'GET', '/v1/auth/session'); eq(ss.json.profiles.find((x) => x.id === creatorId).isPro, false, 'isPro after expiry');
  
  await fetch(`${API}/__scheduled?cron=17+3+*+*+*`);
  const [g] = sql(`SELECT status FROM pro_grants WHERE profile_id = '${creatorId}'`); eq(g.status, 'expired', 'grant status');
  const n = sql(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_profile_id = '${creatorId}' AND type = 'pro_granted'`); eq(n[0].n, 1, 'no extra notification');
});

console.log('Messages are not Notifications');
await test('a message: unread in Chat, nothing in the feed', async () => {
  const other = await call(null, 'POST', '/v1/auth/login', { email: demo, password });
  const o = { token: other.json.token, profileId: other.json.profiles[0].id };
  const me = { ...s, profileId: creatorId };
  const conv = await call(o, 'POST', '/v1/conversations', { profileId: creatorId }); if (conv.status >= 300) throw new Error(conv.text);
  const sent = await call(o, 'POST', `/v1/conversations/${conv.json.id ?? conv.json.conversation?.id}/messages`, { body: 'Hey! I would love to discuss your project.' });
  if (sent.status >= 300) throw new Error(sent.text);
  const sync = await call(me, 'GET', '/v1/sync'); if (!(sync.json.unread.conversations >= 1)) throw new Error(sync.text);
  const feed = await call(me, 'GET', '/v1/notifications');
  eq(feed.json.items.filter((i) => i.type === 'new_message').length, 0, 'messages in feed');
  const rows = sql(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_profile_id = '${creatorId}' AND type = 'new_message'`); eq(rows[0].n, 0, 'rows');
});
await test('device token registers and is removed', async () => {
  const tok = 'ab'.repeat(32);
  eq((await call(s, 'PUT', '/v1/me/devices', { token: tok, environment: 'sandbox', previews: false })).status, 200, 'put');
  eq(sql(`SELECT COUNT(*) AS n FROM device_tokens WHERE token = '${tok}'`)[0].n, 1, 'stored');
  eq((await call(s, 'DELETE', `/v1/me/devices/${tok}`)).status, 200, 'delete');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
