// FIX 139 local API checks — rolling 30-day job posts, idempotent publication, Apply video choice, text limits.
//   cd api && npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX: --var MONETIZATION_ENABLED:true
//   node tests/fix139-local.mjs "$PWD"      (local D1 only — never against production)
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
  const uid = `usr_x139_${tag}_${stamp}`; const email = `x139.${tag}.${stamp}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const token = (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token;
  const profile = (await call({ token }, 'POST', '/v1/profiles', { type, displayName: `${type} ${tag}` })).json.id;
  return { token, profileId: profile };
}
/** A portfolio video of `owner`, `ageMinutes` old. */
function video(owner, n, ageMinutes, extra = {}) {
  const id = `med_x139_${owner.profileId}_${n}`;
  const f = { status: 'ready', is_public: 1, review_status: 'approved', purpose: 'portfolio', ...extra };
  sql(`INSERT INTO media (id, owner_profile_id, kind, purpose, provider, url, status, is_public, review_status, duration, created_at)
       VALUES ('${id}', '${owner.profileId}', 'video', '${f.purpose}', 'external', 'https://example.com/${id}.mp4', '${f.status}', ${f.is_public},
               '${f.review_status}', 12, ${stamp - ageMinutes * 60_000})`);
  return id;
}



const DAY = 86_400_000;
const business = await person('biz', 'business');
const pro = await person('pro', 'creator');
const free = await person('free', 'creator');
sql(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at) VALUES ('sub_x139_pro_${stamp}', '${pro.profileId}', 'creator_pro', 'active', 'test', ${stamp})`);
const [bizUser] = sql(`SELECT owner_user_id AS u FROM profiles WHERE id = '${business.profileId}'`);
const jobBody = (extra = {}) => ({ title: 'Job', description: 'Desc', publish: true, ...extra });
const biz = await person('bz2', 'business');
sql(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at) VALUES ('sub_x139_${stamp}', '${biz.profileId}', 'business_pro', 'active', 'test', ${stamp})`);
const creator = await person('cr2', 'creator');
const jobs = [];
for (let i = 0; i < 12; i++) {
  const r = await call(biz, 'POST', '/v1/jobs', jobBody({ title: `Job ${i}` }));
  jobs.push(r.json.id);
}
sql(`UPDATE jobs SET review_status = 'approved' WHERE id IN (${jobs.map((j) => `'${j}'`).join(',')})`);
console.log('Applications — Free: 10 in 30 days');
await test('ten applications, the eleventh refused with the limit; withdrawing gives nothing back', async () => {
  for (let i = 0; i < 10; i++) eq((await call(creator, 'POST', `/v1/jobs/${jobs[i]}/apply`, { message: 'Hi' })).status, 201, `apply ${i}`);
  const ent = (await call(creator, 'GET', '/v1/me/entitlements')).json.features.applications;
  eq([ent.limit, ent.used, ent.remaining], [10, 10, 0], 'usage');
  const r = await call(creator, 'POST', `/v1/jobs/${jobs[10]}/apply`, { message: 'Hi' });
  eq(r.status, 403, r.text); eq(r.json.error.code, 'FEATURE_LIMIT_REACHED', 'code');
  const mine = (await call(creator, 'GET', '/v1/jobs/applications/mine')).json.items;
  eq((await call(creator, 'POST', `/v1/jobs/applications/${mine[0].id}/withdraw`)).status, 200, 'withdraw');
  eq((await call(creator, 'POST', `/v1/jobs/${jobs[10]}/apply`, { message: 'Hi' })).status, 403, 'still refused');
});
await test('a duplicate application spends nothing', async () => {
  sql(`DELETE FROM usage_events WHERE profile_id = '${creator.profileId}' AND feature = 'applications'`);
  eq((await call(creator, 'POST', `/v1/jobs/${jobs[11]}/apply`, { message: 'Hi' })).status, 201, 'first');
  eq((await call(creator, 'POST', `/v1/jobs/${jobs[11]}/apply`, { message: 'Again' })).status, 409, 'dup');
  eq(sql(`SELECT COUNT(*) AS n FROM usage_events WHERE profile_id = '${creator.profileId}' AND feature = 'applications'`)[0].n, 1, 'one spent');
});
console.log('Job views');
await test('views count opening the page (not the owner, not GET /jobs/:id); stats are live', async () => {
  const before = sql(`SELECT views_count FROM jobs WHERE id = '${jobs[0]}'`)[0].views_count;
  await call(creator, 'GET', `/v1/jobs/${jobs[0]}`);
  eq(sql(`SELECT views_count FROM jobs WHERE id = '${jobs[0]}'`)[0].views_count, before, 'a read is not a view');
  const v = await call(creator, 'POST', `/v1/jobs/${jobs[0]}/view`);
  eq(v.json.viewsCount, before + 1, 'counted'); eq(v.json.applicationsCount >= 0, true, 'applicants');
  eq((await call(biz, 'POST', `/v1/jobs/${jobs[0]}/view`)).json.viewsCount, before + 1, 'owner not counted');
  eq((await call(biz, 'GET', `/v1/jobs/${jobs[0]}/stats`)).json.viewsCount, before + 1, 'stats');
  // FIX 140: seen in the feed counts too — each account once (the page opened above already counted this one).
  const before1 = sql(`SELECT views_count FROM jobs WHERE id = '${jobs[1]}'`)[0].views_count;
  const seen = await call(creator, 'POST', '/v1/jobs/views', { ids: [jobs[0], jobs[1], jobs[1]] });
  eq(seen.json.views[jobs[0]], before + 1, 'same account not counted twice');
  eq(seen.json.views[jobs[1]], before1 + 1, 'feed impression counted once');
  eq((await call(creator, 'POST', `/v1/jobs/${jobs[1]}/view`)).json.viewsCount, before1 + 1, 'page after feed: same person');
  eq((await call(biz, 'POST', '/v1/jobs/views', { ids: [jobs[1]] })).json.views[jobs[1]], before1 + 1, 'owner not counted in feed');
});
console.log('Uploads');
await test('an upload that never arrived stops holding a portfolio place after 15 minutes; a cancelled one at once', async () => {
  const t = await call(creator, 'POST', '/v1/media/uploads', { purpose: 'portfolio', kind: 'video', mime: 'video/mp4', bytes: 1000, duration: 5 });
  eq(t.status, 201, t.text);
  const held = (await call(creator, 'GET', '/v1/me/entitlements')).json.features.portfolio_videos.pending;
  eq(held, 1, 'held while fresh');
  eq((await call(creator, 'DELETE', `/v1/media/${t.json.mediaId}`)).status, 200, 'cancelled');
  eq((await call(creator, 'GET', '/v1/me/entitlements')).json.features.portfolio_videos.pending, 0, 'given back');
  const t2 = await call(creator, 'POST', '/v1/media/uploads', { purpose: 'portfolio', kind: 'video', mime: 'video/mp4', bytes: 1000, duration: 5 });
  sql(`UPDATE media SET created_at = ${Date.now() - 16 * 60_000} WHERE id = '${t2.json.mediaId}'`);
  eq((await call(creator, 'GET', '/v1/me/entitlements')).json.features.portfolio_videos.pending, 0, 'stale not held');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
