// Entitlements & Usage Limits (src/lib/entitlements.ts) against the local Worker — local only.
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
  const uid = `usr_lim_${tag}_${stamp}`; const email = `lim.${tag}.${stamp}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const token = (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token;
  const creator = (await call({ token }, 'POST', '/v1/profiles', { type: 'creator', displayName: `Creator ${tag}` })).json.id;
  const business = (await call({ token }, 'POST', '/v1/profiles', { type: 'business', displayName: `Business ${tag}` })).json.id;
  const addBusiness = async (n) => (await call({ token }, 'POST', '/v1/profiles', { type: 'business', displayName: `Business ${tag} ${n}` })).json.id;
  return { uid, token, creator, business, addBusiness, as: (profileId) => ({ token, profileId }) };
}
const grant = (profileId, plan) => sql(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at)
    VALUES ('sub_lim_${profileId}_${plan}', '${profileId}', '${plan}', 'active', 'test', ${Date.now()})`);
const expire = (profileId) => sql(`UPDATE subscriptions SET status = 'expired', expires_at = ${Date.now() - 1000} WHERE profile_id = '${profileId}'`);

// A minimal MP4 whose movie header says `seconds` (ftyp, mdat, then moov — the header at the end, as cameras write it).
function mp4(seconds) {
  const box = (type, body) => { const b = Buffer.alloc(8 + body.length); b.writeUInt32BE(8 + body.length); b.write(type, 4, 'ascii'); body.copy(b, 8); return b; };
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isommp41', 'binary'));
  const mdat = box('mdat', Buffer.alloc(256, 7));
  const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(Math.round(seconds * 1000), 16);
  return Buffer.concat([ftyp, mdat, box('moov', box('mvhd', mvhd))]);
}
async function upload(s, { declared = 10, actual = declared } = {}) {
  const file = mp4(actual);
  const auth = await call(s, 'POST', '/v1/media/uploads', { purpose: 'portfolio', kind: 'video', mime: 'video/mp4', bytes: file.length, duration: declared });
  if (auth.status !== 201) return auth;
  const put = await call(s, 'PUT', `/v1/media/uploads/${auth.json.mediaId}`, file, { 'Content-Type': 'video/mp4' });
  return { ...put, mediaId: auth.json.mediaId };
}
const entitlements = async (s) => (await call(s, 'GET', '/v1/me/entitlements')).json;
const job = (title) => ({ title, description: 'Limits test', publish: true });

// ───────────────────────── Creator ─────────────────────────
const c = await account('c');
const cs = c.as(c.creator);
console.log('Creator Free');
await test('0 videos: limit 9 from the server, nothing used, 30 s per video', async () => {
  const e = await entitlements(cs);
  const v = e.features.portfolio_videos;
  eq([v.limit, v.used, v.remaining, v.unlimited, v.allowed, v.scope, v.plan], [9, 0, 9, false, true, 'profile', 'free'], 'usage');
  eq(e.features.video_duration.maxSeconds, 30, 'duration');
  eq(e.features.collections.access, 'locked', 'collections');
  eq([e.planLimits.creator.free.portfolio_video_limit, e.planLimits.creator.pro.portfolio_video_limit,
      e.planLimits.business.free.job_posts_per_month], [9, null, 2], 'plan limits for the app\'s texts');
});
await test('a video declared longer than 30 s is refused before upload', async () => {
  const r = await upload(cs, { declared: 31 });
  eq([r.status, r.json?.error?.code], [422, 'video_too_long'], r.text);
});
await test('without a declared duration the file decides: a 40 s file is refused on arrival', async () => {
  const file = mp4(40);
  const auth = await call(cs, 'POST', '/v1/media/uploads', { purpose: 'portfolio', kind: 'video', mime: 'video/mp4', bytes: file.length });
  eq(auth.status, 201, auth.text);
  const put = await call(cs, 'PUT', `/v1/media/uploads/${auth.json.mediaId}`, file, { 'Content-Type': 'video/mp4' });
  eq([put.status, put.json?.error?.code], [422, 'video_too_long'], put.text);
});
await test('a file that is really 45 s (declared 10 s) is refused on arrival and not counted', async () => {
  const r = await upload(cs, { declared: 10, actual: 45 });
  eq([r.status, r.json?.error?.code], [422, 'video_too_long'], r.text);
  eq((await entitlements(cs)).features.portfolio_videos.used, 0, 'used');
});
await test('1 video: counted, its length measured from the file', async () => {
  const r = await upload(cs, { declared: 12, actual: 12.4 });
  eq(r.status, 200, r.text);
  eq(r.json.duration, 12.4, 'duration');
  eq((await entitlements(cs)).features.portfolio_videos.used, 1, 'used');
});
await test('two parallel uploads at 8 of 9: only one gets the last place', async () => {
  for (let i = 0; i < 7; i++) eq((await upload(cs)).status, 200, `upload ${i}`);
  const results = await Promise.all([0, 1, 2].map(() => call(cs, 'POST', '/v1/media/uploads',
    { purpose: 'portfolio', kind: 'video', mime: 'video/mp4', bytes: mp4(10).length, duration: 10 })));
  eq(results.filter((r) => r.status === 201).length, 1, 'authorised');
  const refused = results.find((r) => r.status !== 201);
  eq(refused.json.error.code, 'FEATURE_LIMIT_REACHED', refused.text);
  const ok = results.find((r) => r.status === 201);
  eq((await call(cs, 'PUT', `/v1/media/uploads/${ok.json.mediaId}`, mp4(10), { 'Content-Type': 'video/mp4' })).status, 200, 'put');
});
let ninth;
await test('9 videos: limit reached; the 10th is refused with a structured error', async () => {
  const v = (await entitlements(cs)).features.portfolio_videos;
  eq([v.used, v.remaining, v.allowed, v.reason], [9, 0, false, 'limit_reached'], 'usage');
  const r = await upload(cs);
  eq(r.status, 403, r.text);
  const e = r.json.error;
  eq([e.code, e.feature, e.limit, e.used, e.remaining], ['FEATURE_LIMIT_REACHED', 'portfolio_videos', 9, 9, 0], 'error');
  ninth = sql(`SELECT id FROM media WHERE owner_profile_id = '${c.creator}' AND purpose = 'portfolio' AND status = 'ready' LIMIT 1`)[0].id;
});
await test('deleting one video makes room again', async () => {
  eq((await call(cs, 'DELETE', `/v1/media/${ninth}`)).status, 200, 'delete');
  eq((await entitlements(cs)).features.portfolio_videos.remaining, 1, 'remaining');
  eq((await upload(cs)).status, 200, 'upload');
});

console.log('Creator PRO');
await test('PRO: more than 9 videos; still 30 s per video', async () => {
  grant(c.creator, 'creator_pro');
  const v = (await entitlements(cs)).features.portfolio_videos;
  eq([v.unlimited, v.limit, v.plan], [true, null, 'pro'], 'usage');
  eq((await upload(cs)).status, 200, '10th');
  eq((await upload(cs)).status, 200, '11th');
  eq((await upload(cs, { declared: 31 })).json?.error?.code, 'video_too_long', '31 s');
  eq((await entitlements(cs)).features.collections.access, 'available', 'collections');
});
await test('PRO ended: the 11 videos stay, new uploads follow the Free limit', async () => {
  expire(c.creator);
  eq(sql(`SELECT COUNT(*) AS n FROM media WHERE owner_profile_id = '${c.creator}' AND purpose = 'portfolio' AND status = 'ready'`)[0].n, 11, 'kept');
  const r = await upload(cs);
  eq(r.json?.error?.code, 'FEATURE_LIMIT_REACHED', r.text);
  eq((await entitlements(cs)).features.portfolio_videos.used, 11, 'used');
});
await test('creator.pro does not give business.pro', async () => {
  const x = await account('x');
  grant(x.creator, 'creator_pro');
  const j = (await entitlements(x.as(x.business))).features.job_posts;
  eq([j.limit, j.plan], [2, 'free'], 'job posts');
});

// ───────────────────────── Business ─────────────────────────
const b = await account('b');
const bA = b.as(b.business);
const bB = b.as(await b.addBusiness(2));
console.log('Business Free');
let firstJob;
await test('0 posts: 2 per calendar month (UTC), account scope, period from the server', async () => {
  const j = (await entitlements(bA)).features.job_posts;
  const d = new Date();
  eq([j.limit, j.used, j.remaining, j.scope, j.period, j.allowed], [2, 0, 2, 'account', 'calendar_month', true], 'usage');
  eq([j.periodStart, j.periodEnd], [Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)], 'period');
});
await test('a draft spends nothing', async () => {
  const r = await call(bA, 'POST', '/v1/jobs', { title: 'Draft', publish: false });
  eq(r.status, 201, r.text);
  eq((await entitlements(bA)).features.job_posts.used, 0, 'used');
});
await test('first publication (Business A) succeeds', async () => {
  const r = await call(bA, 'POST', '/v1/jobs', job('A1'));
  eq(r.status, 201, r.text); firstJob = r.json.id;
  eq((await entitlements(bA)).features.job_posts.used, 1, 'used');
});
await test('editing a published job spends nothing', async () => {
  eq((await call(bA, 'PATCH', `/v1/jobs/${firstJob}`, { title: 'A1 edited' })).status, 200, 'patch');
  eq((await entitlements(bA)).features.job_posts.used, 1, 'used');
});
await test('second publication from another business profile (B) succeeds; the count is shared', async () => {
  eq((await call(bB, 'POST', '/v1/jobs', job('B1'))).status, 201, 'B1');
  eq((await entitlements(bA)).features.job_posts.used, 2, 'seen from A');
});
await test('third publication is refused — also from a business profile made just now', async () => {
  const r = await call(bA, 'POST', '/v1/jobs', job('A2'));
  eq(r.status, 403, r.text);
  eq([r.json.error.code, r.json.error.feature, r.json.error.limit, r.json.error.used, r.json.error.remaining],
     ['FEATURE_LIMIT_REACHED', 'job_posts', 2, 2, 0], 'error');
  const bC = b.as(await b.addBusiness(3));
  eq((await call(bC, 'POST', '/v1/jobs', job('C1'))).json?.error?.code, 'FEATURE_LIMIT_REACHED', 'new profile');
  eq(sql(`SELECT COUNT(*) AS n FROM jobs WHERE title IN ('A2', 'C1')`)[0].n, 0, 'nothing created');
});
await test('publishing a draft over the limit is refused and the draft stays a draft', async () => {
  const draft = (await call(bA, 'POST', '/v1/jobs', { title: 'Draft 2', publish: false })).json.id;
  eq((await call(bA, 'POST', `/v1/jobs/${draft}/publish`)).json?.error?.code, 'FEATURE_LIMIT_REACHED', 'publish');
  eq(sql(`SELECT status FROM jobs WHERE id = '${draft}'`)[0].status, 'draft', 'status');
});
await test('archiving and re-opening the same job spends nothing (and is allowed at the limit)', async () => {
  eq((await call(bA, 'POST', `/v1/jobs/${firstJob}/close`)).status, 200, 'close');
  const r = await call(bA, 'POST', `/v1/jobs/${firstJob}/publish`);
  eq([r.status, r.json?.status], [200, 'published'], r.text);
  eq((await entitlements(bA)).features.job_posts.used, 2, 'used');
});
await test('deleting a job does not give the publication back', async () => {
  eq((await call(bA, 'DELETE', `/v1/jobs/${firstJob}`)).status, 200, 'delete');
  const j = (await entitlements(bA)).features.job_posts;
  eq([j.used, j.allowed], [2, false], 'usage');
});
await test('next calendar month: two more', async () => {
  sql(`UPDATE usage_events SET period_start = period_start - 40 * 86400000 WHERE user_id = '${b.uid}'`);
  const j = (await entitlements(bA)).features.job_posts;
  eq([j.used, j.remaining], [0, 2], 'usage');
  eq((await call(bA, 'POST', '/v1/jobs', job('Next month'))).status, 201, 'publish');
});
await test('parallel publications never go past 2', async () => {
  const p = await account('p');
  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => call(p.as(p.business), 'POST', '/v1/jobs', job(`P${n}`))));
  eq(results.filter((r) => r.status === 201).length, 2, 'published');
  eq(sql(`SELECT COUNT(*) AS n FROM usage_events WHERE user_id = '${p.uid}'`)[0].n, 2, 'counted');
});

console.log('Business PRO');
const q = await account('q');
const qA = q.as(q.business);
const qB = q.as(await q.addBusiness(2));
await test('business.pro on one profile: unlimited for every business profile of the account', async () => {
  grant(q.business, 'business_pro');
  const j = (await entitlements(qB)).features.job_posts;
  eq([j.unlimited, j.limit, j.plan], [true, null, 'pro'], 'usage');
  for (const n of [1, 2, 3]) eq((await call(qB, 'POST', '/v1/jobs', job(`Q${n}`))).status, 201, `Q${n} from B`);
  eq((await call(qA, 'POST', '/v1/jobs', job('Q4'))).status, 201, 'from A');
});
await test('business.pro ended: the account\'s free allowance applies (already used)', async () => {
  expire(q.business);
  const j = (await entitlements(qB)).features.job_posts;
  eq([j.limit, j.used, j.allowed], [2, 4, false], 'usage');
  eq((await call(qB, 'POST', '/v1/jobs', job('Q5'))).json?.error?.code, 'FEATURE_LIMIT_REACHED', 'refused');
});

console.log('Ownership and configuration');
await test('another account\'s profile id is never accepted', async () => {
  const r = await call({ token: b.token, profileId: q.business }, 'GET', '/v1/me/entitlements');
  eq(r.json?.error?.code, 'not_profile_owner', r.text);
});
await test('limits come from the server configuration (no app release)', async () => {
  sql(`INSERT INTO plan_config (id, config, updated_at) VALUES ('current', '{"business":{"free":{"job_posts_per_month":3}}}', ${Date.now()})
       ON CONFLICT (id) DO UPDATE SET config = excluded.config`);
  try {
    const j = (await entitlements(qB)).features.job_posts;
    eq(j.limit, 3, 'limit');
    eq((await entitlements(cs)).features.portfolio_videos.limit, 9, 'other keys keep their defaults');
  } finally {
    sql(`DELETE FROM plan_config`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
