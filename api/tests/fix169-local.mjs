// FIX 169 local API checks — Login & Password (e-mail change with two codes, password change keeping this session),
// public e-mail per profile, Push & Alerts device settings. Local D1 only — never against production.
//   npx wrangler dev --env local --port 8799 --var RESEND_API_KEY:x --var TEST_CODE_INBOX:
//   node tests/fix169-local.mjs "$PWD"
// (RESEND_API_KEY "x": sending fails with 503 after the code is stored — the test writes its own code hash.)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API_DIR = process.argv[2];
const API = 'http://127.0.0.1:8799';
const creds = JSON.parse(readFileSync(`${API_DIR}/seed/.demo-credentials.json`, 'utf8'));
const sha = (t) => createHash('sha256').update(t).digest('hex');
let passed = 0; const failures = [];
const sql = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'kolaba-db', '--local', '--env', 'local', '--json', '--command', q],
  { cwd: API_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;
async function call(s, method, path, body) {
  const headers = { Origin: 'http://localhost:5173' };
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
const stamp = Date.now();
const uid = `usr_t169_${stamp}`; const email = `t169.${stamp}@example.com`;
sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
     VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
const password = creds[demo].password;
const login = async (e = email, pw = password) => call(null, 'POST', '/v1/auth/login', { email: e, password: pw });
const s = { token: (await login()).json.token };
const other = { token: (await login()).json.token };

console.log('Public e-mail per profile');
let creator, business;
await test('a new profile starts with the sign-in e-mail as its public e-mail', async () => {
  const a = await call(s, 'POST', '/v1/profiles', { type: 'creator', displayName: 'Me' }); eq(a.status, 201, a.text); creator = a.json.id;
  const b = await call(s, 'POST', '/v1/profiles', { type: 'business', displayName: 'Biz' }); eq(b.status, 201, b.text); business = b.json.id;
  const rows = sql(`SELECT profile_id, url FROM profile_links WHERE kind = 'email' AND profile_id IN ('${creator}', '${business}')`);
  eq(rows.length, 2, 'rows'); rows.forEach((r) => eq(r.url, `mailto:${email}`, 'url'));
});
await test('each profile edits its own public e-mail; an invalid one is refused', async () => {
  eq((await call(s, 'PATCH', `/v1/profiles/${business}`, { links: { email: 'hello@brand.com' } })).status, 200, 'patch');
  const bad = await call(s, 'PATCH', `/v1/profiles/${creator}`, { links: { email: 'not-an-email' } }); eq(bad.json?.error?.code, 'invalid_email', bad.text);
  const [b] = sql(`SELECT url FROM profile_links WHERE kind = 'email' AND profile_id = '${business}'`); eq(b.url, 'mailto:hello@brand.com', 'biz');
  const [c] = sql(`SELECT url FROM profile_links WHERE kind = 'email' AND profile_id = '${creator}'`); eq(c.url, `mailto:${email}`, 'creator untouched');
});
await test("another account can't edit this profile's links", async () => {
  const [o] = Object.keys(creds).slice(2, 3);
  const t = (await login(o, creds[o].password)).json.token;
  const r = await call({ token: t }, 'PATCH', `/v1/profiles/${business}`, { links: { email: 'evil@x.com' } }); eq(r.status, 403, r.text);
});

console.log('External links (FIX 170)');
await test('up to five named links, kept in order, a sixth refused, owner only', async () => {
  const five = [1, 2, 3, 4, 5].map((i) => ({ title: `Site ${i}`, url: `example${i}.com` }));
  eq((await call(s, 'PATCH', `/v1/profiles/${creator}`, { externalLinks: five })).status, 200, 'five');
  const page = await call(s, 'GET', `/v1/profiles/${creator}`);
  eq(page.json.externalLinks.length, 5, 'count'); eq(page.json.externalLinks[0].url, 'https://example1.com/', 'url');
  eq(page.json.externalLinks[4].title, 'Site 5', 'order');
  const six = await call(s, 'PATCH', `/v1/profiles/${creator}`, { externalLinks: [...five, { title: 'Six', url: 'six.com' }] });
  eq(six.status, 400, six.text);
  const bad = await call(s, 'PATCH', `/v1/profiles/${creator}`, { externalLinks: [{ title: 'Mail', url: 'mailto:a@b.com' }] });
  eq(bad.json?.error?.code, 'invalid_link', bad.text);
  eq((await call(s, 'GET', `/v1/profiles/${business}`)).json.externalLinks.length, 0, 'business untouched');
  eq((await call(s, 'PATCH', `/v1/profiles/${creator}`, { links: { email: 'x@y.com' } })).status, 200, 'links only');
  eq((await call(s, 'GET', `/v1/profiles/${creator}`)).json.externalLinks.length, 5, 'kept when not sent');
  eq((await call(s, 'PATCH', `/v1/profiles/${creator}`, { externalLinks: [] })).status, 200, 'clear');
  eq((await call(s, 'GET', `/v1/profiles/${creator}`)).json.externalLinks.length, 0, 'cleared');
});

console.log('Portfolio without plan limits (FIX 171)');
await test('a free creator goes past the old 9; the 91st video is refused at the system ceiling', async () => {
  const cs = { ...s, profileId: creator };
  const rows = Array.from({ length: 89 }, (_, i) => `('med_t171_${stamp}_${i}', '${creator}', 'video', 'portfolio', 'r2', 'video/mp4', 'ready', 'approved', ${stamp + i})`);
  sql(`INSERT INTO media (id, owner_profile_id, kind, purpose, provider, mime, status, review_status, created_at) VALUES ${rows.join(', ')}`);
  const body = { purpose: 'portfolio', kind: 'video', mime: 'video/mp4', bytes: 1000, duration: 10 };
  const ent = await call(cs, 'GET', '/v1/me/entitlements');
  eq(ent.json?.planLimits?.creator?.free?.portfolio_video_limit ?? null, null, 'no plan limit shown');
  eq((await call(cs, 'POST', '/v1/media/uploads', body)).status, 201, 'the 90th');
  const r = await call(cs, 'POST', '/v1/media/uploads', body);
  eq(r.json?.error?.code, 'FEATURE_LIMIT_REACHED', r.text);
});

console.log('Login e-mail change');
const newEmail = `t169.new.${stamp}@example.com`;
const setCode = (code) => { const [r] = sql(`SELECT id FROM email_change_requests WHERE user_id = '${uid}' AND consumed_at IS NULL`);
  sql(`UPDATE email_change_requests SET code_hash = '${sha(`${uid}:${r.id}:${code}`)}' WHERE id = '${r.id}'`); };
await test('taken and same addresses are refused', async () => {
  eq((await call(s, 'POST', '/v1/auth/email/change', { email: demo })).json?.error?.code, 'email_taken', 'taken');
  eq((await call(s, 'POST', '/v1/auth/email/change', { email })).json?.error?.code, 'email_same', 'same');
});
await test('step 1 stores a request; the account e-mail is unchanged', async () => {
  const r = await call(s, 'POST', '/v1/auth/email/change', { email: newEmail });
  if (![200, 503].includes(r.status)) throw new Error(r.text);
  const [u] = sql(`SELECT email FROM users WHERE id = '${uid}'`); eq(u.email, email, 'email');
  const [q] = sql(`SELECT step, new_email FROM email_change_requests WHERE user_id = '${uid}' AND consumed_at IS NULL`); eq(q.step, 'current', 'step');
});
await test('resend before 30 s is refused', async () => {
  const r = await call(s, 'POST', '/v1/auth/email/change/resend'); eq(r.json?.error?.code, 'resend_too_soon', r.text);
});
await test('a wrong code counts, five end the step', async () => {
  setCode('111111');
  eq((await call(s, 'POST', '/v1/auth/email/change/verify', { code: '000000' })).json?.error?.code, 'code_invalid', 'wrong');
  sql(`UPDATE email_change_requests SET attempts = 5 WHERE user_id = '${uid}' AND consumed_at IS NULL`);
  eq((await call(s, 'POST', '/v1/auth/email/change/verify', { code: '111111' })).json?.error?.code, 'code_expired', 'dead');
  sql(`UPDATE email_change_requests SET attempts = 0 WHERE user_id = '${uid}' AND consumed_at IS NULL`);
});
await test('current code → code to the new address; new code → e-mail changed, session kept, public e-mails kept', async () => {
  setCode('222222');
  const a = await call(s, 'POST', '/v1/auth/email/change/verify', { code: '222222' });
  if (!(a.json?.step === 'new' || a.json?.error?.code === 'email_failed')) throw new Error(a.text);
  const [q] = sql(`SELECT step FROM email_change_requests WHERE user_id = '${uid}' AND consumed_at IS NULL`); eq(q.step, 'new', 'step');
  setCode('333333');
  const b = await call(s, 'POST', '/v1/auth/email/change/verify', { code: '333333' });
  if (!(b.json?.status === 'email_changed' || b.status === 200)) throw new Error(b.text);
  const [u] = sql(`SELECT email FROM users WHERE id = '${uid}'`); eq(u.email, newEmail, 'email');
  eq((await call(s, 'GET', '/v1/auth/session')).status, 200, 'session kept');
  const [c] = sql(`SELECT url FROM profile_links WHERE kind = 'email' AND profile_id = '${creator}'`); eq(c.url, 'mailto:x@y.com', 'public kept');
  eq((await login(newEmail)).status, 200, 'login with new e-mail');
});

console.log('Password change');
await test('code → reset token → new password; this session stays, other devices are signed out', async () => {
  const r = await call(s, 'POST', '/v1/auth/password/code');
  if (![200, 503].includes(r.status)) throw new Error(r.text);
  const code = '444444';
  sql(`UPDATE email_codes SET code_hash = '${sha(`${uid}:${code}`)}' WHERE user_id = '${uid}' AND purpose = 'reset' AND consumed_at IS NULL`);
  eq((await call(s, 'POST', '/v1/auth/password/code/verify', { code: '999999' })).json?.error?.code, 'code_invalid', 'wrong');
  const v = await call(s, 'POST', '/v1/auth/password/code/verify', { code }); eq(v.status, 200, v.text);
  const weak = await call(s, 'POST', '/v1/auth/password/change', { resetToken: v.json.resetToken, password: 'short' });
  eq(weak.status, 422, weak.text);
  const ok = await call(s, 'POST', '/v1/auth/password/change', { resetToken: v.json.resetToken, password: 'NewPassw0rd!169' });
  eq(ok.status, 200, ok.text);
  eq((await call(s, 'GET', '/v1/auth/session')).status, 200, 'this session');
  eq((await call(other, 'GET', '/v1/auth/session')).status, 401, 'other session');
  eq((await login(newEmail, 'NewPassw0rd!169')).status, 200, 'login with new password');
  const again = await call(s, 'POST', '/v1/auth/password/change', { resetToken: v.json.resetToken, password: 'Another0ne!169' });
  eq(again.json?.error?.code, 'reset_token_expired', 'token reuse');
});
await test('an account without a password gets no_password', async () => {
  const gid = `usr_t169g_${stamp}`;
  sql(`INSERT INTO users (id, email, email_verified_at, is_demo, created_at, updated_at) VALUES ('${gid}', 'g169.${stamp}@example.com', ${stamp}, 0, ${stamp}, ${stamp})`);
  const tok = 'tok169' + stamp + 'abcdefghij';
  sql(`INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES ('${sha(tok)}', '${gid}', ${stamp}, ${stamp + 86400000}, ${stamp})`);
  const r = await call({ token: tok }, 'POST', '/v1/auth/password/code'); eq(r.json?.error?.code, 'no_password', r.text);
});

console.log('Push & Alerts');
await test('device settings are stored, kept when not sent, active profile must be own', async () => {
  const token = 'ab'.repeat(32);
  eq((await call(s, 'PUT', '/v1/me/devices', { token, environment: 'sandbox', sounds: false, otherProfiles: false, activeProfileId: creator })).status, 200, 'put');
  let [d] = sql(`SELECT sounds, other_profiles, active_profile_id FROM device_tokens WHERE token = '${token}'`);
  eq(d.sounds, 0, 'sounds'); eq(d.other_profiles, 0, 'other'); eq(d.active_profile_id, creator, 'active');
  eq((await call(s, 'PUT', '/v1/me/devices', { token, environment: 'sandbox' })).status, 200, 'put plain');
  [d] = sql(`SELECT sounds, other_profiles, active_profile_id FROM device_tokens WHERE token = '${token}'`);
  eq(d.sounds, 0, 'sounds kept'); eq(d.active_profile_id, creator, 'active kept');
  eq((await call(s, 'PUT', '/v1/me/devices', { token, activeProfileId: 'cr_not_mine' })).status, 200, 'foreign');
  [d] = sql(`SELECT active_profile_id FROM device_tokens WHERE token = '${token}'`); eq(d.active_profile_id, null, 'foreign dropped');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
