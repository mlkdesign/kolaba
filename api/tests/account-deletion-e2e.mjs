#!/usr/bin/env node
// Account deletion against a LOCAL database copy: creates a throw-away account directly in the local D1 (no e-mail
// needed), gives it a creator + a business profile, a photo, a message, a block and a feedback item, then checks
//  · deleting one business profile keeps the account and its other profiles,
//  · DELETE /v1/me needs the password again, removes everything, ends the sessions, removes the files.
//   PERSIST=<wrangler --persist-to dir> API=http://127.0.0.1:8790 node tests/account-deletion-e2e.mjs
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API ?? 'http://127.0.0.1:8790';
if (/workers\.dev|kolaba-api\./.test(API)) { console.error('Refusing to run against production.'); process.exit(2); }
const PERSIST = process.env.PERSIST ?? fail('PERSIST is required (the wrangler dev --persist-to directory)');
const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
function fail(m) { console.error(m); process.exit(2); }

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
async function hash(password, salt) {
  let material = new TextEncoder().encode(password.normalize('NFKC'));
  for (let i = 0; i < 6; i++) {
    const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
    material = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256));
  }
  return b64(material);
}
const sql = (command) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'kolaba-db', '--local', '--persist-to', PERSIST, '--json', '--command', command],
  { cwd: apiDir, encoding: 'utf8' });

const suffix = Math.random().toString(36).slice(2, 8);
const email = `delete-me-${suffix}@example.test`;
const password = `Delete-Me-${suffix}-123`;
const salt = crypto.getRandomValues(new Uint8Array(16));
const userId = `usr_e2edel${suffix}`;
const t = Date.now();
sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, created_at, updated_at)
     VALUES ('${userId}', '${email}', '${await hash(password, salt)}', '${b64(salt)}', 'pbkdf2-sha256:6x100000', ${t}, 'owner', ${t}, ${t})`);

let passed = 0; const failures = [];
const expect = (c, m) => { if (!c) throw new Error(m); };
async function test(name, fn) { try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); } }
async function call(token, method, path, body, profileId) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (profileId) headers['X-Profile-Id'] = profileId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}

const login = await call(null, 'POST', '/v1/auth/login', { email, password });
const token = login.json?.token;
let creatorId; let businessA; let businessB; let photoUrl;
await test('setup: creator + two business profiles, a photo, a feedback item', async () => {
  expect(token, `login ${login.status} ${login.text}`);
  creatorId = (await call(token, 'POST', '/v1/profiles', { type: 'creator', displayName: 'Delete Me', username: `del_${suffix}` })).json.id;
  businessA = (await call(token, 'POST', '/v1/profiles', { type: 'business', displayName: 'Del Biz A', username: `dela_${suffix}` })).json.id;
  businessB = (await call(token, 'POST', '/v1/profiles', { type: 'business', displayName: 'Del Biz B', username: `delb_${suffix}` })).json.id;
  expect(creatorId && businessA && businessB, 'profiles not created');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const up = await call(token, 'POST', '/v1/media/uploads', { purpose: 'portfolio', kind: 'photo', mime: 'image/png', bytes: png.length }, creatorId);
  const put = await fetch(up.json.uploadUrl, { method: 'PUT', body: png, headers: { Authorization: `Bearer ${token}`, 'X-Profile-Id': creatorId,
    'Content-Type': 'image/png', 'Content-Length': String(png.length) } });
  expect(put.status === 200, `upload ${put.status}`);
  photoUrl = `${API}/v1/media/${up.json.mediaId}/file`;
  expect((await fetch(photoUrl)).status === 200, 'photo not served before deletion');
  const form = new FormData(); form.set('category', 'general'); form.set('message', 'bye');
  const fb = await fetch(`${API}/v1/feedback`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` } });
  expect(fb.status === 201, `feedback ${fb.status}`);
});

await test('deleting one business profile keeps the account and the other profiles', async () => {
  const r = await call(token, 'DELETE', `/v1/profiles/${businessA}`);
  expect(r.status === 200, `delete profile ${r.status} ${r.text}`);
  const s = await call(token, 'GET', '/v1/auth/session');
  const ids = s.json.profiles.map((p) => p.id);
  expect(ids.includes(creatorId) && ids.includes(businessB) && !ids.includes(businessA), `profiles after: ${ids}`);
});

await test('account deletion needs the password again', async () => {
  const no = await call(token, 'DELETE', '/v1/me', { confirm: 'DELETE' });
  expect(no.status === 401 && no.json.error.code === 'password_required', `no password: ${no.text}`);
  const wrong = await call(token, 'DELETE', '/v1/me', { confirm: 'DELETE', password: 'wrong-password' });
  expect(wrong.status === 401, `wrong password: ${wrong.status}`);
});

await test('account deletion removes the account, profiles, files and sessions', async () => {
  const r = await call(token, 'DELETE', '/v1/me', { confirm: 'DELETE', password });
  expect(r.status === 200 && r.json.status === 'deleted' && r.json.profiles === 3, `delete: ${r.text}`);
  expect((await call(token, 'GET', '/v1/auth/session')).status === 401, 'session still valid');
  expect((await fetch(photoUrl)).status === 404, 'photo still served');
  const left = JSON.parse(sql(`SELECT (SELECT COUNT(*) FROM users WHERE id = '${userId}') u, (SELECT COUNT(*) FROM profiles WHERE owner_user_id = '${userId}') p,
      (SELECT COUNT(*) FROM feedback WHERE user_id = '${userId}') f, (SELECT COUNT(*) FROM sessions WHERE user_id = '${userId}') s`))[0].results[0];
  expect(left.u === 0 && left.p === 0 && left.f === 0 && left.s === 0, `left behind: ${JSON.stringify(left)}`);
  const again = await call(null, 'POST', '/v1/auth/login', { email, password });
  expect(again.status === 401, `login after deletion: ${again.status}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
