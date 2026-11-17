// FIX 137: the admin dashboard's storage meter (GET /v1/admin/storage) against the local Worker — local only.
//   cd api && npx wrangler dev --env local --port 8799 --ip 127.0.0.1 --var RESEND_API_KEY: --var TEST_CODE_INBOX:
//   node tests/storage137-local.mjs "$PWD"
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const API_DIR = process.argv[2];
const API = 'http://127.0.0.1:8799';
let passed = 0; const failures = [];
const sql = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'kolaba-db', '--local', '--env', 'local', '--json', '--command', q],
  { cwd: API_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;
async function call(token, path) {
  const headers = { Origin: 'http://localhost:5174' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { headers });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const token = `s137-admin-${Date.now()}`;
const [adminRow] = sql(`SELECT id FROM admins WHERE must_change_password = 0 LIMIT 1`);
if (!adminRow) { console.log('No local admin — run fix128-local first.'); process.exit(1); }
sql(`INSERT INTO admin_sessions (id, admin_id, created_at, expires_at, last_seen_at) VALUES
    ('${createHash('sha256').update(token).digest('hex')}', '${adminRow.id}', ${Date.now()}, ${Date.now() + 3_600_000}, ${Date.now()})`);

console.log('Storage');
await test('admins only', async () => {
  eq((await call(null, '/v1/admin/storage')).status, 401, 'no session');
});
await test('files by kind, the database and the limit', async () => {
  const r = await call(token, '/v1/admin/storage');
  eq(r.status, 200, r.text);
  const s = r.json;
  eq(typeof s.files.bytes, 'number', 'files bytes');
  eq(s.files.bytes, s.files.groups.reduce((a, g) => a + g.bytes, 0), 'groups add up');
  eq(s.files.count, s.files.groups.reduce((a, g) => a + g.files, 0), 'counts add up');
  eq(s.database.bytes > 0, true, 'database size');
  eq(s.limitBytes, 10 * 1024 ** 3, 'default limit');
  console.log(`      files ${s.files.count} (${s.files.bytes} B), db ${s.database.bytes} B, groups ${s.files.groups.map((g) => g.key).join(',')}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
