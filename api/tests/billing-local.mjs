// App Store purchases (src/routes/billing.ts) against a stand-in App Store Server API — local only.
//   node tests/billing-local.mjs "$PWD" <key-dir>      (key-dir: es256.pem / es256.pub.pem made by the runner)
//   wrangler dev --env local --port 8799 --var MONETIZATION_ENABLED:true --var APPSTORE_API_URL:http://127.0.0.1:8790
//     --var APPSTORE_BUNDLE_ID:com.kolaba.app --var APPSTORE_ISSUER_ID:test-issuer --var APPSTORE_KEY_ID:TESTKEY
//     --var APPSTORE_PRIVATE_KEY:<the PEM body>
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API_DIR = process.argv[2];
const KEY_DIR = process.argv[3];
const API = 'http://127.0.0.1:8799';
const ORIGIN = 'http://localhost:5173';
const creds = JSON.parse(readFileSync(`${API_DIR}/seed/.demo-credentials.json`, 'utf8'));
const publicKey = createPublicKey(readFileSync(`${KEY_DIR}/es256.pub.pem`));
let passed = 0; const failures = [];
const sql = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'kolaba-db', '--local', '--env', 'local', '--json', '--command', q],
  { cwd: API_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jws = (payload) => `${b64({ alg: 'ES256' })}.${b64(payload)}.sig`;

// The stand-in Apple: checks the bearer token's ES256 signature and claims, answers the transactions it knows.
const transactions = new Map();
let lastClaims = null;
const apple = createServer((req, res) => {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '');
  const [h, p, s] = token.split('.');
  const ok = h && p && s && verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  if (!ok) { res.writeHead(401).end(); return; }
  lastClaims = JSON.parse(Buffer.from(p, 'base64url').toString());
  const id = req.url.split('/').pop();
  const tx = transactions.get(id);
  if (!tx) { res.writeHead(404).end('{}'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ signedTransactionInfo: jws(tx) }));
}).listen(8790);

async function call(s, method, path, body) {
  const headers = { Origin: ORIGIN };
  if (s?.token) headers.Authorization = `Bearer ${s.token}`;
  if (s?.profileId) headers['X-Profile-Id'] = s.profileId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const send = () => fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
  const uid = `usr_bill_${tag}_${stamp}`; const email = `bill.${tag}.${stamp}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${stamp}, 'owner', 0, ${stamp}, ${stamp})`);
  const token = (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token;
  const creator = (await call({ token }, 'POST', '/v1/profiles', { type: 'creator', displayName: `Creator ${tag}` })).json.id;
  const business = (await call({ token }, 'POST', '/v1/profiles', { type: 'business', displayName: `Business ${tag}` })).json.id;
  return { token, creator, business, as: (profileId) => ({ token, profileId }) };
}
const isProNow = (profileId) => sql(`SELECT COUNT(*) AS n FROM subscriptions WHERE profile_id = '${profileId}' AND status = 'active'
    AND (expires_at IS NULL OR expires_at > ${Date.now()})`)[0].n > 0;

const a = await account('a');
const b = await account('b');
const original = `${stamp}`.slice(-12);
transactions.set(original, { transactionId: original, originalTransactionId: original, bundleId: 'com.kolaba.app',
  productId: 'app.kolaba.creator.pro.monthly', expiresDate: Date.now() + 30 * 86_400_000 });

console.log('Purchases');
await test('a new account is Free', async () => eq(isProNow(a.creator), false, 'pro'));
await test('a creator.pro purchase makes the creator profile PRO (Apple asked with a valid ES256 token)', async () => {
  const r = await call(a.as(a.creator), 'POST', '/v1/billing/app-store/transactions', { signedTransaction: jws({ transactionId: original }) });
  eq(r.status, 200, r.text);
  eq(r.json.isPro, true, 'isPro');
  eq(isProNow(a.creator), true, 'pro in the database');
  eq(lastClaims.aud, 'appstoreconnect-v1', 'aud'); eq(lastClaims.bid, 'com.kolaba.app', 'bid'); eq(lastClaims.iss, 'test-issuer', 'iss');
});
await test('sending it again keeps one subscription', async () => {
  await call(a.as(a.creator), 'POST', '/v1/billing/app-store/transactions', { signedTransaction: jws({ transactionId: original }) });
  eq(sql(`SELECT COUNT(*) AS n FROM subscriptions WHERE external_id = '${original}'`)[0].n, 1, 'rows');
});
await test('a creator plan never goes to a business profile', async () => {
  const r = await call(a.as(a.business), 'POST', '/v1/billing/app-store/transactions', { signedTransaction: jws({ transactionId: original }) });
  eq(r.json?.error?.code, 'plan_for_other_profile_type', r.text);
});
await test('another account cannot take the purchase', async () => {
  const r = await call(b.as(b.creator), 'POST', '/v1/billing/app-store/transactions', { signedTransaction: jws({ transactionId: original }) });
  eq(r.json?.error?.code, 'purchase_belongs_to_another_account', r.text);
  eq(isProNow(b.creator), false, 'b stays Free');
});
await test('a transaction Apple doesn\'t know grants nothing', async () => {
  const r = await call(b.as(b.creator), 'POST', '/v1/billing/app-store/transactions', { signedTransaction: jws({ transactionId: '999999999' }) });
  eq(r.json?.error?.code, 'transaction_not_found', r.text);
});

console.log('App Store Server Notifications');
await test('an expiry re-read from Apple ends PRO', async () => {
  transactions.set(original, { ...transactions.get(original), expiresDate: Date.now() - 1000 });
  const r = await call(null, 'POST', '/v1/billing/app-store/notifications',
    { signedPayload: jws({ notificationType: 'EXPIRED', data: { signedTransactionInfo: jws({ transactionId: original }) } }) });
  eq(r.json?.status, 'updated', r.text);
  eq(isProNow(a.creator), false, 'pro');
});
await test('a renewal makes it PRO again; a refund ends it', async () => {
  transactions.set(original, { ...transactions.get(original), expiresDate: Date.now() + 86_400_000 });
  await call(null, 'POST', '/v1/billing/app-store/notifications',
    { signedPayload: jws({ notificationType: 'DID_RENEW', data: { signedTransactionInfo: jws({ transactionId: original }) } }) });
  eq(isProNow(a.creator), true, 'renewed');
  transactions.set(original, { ...transactions.get(original), revocationDate: Date.now() });
  await call(null, 'POST', '/v1/billing/app-store/notifications',
    { signedPayload: jws({ notificationType: 'REFUND', data: { signedTransactionInfo: jws({ transactionId: original }) } }) });
  eq(isProNow(a.creator), false, 'refunded');
});

apple.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
