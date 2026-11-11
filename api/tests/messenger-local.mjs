// Messenger realtime local checks (wrangler dev --env local on :8799; local D1 only — never production).
//   cd api && npx wrangler d1 migrations apply kolaba-db --local --env local
//   npx wrangler dev --env local --port 8799 --var RESEND_API_KEY: --var TEST_CODE_INBOX:
//   node tests/messenger-local.mjs "$PWD"
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API_DIR = process.argv[2];
const API = 'http://127.0.0.1:8799';
const ORIGIN = 'http://localhost:5173';
const creds = JSON.parse(readFileSync(`${API_DIR}/seed/.demo-credentials.json`, 'utf8'));
let passed = 0; const failures = [];
const sql = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'kolaba-db', '--local', '--env', 'local', '--json', '--command', q],
  { cwd: API_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;
async function call(s, method, path, body, form) {
  const headers = { Origin: ORIGIN };
  if (s?.token) headers.Authorization = `Bearer ${s.token}`;
  if (s?.profileId) headers['X-Profile-Id'] = s.profileId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`); };

const demo = Object.keys(creds)[1];
const [src] = sql(`SELECT password_hash, password_salt, password_scheme FROM users WHERE email = '${demo}'`);
async function account(tag) {
  const uid = `usr_msg_${tag}_${Date.now()}`; const email = `msg.${tag}.${Date.now()}@example.com`;
  sql(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, email_verified_at, email_verification, is_demo, created_at, updated_at)
       VALUES ('${uid}', '${email}', '${src.password_hash}', '${src.password_salt}', '${src.password_scheme}', ${Date.now()}, 'owner', 0, ${Date.now()}, ${Date.now()})`);
  const s = { token: (await call(null, 'POST', '/v1/auth/login', { email, password: creds[demo].password })).json.token };
  const p = await call(s, 'POST', '/v1/profiles', { type: 'creator', displayName: `Tester ${tag}` });
  eq(p.status, 201, p.text);
  s.profileId = p.json.id;
  return s;
}
function socket(s) {
  const events = [];
  const ws = new WebSocket(`${API.replace('http', 'ws')}/v1/realtime?profile=${s.profileId}`, { headers: { Authorization: `Bearer ${s.token}` } });
  ws.addEventListener('message', (e) => events.push(JSON.parse(e.data)));
  const opened = new Promise((ok, no) => { ws.addEventListener('open', ok); ws.addEventListener('error', () => no(new Error('ws error'))); });
  const wait = async (type, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = events.findIndex((e) => e.type === type);
      if (i >= 0) return events.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`no ${type} event (got: ${events.map((e) => e.type).join(', ') || 'nothing'})`);
  };
  return { ws, opened, wait, events };
}

const a = await account('a'); const b = await account('b');
let conv, first, sa, sb;
console.log('Realtime');
await test('sockets: unauthenticated refused, both accounts connect', async () => {
  const bad = await fetch(`${API}/v1/realtime?profile=${a.profileId}`, {});
  eq(bad.status, 401, 'no session');
  const other = await fetch(`${API}/v1/realtime?profile=${b.profileId}`, { headers: { Authorization: `Bearer ${a.token}` } });
  eq(other.status, 403, "someone else's profile");
  sa = socket(a); sb = socket(b); await sa.opened; await sb.opened;
  await sa.wait('hello'); await sb.wait('hello');
});
await test('message.new reaches both, once; clientId retry makes no copy', async () => {
  conv = (await call(a, 'POST', '/v1/conversations', { profileId: b.profileId })).json.id;
  const r = await call(a, 'POST', `/v1/conversations/${conv}/messages`, { body: 'hello', clientId: 'client-0001' }); eq(r.status, 201, r.text);
  first = r.json; eq(first.status, 'sent', 'status');
  const again = await call(a, 'POST', `/v1/conversations/${conv}/messages`, { body: 'hello', clientId: 'client-0001' });
  eq(again.status, 200, 'retry'); eq(again.json.id, first.id, 'same message');
  const eb = await sb.wait('message.new'); eq(eb.message.id, first.id, 'id'); eq(eb.message.isOutgoing, false, 'incoming for B');
  const ea = await sa.wait('message.new'); eq(ea.message.isOutgoing, true, 'outgoing for A'); eq(ea.message.clientId, 'client-0001', 'clientId');
  await sb.wait('chat.updated');
  eq(sb.events.filter((e) => e.type === 'message.new').length, 0, 'no duplicate event');
});
await test('delivered (socket ack) then read: sender gets both, statuses persist', async () => {
  sb.ws.send(JSON.stringify({ type: 'delivered', conversationId: conv }));
  await sa.wait('message.delivered');
  let list = await call(a, 'GET', `/v1/conversations/${conv}/messages`); eq(list.json.items[0].status, 'delivered', 'delivered');
  eq((await call(b, 'POST', `/v1/conversations/${conv}/read`)).status, 200, 'read');
  await sa.wait('message.read');
  list = await call(a, 'GET', `/v1/conversations/${conv}/messages`); eq(list.json.items[0].status, 'read', 'read');
});
await test('typing is relayed to the partner only and never stored', async () => {
  sb.ws.send(JSON.stringify({ type: 'typing.start', conversationId: conv }));
  const e = await sa.wait('typing.start'); eq(e.profileId, b.profileId, 'who');
  sb.ws.send(JSON.stringify({ type: 'typing.stop', conversationId: conv })); await sa.wait('typing.stop');
  eq(sb.events.filter((x) => x.type.startsWith('typing')).length, 0, 'not echoed');
  sb.ws.send(JSON.stringify({ type: 'typing.start', conversationId: 'cnv_not_mine' }));
});
await test('reply keeps its original; reaction.updated reaches both', async () => {
  const r = await call(b, 'POST', `/v1/conversations/${conv}/messages`, { body: 'answer', replyToId: first.id }); eq(r.status, 201, r.text);
  eq(r.json.replyTo.messageId, first.id, 'reply id'); eq(r.json.replyTo.body, 'hello', 'reply body'); eq(r.json.replyTo.kind, 'text', 'kind');
  await sa.wait('message.new');
  const list = await call(a, 'GET', `/v1/conversations/${conv}/messages`); eq(list.json.items[0].replyTo.isOutgoing, true, 'reply to my message');
  eq((await call(b, 'PUT', `/v1/conversations/${conv}/messages/${first.id}/like`)).status, 200, 'like');
  const ea = await sa.wait('reaction.updated'); eq(ea.likesCount, 1, 'count'); eq(ea.isLikedByMe, false, 'not mine');
  const eb = await sb.wait('reaction.updated'); eq(eb.isLikedByMe, true, 'mine');
});
await test('file: private upload, signed download, reply preview says file', async () => {
  sb.events.length = 0;
  const form = new FormData(); form.set('file', new File(['%PDF-1.4 test'], 'brief.pdf', { type: 'application/pdf' })); form.set('clientId', 'client-file-1');
  const r = await call(a, 'POST', `/v1/conversations/${conv}/files`, undefined, form); eq(r.status, 201, r.text);
  eq(r.json.files[0].name, 'brief.pdf', 'name'); eq(r.json.files[0].bytes, 13, 'bytes');
  const url = r.json.files[0].url.replace(/^https?:\/\/[^/]+/, API);   // local env signs URLs for :8787
  const dl = await fetch(url); eq(dl.status, 200, 'download'); eq(await dl.text(), '%PDF-1.4 test', 'bytes back');
  eq((await fetch(url.replace(/sig=.{4}/, 'sig=0000'))).status, 403, 'bad signature');
  const e = await sb.wait('message.new'); eq(e.message.files.length, 1, 'file in event');
  const rep = await call(b, 'POST', `/v1/conversations/${conv}/messages`, { body: 'got it', replyToId: r.json.id }); eq(rep.json.replyTo.kind, 'file', 'kind');
});
await test('delete: only the sender; message.deleted to both; body gone', async () => {
  eq((await call(b, 'DELETE', `/v1/conversations/${conv}/messages/${first.id}`)).status, 404, 'not the sender');
  eq((await call(a, 'DELETE', `/v1/conversations/${conv}/messages/${first.id}`)).status, 200, 'sender');
  const e = await sb.wait('message.deleted'); eq(e.messageId, first.id, 'id');
  const list = await call(b, 'GET', `/v1/conversations/${conv}/messages?limit=100`);
  const gone = list.json.items.find((m) => m.id === first.id); eq(gone.body, '', 'body'); eq(Boolean(gone.deletedAt), true, 'tombstone');
});
await test('delete chat: chat.deleted for me, the partner keeps the history', async () => {
  eq((await call(a, 'DELETE', `/v1/conversations/${conv}`)).status, 200, 'delete');
  await sa.wait('chat.deleted');
  eq((await call(b, 'GET', `/v1/conversations/${conv}/messages`)).json.items.length > 0, true, 'partner history');
});
sa?.ws.close(); sb?.ws.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
