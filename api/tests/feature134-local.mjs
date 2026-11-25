// FEATURE 134 local checks: collections (PRO visibility, safe delete) and video comments. Local D1 only.
//   cd api && npx wrangler d1 migrations apply kolaba-db --local --env local
//   npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX: --var MONETIZATION_ENABLED:true
//   node tests/limits-local.mjs "$PWD"
// Creator Free / PRO portfolio videos (count, 30 s measured from the file, parallel uploads, PRO ending), Business Free /
// PRO job posts (account-wide monthly allowance, other profiles, deletion, editing, re-opening, parallel publishing,
// next month), the structured refusal and the server configuration.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API_DIR = process.argv[2];
const API = 'http://127.0.0.1:8799';
const ORIGIN = 'http://localhost:5173';
const creds = JSON.parse(readFileSync(`${API_DIR}/seed/.demo-credentials.json`, 'utf8'));
let passed = 0; const failures = [];
const sql = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'kolaba-db', '--local', '--env', 'local', '--json', '--command', q],
  { cwd: API_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;

async function call(s, method, path, body, raw) {
  const headers = { Origin: ORIGIN };
  if (s?.token) headers.Authorization = `Bearer ${s.token}`;
  if (s?.profileId) headers['X-Profile-Id'] = s.profileId;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (raw) Object.assign(headers, raw);
  const send = () => fetch(API + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
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
async function account(tag) {
  const uid = `usr_f134_${tag}_${stamp}`; const email = `f134.${tag}.${stamp}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const token = (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token;
  const creator = (await call({ token }, 'POST', '/v1/profiles', { type: 'creator', displayName: `Creator ${tag}` })).json.id;
  const business = (await call({ token }, 'POST', '/v1/profiles', { type: 'business', displayName: `Business ${tag}` })).json.id;
  const addBusiness = async (n) => (await call({ token }, 'POST', '/v1/profiles', { type: 'business', displayName: `Business ${tag} ${n}` })).json.id;
  return { uid, token, creator, business, addBusiness, as: (profileId) => ({ token, profileId }) };
}
const grant = (profileId, plan) => sql(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at)
    VALUES ('sub_f134_${profileId}_${plan}', '${profileId}', '${plan}', 'active', 'test', ${Date.now()})`);
const expire = (profileId) => sql(`UPDATE subscriptions SET status = 'expired', expires_at = ${Date.now() - 1000} WHERE profile_id = '${profileId}'`);


const video = (profileId, tag, extra = '') => {
  const id = `med_f134_${tag}_${stamp}`;
  sql(`INSERT INTO media (id, owner_profile_id, kind, purpose, provider, mime, status, is_public, review_status, created_at${extra ? ', ' + extra.split('=')[0] : ''})
       VALUES ('${id}', '${profileId}', 'video', '${tag.startsWith('col') ? 'collection' : 'portfolio'}', 'r2', 'video/mp4', 'ready', 1, 'approved', ${Date.now()}${extra ? ', ' + extra.split('=')[1] : ''})`);
  return id;
};

const a = await account('a');   // the creator
const b = await account('b');   // a visitor
const as = a.as(a.creator); const bs = b.as(b.creator);
const v1 = video(a.creator, 'v1'); const v2 = video(a.creator, 'v2'); const c1 = video(a.creator, 'col1');

console.log('Collections');
let col;
await test('FREE: no new collection', async () => {
  const r = await call(as, 'POST', '/v1/media/collections', { title: 'X' }); eq(r.json?.error?.code, 'pro_required', r.text);
});
await test('PRO: create with title up to 100 and description up to 1000, add photos/videos', async () => {
  grant(a.creator, 'creator_pro');
  eq((await call(as, 'POST', '/v1/media/collections', { title: 'x'.repeat(101) })).status, 400, '101');
  const r = await call(as, 'POST', '/v1/media/collections', { title: 'UGC for Rixos', description: 'd'.repeat(1000) }); eq(r.status, 201, r.text);
  col = r.json.id;
  eq((await call(as, 'PUT', `/v1/media/collections/${col}/items`, { mediaIds: [v1, c1, v2] })).status, 200, 'items');
  eq((await call(as, 'PATCH', `/v1/media/collections/${col}`, { coverMediaId: v2 })).status, 200, 'cover');
});
await test('visitors see a PRO creator\'s collection, page by page', async () => {
  const list = await call(bs, 'GET', `/v1/profiles/${a.creator}/collections`); eq(list.json.items.length, 1, 'list');
  eq(list.json.items[0].itemsCount, 3, 'count');
  const p1 = await call(bs, 'GET', `/v1/media/collections/${col}/items?limit=2`); eq(p1.json.items.length, 2, 'page'); eq(p1.json.nextOffset, 2, 'next');
  const p2 = await call(bs, 'GET', `/v1/media/collections/${col}/items?limit=2&offset=2`); eq(p2.json.items.length, 1, 'page 2');
});
await test('PRO lost: hidden for visitors, kept for the owner; owner may edit, remove, not add', async () => {
  expire(a.creator);
  const list = await call(bs, 'GET', `/v1/profiles/${a.creator}/collections`); eq(list.json.items.length, 0, 'hidden list');
  eq((await call(bs, 'GET', `/v1/media/collections/${col}/items`)).status, 404, 'hidden items');
  const own = await call(as, 'GET', `/v1/profiles/${a.creator}/collections`); eq(own.json.items.length, 1, 'owner'); eq(own.json.canEdit, false, 'canEdit');
  eq((await call(as, 'PATCH', `/v1/media/collections/${col}`, { title: 'Renamed' })).status, 200, 'rename');
  const v3 = video(a.creator, 'v3');
  eq((await call(as, 'PUT', `/v1/media/collections/${col}/items`, { mediaIds: [v1, v2, v3] })).json?.error?.code, 'pro_required', 'add');
  eq((await call(as, 'PUT', `/v1/media/collections/${col}/items`, { mediaIds: [v2, v1] })).status, 200, 'remove + reorder');
  eq(sql(`SELECT status FROM media WHERE id = '${c1}'`)[0].status, 'deleted', 'collection-only file gone');
  eq(sql(`SELECT status FROM media WHERE id = '${v1}'`)[0].status, 'ready', 'portfolio video kept');
});
await test('PRO back: visible again without republishing', async () => {
  sql(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at)
       VALUES ('sub_f134_again_${stamp}', '${a.creator}', 'creator_pro', 'active', 'test', ${Date.now()})`);
  eq((await call(bs, 'GET', `/v1/profiles/${a.creator}/collections`)).json.items.length, 1, 'visible');
});
await test('delete: only the collection; shared media stay; twice is fine', async () => {
  eq((await call(as, 'DELETE', `/v1/media/collections/${col}`)).status, 200, 'delete');
  eq((await call(as, 'DELETE', `/v1/media/collections/${col}`)).status, 200, 'again');
  eq(sql(`SELECT status FROM media WHERE id = '${v2}'`)[0].status, 'ready', 'kept');
});

console.log('Comments');
let first, reply;
await test('a comment on a video; empty / too long refused; the owner is notified', async () => {
  eq((await call(bs, 'POST', `/v1/comments/media/${v1}`, { text: '   ' })).json?.error?.code, 'comment_empty', 'empty');
  eq((await call(bs, 'POST', `/v1/comments/media/${v1}`, { text: 'x'.repeat(1001) })).json?.error?.code, 'comment_too_long', 'long');
  const r = await call(bs, 'POST', `/v1/comments/media/${v1}`, { text: 'Love this villa shot 🌴', clientKey: 'k1' }); eq(r.status, 201, r.text);
  first = r.json.comment.id;
  const again = await call(bs, 'POST', `/v1/comments/media/${v1}`, { text: 'Love this villa shot 🌴', clientKey: 'k1' });
  eq(again.json.comment.id, first, 'same request, same comment');
  const n = sql(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_profile_id = '${a.creator}' AND type = 'new_comment'`)[0].n; eq(n, 1, 'notified once');
});
await test('the same thread from anywhere; count right', async () => {
  const r = await call(as, 'GET', `/v1/comments/media/${v1}`); eq(r.json.count, 1, 'count'); eq(r.json.items[0].text, 'Love this villa shot 🌴', 'text');
});
await test('a reply (and a reply to a reply) stays in one thread; the answered author is notified', async () => {
  const r = await call(as, 'POST', `/v1/comments/media/${v1}`, { text: 'Thank you!', parentId: first }); eq(r.status, 201, r.text); reply = r.json.comment.id;
  const r2 = await call(bs, 'POST', `/v1/comments/media/${v1}`, { text: 'Anytime', parentId: reply }); eq(r2.json.comment.parentId, first, 'flat');
  eq(sql(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_profile_id = '${b.creator}' AND type = 'comment_reply'`)[0].n, 1, 'reply notified');
  const list = await call(bs, 'GET', `/v1/comments/media/${v1}`); eq(list.json.items[0].repliesCount, 2, 'replies'); eq(list.json.count, 3, 'count');
  eq(list.json.items[0].replies.map((x) => x.text), ['Thank you!', 'Anytime'], 'oldest first');
});
await test('like / unlike, idempotent', async () => {
  eq((await call(as, 'PUT', `/v1/comments/${first}/like`)).json.likesCount, 1, 'like');
  eq((await call(as, 'PUT', `/v1/comments/${first}/like`)).json.likesCount, 1, 'again');
  eq((await call(as, 'DELETE', `/v1/comments/${first}/like`)).json.likesCount, 0, 'unlike');
});
await test('report a comment', async () => {
  const r = await call(as, 'POST', '/v1/reports', { targetType: 'comment', targetId: first, category: 'spam' }); eq(r.status, 201, r.text);
});
await test('delete own: with replies it stays as deleted; someone else can\'t', async () => {
  eq((await call(as, 'DELETE', `/v1/comments/${first}`)).status, 403, 'not author');
  eq((await call(bs, 'DELETE', `/v1/comments/${first}`)).status, 200, 'delete');
  const list = await call(bs, 'GET', `/v1/comments/media/${v1}`);
  eq([list.json.items[0].status, list.json.items[0].text], ['deleted', ''], 'placeholder'); eq(list.json.count, 2, 'count');
});
await test('blocked: no comments either way', async () => {
  eq((await call(as, 'POST', '/v1/blocks', { profileId: b.creator })).status < 300, true, 'block');
  const r = await call(bs, 'POST', `/v1/comments/media/${v1}`, { text: 'hi' }); eq(r.status, 404, r.text);
  const list = await call(as, 'GET', `/v1/comments/media/${v1}`);
  eq(list.json.items.flatMap((x) => [x, ...x.replies]).some((x) => x.author?.id === b.creator), false, 'their comments hidden');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
