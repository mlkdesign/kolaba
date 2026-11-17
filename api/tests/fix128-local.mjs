// FIX 128 local API checks — dynamic PRO application videos, job Cover + References, review media gated by PRO.
//   cd api && npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX: --var MONETIZATION_ENABLED:true
//   node tests/fix128-local.mjs "$PWD"      (local D1 only — never against production)
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
  const uid = `usr_f128_${tag}_${stamp}`; const email = `f128.${tag}.${stamp}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const token = (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token;
  const profile = (await call({ token }, 'POST', '/v1/profiles', { type, displayName: `${type} ${tag}` })).json.id;
  return { token, profileId: profile };
}
/** A portfolio video of `owner`, `ageMinutes` old. */
function video(owner, n, ageMinutes, extra = {}) {
  const id = `med_f128_${owner.profileId}_${n}`;
  const f = { status: 'ready', is_public: 1, review_status: 'approved', purpose: 'portfolio', ...extra };
  sql(`INSERT INTO media (id, owner_profile_id, kind, purpose, provider, url, status, is_public, review_status, duration, created_at)
       VALUES ('${id}', '${owner.profileId}', 'video', '${f.purpose}', 'external', 'https://example.com/${id}.mp4', '${f.status}', ${f.is_public},
               '${f.review_status}', 12, ${stamp - ageMinutes * 60_000})`);
  return id;
}


const business = await person('biz', 'business');
const pro = await person('pro', 'creator');
const few = await person('few', 'creator');
const none = await person('none', 'creator');
const free = await person('free', 'creator');
const grant = (p, tag) => sql(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at) VALUES ('sub_f128_${tag}_${stamp}', '${p.profileId}', 'creator_pro', 'active', 'test', ${stamp})`);
grant(pro, 'pro'); grant(few, 'few'); grant(none, 'none');
const published = Array.from({ length: 12 }, (_, i) => video(pro, i + 1, i + 10));
video(pro, 'private', 0, { is_public: 0 });
video(pro, 'rejected', 0, { review_status: 'rejected' });
const threeVideos = [1, 2, 3].map((n) => video(few, n, n));
video(free, 1, 1);
const job = (await call(business, 'POST', '/v1/jobs', { title: 'UGC for a villa', description: 'x', publish: true })).json?.id;
const ids = (r) => r.media.map((m) => m.id);
const listed = async (appId) => ((await call(business, 'GET', `/v1/jobs/${job}/applications`)).json.items).find((a) => a.id === appId);

console.log('Dynamic PRO Apply');
let proApp, fewApp, noneApp, freeApp;
await test('PRO with 12 videos shows the latest 10; private and rejected never', async () => {
  const r = await call(pro, 'POST', `/v1/jobs/${job}/apply`, { message: 'Hi!', mediaIds: [published[11]] });
  eq(r.status, 201, r.text); proApp = r.json.id;
  eq(ids(r.json), published.slice(0, 10), 'videos');
});
await test('PRO with 3 videos shows 3, with none shows 0', async () => {
  fewApp = (await call(few, 'POST', `/v1/jobs/${job}/apply`, { message: 'Hi!' })).json.id;
  noneApp = (await call(none, 'POST', `/v1/jobs/${job}/apply`, { message: 'Hi!' })).json.id;
  eq(ids(await listed(fewApp)), threeVideos, 'three'); eq(ids(await listed(noneApp)), [], 'none');
});
await test('FREE shows no videos', async () => {
  freeApp = (await call(free, 'POST', `/v1/jobs/${job}/apply`, { message: 'Hi!' })).json.id;
  eq(ids(await listed(freeApp)), [], 'free');
});
await test('a deleted video leaves the old application; the next one moves up', async () => {
  sql(`UPDATE media SET status = 'deleted' WHERE id IN ('${published[0]}', '${published[1]}', '${published[2]}')`);
  eq(ids(await listed(proApp)), published.slice(3, 12), 'nine left');
});
await test('a new video joins the old application', async () => {
  const fresh = video(pro, 'new', 0);
  eq(ids(await listed(proApp)), [fresh, ...published.slice(3, 12)], 'newest first');
});
await test('all videos deleted: 0, the message kept', async () => {
  sql(`UPDATE media SET status = 'deleted' WHERE owner_profile_id = '${few.profileId}'`);
  const a = await listed(fewApp); eq(ids(a), [], 'empty'); eq(a.message, 'Hi!', 'message');
});
await test('PRO lost hides every video; the application stays', async () => {
  sql(`UPDATE subscriptions SET status = 'cancelled' WHERE profile_id = '${pro.profileId}'`);
  const a = await listed(proApp); eq(ids(a), [], 'hidden'); eq(a.status, 'submitted', 'still submitted');
});
await test('PRO back shows the videos available now (deleted ones stay gone)', async () => {
  sql(`UPDATE subscriptions SET status = 'active' WHERE profile_id = '${pro.profileId}'`);
  eq((await listed(proApp)).media.length, 10, 'ten again');
  eq((await listed(proApp)).media.some((m) => m.id === published[0]), false, 'deleted not back');
});

console.log('Jobs: Cover + References');
const jobMedia = (n, kind = 'photo') => {
  const id = `med_f128_job_${n}_${stamp}`;
  sql(`INSERT INTO media (id, owner_profile_id, kind, purpose, provider, url, status, is_public, review_status, created_at)
       VALUES ('${id}', '${business.profileId}', '${kind}', 'job', 'external', 'https://example.com/${id}', 'ready', 1, 'approved', ${stamp})`);
  return id;
};
const cover = jobMedia('cover');
const refs = Array.from({ length: 10 }, (_, i) => jobMedia(`ref${i}`, i % 3 === 0 ? 'video' : 'photo'));
let job2;
await test('one Cover and 10 References, separate', async () => {
  const r = await call(business, 'POST', '/v1/jobs', { title: 'With media', description: 'x', publish: true, coverMediaId: cover, referenceMediaIds: refs });
  eq(r.status, 201, r.text); job2 = r.json.id;
  eq(r.json.cover?.id, cover, 'cover'); eq(r.json.references.map((m) => m.id), refs, 'references');
});
await test('11 References are refused; the Cover is not counted', async () => {
  const r = await call(business, 'PATCH', `/v1/jobs/${job2}`, { title: 'With media', description: 'x', referenceMediaIds: [...refs, jobMedia('extra')] });
  eq(r.status >= 400, true, `status ${r.status}`);
});
await test('a video can\'t be the Cover', async () => {
  const r = await call(business, 'PATCH', `/v1/jobs/${job2}`, { title: 'With media', description: 'x', coverMediaId: refs[0] });
  eq(r.json?.error?.code ?? r.json?.error ?? r.text.slice(0, 40), 'cover_must_be_photo', 'code');
});
await test('removing the Cover keeps the References; removing a Reference keeps the Cover', async () => {
  let r = await call(business, 'PATCH', `/v1/jobs/${job2}`, { title: 'With media', description: 'x', coverMediaId: null });
  eq(r.json.cover, null, 'no cover'); eq(r.json.references.length, 10, 'refs kept');
  r = await call(business, 'PATCH', `/v1/jobs/${job2}`, { title: 'With media', description: 'x', coverMediaId: cover, referenceMediaIds: refs.slice(1) });
  eq(r.json.cover?.id, cover, 'cover back'); eq(r.json.references.map((m) => m.id), refs.slice(1), 'one ref less');
});
await test('the legacy list: first photo is the Cover, the rest References', async () => {
  const r = await call(business, 'POST', '/v1/jobs', { title: 'Legacy', description: 'x', publish: true, mediaIds: [refs[0], cover, refs[1]] });
  eq(r.json.cover?.id, cover, 'cover'); eq(r.json.references.map((m) => m.id), [refs[0], refs[1]], 'refs');
});
await test('a job without media: no cover, no references', async () => {
  const r = await call(business, 'POST', '/v1/jobs', { title: 'Bare', description: 'x', publish: true });
  eq(r.json.cover, null, 'cover'); eq(r.json.references, [], 'refs'); eq(r.json.media, [], 'legacy list');
});

console.log('Reviews with media');
const reviewFile = (n) => {
  const id = `med_f128_rev_${n}_${stamp}`;
  sql(`INSERT INTO media (id, owner_profile_id, kind, purpose, provider, storage_key, status, is_public, review_status, created_at)
       VALUES ('${id}', '${business.profileId}', '${n % 2 ? 'video' : 'photo'}', 'chat', 'r2', 'u/${business.profileId}/review/${id}', 'ready', 0, 'approved', ${stamp})`);
  return id;
};
const files = [0, 1, 2].map(reviewFile);
let reviewId;
const reviewOf = async (p) => (await call(business, 'GET', `/v1/reviews?profileId=${p.profileId}`)).json.items.find((i) => i.id === reviewId);
await test('upload as purpose review: business only', async () => {
  const r = await call(pro, 'POST', '/v1/media/uploads', { purpose: 'review', kind: 'photo', mime: 'image/jpeg', bytes: 100 });
  eq([403, 503].includes(r.status), true, `status ${r.status}`);
});
await test('more than 10 media are refused', async () => {
  const r = await call(business, 'POST', '/v1/reviews', { recipientProfileId: pro.profileId, quality: 5, speed: 5, contact: 5, comment: 'Great',
    mediaIds: Array.from({ length: 11 }, (_, i) => `x${i}`) });
  eq(r.status >= 400, true, `status ${r.status}`);
});
await test('a review of a FREE creator can\'t carry media', async () => {
  const r = await call(business, 'POST', '/v1/reviews', { recipientProfileId: free.profileId, quality: 5, speed: 5, contact: 5, comment: 'Great', mediaIds: [files[0]] });
  eq(r.status, 403, r.text);
});
await test('business → PRO creator: 3 media, no contact needed; signed URLs only', async () => {
  const r = await call(business, 'POST', '/v1/reviews', { recipientProfileId: pro.profileId, quality: 5, speed: 4, contact: 5, comment: 'Great work', mediaIds: files });
  eq(r.status, 201, r.text); reviewId = r.json.id;
  const review = await reviewOf(pro);
  eq(review.media.map((m) => m.id), files, 'media'); eq(review.authorProfileId, business.profileId, 'author id');
  eq(review.media.every((m) => /[?&]sig=/.test(m.url) && !m.url.includes('u/')), true, 'signed, no storage path');
});
await test('PRO lost: text and rating stay, media hidden; PRO back: media again', async () => {
  sql(`UPDATE subscriptions SET status = 'cancelled' WHERE profile_id = '${pro.profileId}'`);
  let review = await reviewOf(pro); eq(review.media, [], 'hidden'); eq(review.comment, 'Great work', 'text'); eq(review.quality, 5, 'rating');
  eq(sql(`SELECT COUNT(*) AS n FROM review_media WHERE review_id = '${reviewId}'`)[0].n, 3, 'links kept');
  sql(`UPDATE subscriptions SET status = 'active' WHERE profile_id = '${pro.profileId}'`);
  review = await reviewOf(pro); eq(review.media.length, 3, 'back');
});
await test('the author can\'t delete a review directly', async () => {
  const r = await call(business, 'DELETE', `/v1/reviews/${reviewId}`);
  eq(r.status, 403, r.text);
});
await test('a portfolio video deleted never touches review media', async () => {
  sql(`UPDATE media SET status = 'deleted' WHERE owner_profile_id = '${pro.profileId}'`);
  eq((await reviewOf(pro)).media.length, 3, 'still 3');
});

console.log('Moderation removal');
const adminCall = async (token, method, path, body) => {
  const headers = { Origin: 'http://localhost:5174', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};
// A local admin session made for this run (local D1 only): the session id is the token's SHA-256.
const adminToken = `f128-admin-${stamp}`;
{
  const { createHash } = await import('node:crypto');
  const [adminRow] = sql(`SELECT id FROM admins WHERE must_change_password = 0 LIMIT 1`);
  if (adminRow) sql(`INSERT INTO admin_sessions (id, admin_id, created_at, expires_at, last_seen_at) VALUES
      ('${createHash('sha256').update(adminToken).digest('hex')}', '${adminRow.id}', ${Date.now()}, ${Date.now() + 3_600_000}, ${Date.now()})`);
}
await test('a review removed by moderation: out of the rating, links gone, unused files deleted', async () => {
  const shared = files[2];
  sql(`INSERT INTO collections (id, owner_profile_id, title, created_at) VALUES ('col_f128_${stamp}', '${business.profileId}', 'Keep', ${stamp})`);
  sql(`INSERT INTO collection_items (collection_id, media_id, position) VALUES ('col_f128_${stamp}', '${shared}', 0)`);
  const before = (await call(business, 'GET', `/v1/reviews?profileId=${pro.profileId}`)).json.summary.count;
  const rep = await call(few, 'POST', '/v1/reports', { targetType: 'review', targetId: reviewId, category: 'spam' });
  eq(rep.status < 300, true, rep.text);
  const reportId = rep.json.id ?? sql(`SELECT id FROM reports WHERE target_id = '${reviewId}' ORDER BY created_at DESC LIMIT 1`)[0].id;
  const r = await adminCall(adminToken, 'POST', `/v1/admin/reports/${reportId}/action`, { action: 'remove_content', reason: 'spam review', confirm: true });
  eq(r.status, 200, r.text);
  eq((await reviewOf(pro)) ?? null, null, 'not listed');
  eq((await call(business, 'GET', `/v1/reviews?profileId=${pro.profileId}`)).json.summary.count, before - 1, 'count');
  eq(sql(`SELECT COUNT(*) AS n FROM review_media WHERE review_id = '${reviewId}'`)[0].n, 0, 'links');
  eq(sql(`SELECT id, status FROM media WHERE id IN ('${files.join("','")}') ORDER BY id`).map((m) => m.status),
     files.map((f) => f === shared ? 'ready' : 'deleted'), 'files');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
