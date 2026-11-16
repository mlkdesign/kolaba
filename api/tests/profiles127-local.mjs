// FIX 127 local API checks — privacy on cards and pages, deleting one profile of an account.
//   cd api && npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX:
//   node tests/profiles127-local.mjs "$PWD"      (local D1 only — never against production)
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
  const uid = `usr_p127_${tag}_${Date.now()}`; const email = `p127.${tag}.${Date.now()}@example.com`;
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

console.log('Privacy');
await test('Show location off: no place on their page or cards for others, the owner keeps it', async () => {
  const set = await call(b.as(b.creator), 'PATCH', `/v1/profiles/${b.creator}`, { city: 'Lyon', country: 'France', countryCode: 'FR', settings: { showLocation: false } });
  eq(set.status, 200, set.text);
  const page = await call(a.as(a.creator), 'GET', `/v1/profiles/${b.creator}`);
  eq(page.json.location, null, 'page location'); eq(page.json.city, null, 'page city');
  const own = await call(b.as(b.creator), 'GET', `/v1/profiles/${b.creator}`);
  eq(own.json.city, 'Lyon', 'owner keeps it');
  const list = await call(null, 'GET', `/v1/profiles?type=creator&q=creator%20b`);
  const card = list.json.items.find((x) => x.id === b.creator);
  if (card) { eq(card.location, null, 'card location'); eq(card.flag, null, 'card flag'); }
});
await test('Who can message: the page says it', async () => {
  eq((await call(b.as(b.creator), 'PATCH', `/v1/profiles/${b.creator}`, { settings: { whoCanMessage: 'nobody' } })).status, 200, 'set');
  const page = await call(a.as(a.business), 'GET', `/v1/profiles/${b.creator}`);
  eq(page.json.messaging, 'nobody', 'messaging');
});

console.log('Delete one profile of an account');
await test('the business and everything it owns go; the account and its creator stay', async () => {
  // Some data of the business: a contact request, a review it wrote, a notification.
  await call(a.as(a.business), 'POST', '/v1/contacts/requests', { recipientProfileId: b.creator });
  eq((await call(a.as(a.business), 'POST', '/v1/reviews', { recipientProfileId: b.creator, quality: 5, speed: 5, contact: 5, comment: 'Great work.' })).status, 201, 'review');
  const r = await call({ token: a.token }, 'DELETE', `/v1/profiles/${a.business}`);
  eq(r.status, 200, r.text);
  const [p] = sql(`SELECT COUNT(*) AS n FROM profiles WHERE id = '${a.business}'`); eq(p.n, 0, 'profile row');
  const [rv] = sql(`SELECT COUNT(*) AS n FROM reviews WHERE author_profile_id = '${a.business}'`); eq(rv.n, 0, 'its reviews');
  const [cr] = sql(`SELECT COUNT(*) AS n FROM contact_requests WHERE sender_profile_id = '${a.business}' OR recipient_profile_id = '${a.business}'`); eq(cr.n, 0, 'its contacts');
  const [st] = sql(`SELECT COUNT(*) AS n FROM profile_settings WHERE profile_id = '${a.business}'`); eq(st.n, 0, 'its settings');
  const [c] = sql(`SELECT COUNT(*) AS n FROM profiles WHERE id = '${a.creator}'`); eq(c.n, 1, 'creator stays');
});
await test('the last profile cannot be deleted', async () => {
  const r = await call({ token: a.token }, 'DELETE', `/v1/profiles/${a.creator}`);
  eq(r.json?.error?.code, 'last_profile', r.text);
});
await test('someone else cannot delete it', async () => {
  const r = await call({ token: b.token }, 'DELETE', `/v1/profiles/${a.creator}`);
  eq(r.json?.error?.code, 'not_profile_owner', r.text);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
