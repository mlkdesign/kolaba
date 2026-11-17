// FEATURE 131 local API checks — blocking hides a person both ways (profile, search, chats), unblocking restores.
//   cd api && npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX: --var MONETIZATION_ENABLED:true
//   node tests/feature131-local.mjs "$PWD"      (local D1 only — never against production)
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
  const uid = `usr_f131_${tag}_${stamp}`; const email = `f131.${tag}.${stamp}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const token = (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token;
  const profile = (await call({ token }, 'POST', '/v1/profiles', { type, displayName: `${type} ${tag}` })).json.id;
  return { token, profileId: profile };
}


const a = await person('a', 'creator');
const biz = await person('biz', 'business');
const b = await person('b', 'creator');
const conversation = (await call(a, 'POST', '/v1/conversations', { profileId: b.profileId })).json;
await call(a, 'POST', `/v1/conversations/${conversation.id}/messages`, { body: 'hello', clientId: `f131-${stamp}` });
const chatsOf = async (s) => (await call(s, 'GET', '/v1/conversations')).json.items.map((x) => x.id);

await test('before: both see each other and the chat', async () => {
  eq((await call(b, 'GET', `/v1/profiles/${a.profileId}`)).status, 200, 'b sees a');
  eq((await chatsOf(a)).includes(conversation.id), true, 'a has the chat');
  eq((await chatsOf(b)).includes(conversation.id), true, 'b has the chat');
});
await test('a blocks b: b gets "not found" for a, a sees a bare card of b', async () => {
  eq((await call(a, 'POST', '/v1/blocks', { profileId: b.profileId })).status, 200, 'blocked');
  eq((await call(b, 'GET', `/v1/profiles/${a.profileId}`)).status, 404, 'b: not found');
  const page = (await call(a, 'GET', `/v1/profiles/${b.profileId}`)).json;
  eq(page.blockedByMe, true, 'flag'); eq(page.avatarUrl, null, 'no photo'); eq(page.links, [], 'nothing else');
  eq((await call(b, 'GET', `/v1/profiles/${a.profileId}/media`)).json?.items ?? [], [], 'no media for b');
});
await test('the chat is hidden for both (kept)', async () => {
  eq((await chatsOf(a)).includes(conversation.id), false, 'a');
  eq((await chatsOf(b)).includes(conversation.id), false, 'b');
  eq(sql(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = '${conversation.id}'`)[0].n, 1, 'messages kept');
});
await test('search: b can\'t find a', async () => {
  const list = (await call(b, 'GET', `/v1/profiles?type=creator&q=${encodeURIComponent('creator a')}`)).json.items ?? [];
  eq(list.some((p) => p.id === a.profileId), false, 'hidden');
});
await test('unblocked: everything is back', async () => {
  eq((await call(a, 'DELETE', `/v1/blocks/${b.profileId}`)).status, 200, 'unblocked');
  eq((await call(b, 'GET', `/v1/profiles/${a.profileId}`)).status, 200, 'b sees a');
  eq((await call(a, 'GET', `/v1/profiles/${b.profileId}`)).json.blockedByMe ?? false, false, 'full card');
  eq((await chatsOf(a)).includes(conversation.id), true, 'chat back for a');
  eq((await chatsOf(b)).includes(conversation.id), true, 'chat back for b');
});

await test('FEATURE 132: a deleted review can be written again', async () => {
  const body = { recipientProfileId: biz.profileId, quality: 5, speed: 4, contact: 5, comment: 'Great brief, paid on time.' };
  const first = await call(a, 'POST', '/v1/reviews', body);
  eq(first.status < 300, true, first.text);
  const id = first.json.id;
  eq((await call(a, 'DELETE', `/v1/reviews/${id}`)).status, 200, 'deleted');
  const again = await call(a, 'POST', '/v1/reviews', { ...body, comment: 'Second take after the update.' });
  eq(again.status < 300, true, again.text);
  const list = (await call(null, 'GET', `/v1/reviews?profileId=${biz.profileId}`)).json.items;
  eq(list.length, 1, 'one review'); eq(list[0].comment, 'Second take after the update.', 'the new one');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
