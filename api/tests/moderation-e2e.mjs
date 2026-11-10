#!/usr/bin/env node
// APP STORE READINESS — moderation, blocks, feedback, chat safety, account deletion, PRO switch.
//   API=http://127.0.0.1:8790 ADMIN_EMAIL=… ADMIN_PASSWORD=… node tests/moderation-e2e.mjs
// Runs against a LOCAL copy of the database (wrangler dev --persist-to …): it creates reports, blocks, sanctions and
// deletes a throw-away account. Never point it at production.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API ?? 'http://127.0.0.1:8790';
if (/workers\.dev|kolaba-api\./.test(API)) { console.error('Refusing to run against production.'); process.exit(2); }
const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN ?? 'http://localhost:5199';
const creds = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'seed', '.demo-credentials.json'), 'utf8'));
let passed = 0;
const failures = [];

async function call(session, method, path, body, profileId, extra = {}) {
  const headers = { ...extra };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  if (profileId ?? session?.profileId) headers['X-Profile-Id'] = profileId ?? session.profileId;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const expectError = (r, status, code) =>
  expect(r.status === status && r.json?.error?.code === code, `expected ${status} ${code}, got ${r.status} ${r.text.slice(0, 200)}`);
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
async function login(email) {
  const r = await call(null, 'POST', '/v1/auth/login', { email, password: creds[email].password });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${r.text}`);
  return { token: r.json.token, user: r.json.user, profiles: r.json.profiles, profileId: r.json.profiles[0].id };
}
const cid = () => `t${Math.random().toString(36).slice(2, 14)}`;

console.log(`API ${API}\n`);
const a = await login('creator.pro@demo.kolaba.test');
const b = await login('creator.free@demo.kolaba.test');
const biz = await login('business.pro@demo.kolaba.test');

// Admin (local bootstrap: the scratch DB has no admins row; the first login creates it, then the password changes).
const adminEmail = process.env.ADMIN_EMAIL ?? 'milka19051995@gmail.com';
let adminPass = process.env.ADMIN_PASSWORD ?? 'local-admin-test-pass-1';
const adminHeaders = { Origin: ADMIN_ORIGIN };
let admin = null;
{
  let r = await call(null, 'POST', '/v1/admin/login', { email: adminEmail, password: adminPass }, undefined, adminHeaders);
  if (r.status === 200 && r.json.admin.mustChangePassword) {
    const token = r.json.token;
    const next = `${adminPass}-changed`;
    await call({ token }, 'POST', '/v1/admin/password', { currentPassword: adminPass, newPassword: next }, undefined, adminHeaders);
    adminPass = next;
    r = await call(null, 'POST', '/v1/admin/login', { email: adminEmail, password: adminPass }, undefined, adminHeaders);
  }
  if (r.status !== 200) {
    r = await call(null, 'POST', '/v1/admin/login', { email: adminEmail, password: `${adminPass}-changed` }, undefined, adminHeaders);
  }
  if (r.status === 200) admin = { token: r.json.token };
  else console.log(`  (admin login failed: ${r.status} ${r.text.slice(0, 120)} — admin checks will fail)`);
}
const adm = (method, path, body) => call(admin, method, `/v1/admin${path}`, body, undefined, adminHeaders);

await test('config: monetization off, legal links present', async () => {
  const r = await call(null, 'GET', '/v1/config');
  expect(r.json.monetizationEnabled === false, 'monetization should be off');
  expect(r.json.legal.privacy && r.json.legal.terms && r.json.legal.guidelines && r.json.legal.support, 'legal links');
});

await test('PRO: no badges, every feature open, self-service PRO refused', async () => {
  const s = await call(a, 'GET', '/v1/auth/session');
  expect(s.json.user.canTestPro === false, 'canTestPro must be false');
  expect(s.json.profiles.every((p) => p.isPro === false), 'no profile shows PRO');
  const e = s.json.profiles[0].entitlements;
  expect(e.collections === 'available' && e.introVideo === 'available', `features open: ${JSON.stringify(e)}`);
  expectError(await call(a, 'PUT', '/v1/me/pro-test', { pro: true }), 403, 'monetization_disabled');
});

let reportId;
await test('report: categories, self-report refused, duplicate returns the open report', async () => {
  expectError(await call(a, 'POST', '/v1/reports', { targetType: 'user', targetId: a.profileId, category: 'spam' }), 422, 'cannot_report_self');
  expectError(await call(a, 'POST', '/v1/reports', { targetType: 'user', targetId: b.profileId, category: 'nonsense' }), 422, 'invalid_category');
  expectError(await call(a, 'POST', '/v1/reports', { targetType: 'user', targetId: b.profileId, category: 'other' }), 422, 'details_required');
  const r = await call(a, 'POST', '/v1/reports', { targetType: 'user', targetId: b.profileId, category: 'impersonation', details: 'Pretends to be someone' });
  expect(r.status === 201 && r.json.id, `create: ${r.status} ${r.text}`);
  reportId = r.json.id;
  const again = await call(a, 'POST', '/v1/reports', { targetType: 'user', targetId: b.profileId, category: 'spam' });
  expect(again.json.duplicate === true && again.json.id === reportId, 'duplicate not merged');
  const legacy = await call(a, 'POST', '/v1/reports', { targetType: 'job', targetId: 'job_missing', reason: 'inappropriate' });
  expectError(legacy, 404, 'target_not_found');
});

let conv;
let msgFromB;
await test('chat: message, like, duplicate clientId, report message needs consent and copies context', async () => {
  const open = await call(a, 'POST', '/v1/conversations', { profileId: b.profileId });
  expect([200, 201].includes(open.status), `open: ${open.status} ${open.text}`);
  conv = open.json.id;
  const client = cid();
  const m1 = await call(a, 'POST', `/v1/conversations/${conv}/messages`, { body: 'hello from A', clientId: client });
  expect(m1.status === 201, `send: ${m1.status} ${m1.text}`);
  const dup = await call(a, 'POST', `/v1/conversations/${conv}/messages`, { body: 'hello from A', clientId: client });
  expect(dup.status === 200 && dup.json.id === m1.json.id, 'retry created a second copy');
  const m2 = await call(b, 'POST', `/v1/conversations/${conv}/messages`, { body: 'abusive reply', clientId: cid() });
  expect(m2.status === 201, `reply: ${m2.status} ${m2.text}`);
  msgFromB = m2.json.id;
  const like = await call(a, 'PUT', `/v1/conversations/${conv}/messages/${msgFromB}/like`);
  expect(like.json.isLikedByMe === true && like.json.likesCount === 1, `like: ${like.text}`);
  const hist = await call(b, 'GET', `/v1/conversations/${conv}/messages`);
  const liked = hist.json.items.find((m) => m.id === msgFromB);
  expect(liked.likesCount === 1 && liked.isLikedByMe === false, 'like not visible to the other side');
  const stranger = await call(biz, 'PUT', `/v1/conversations/${conv}/messages/${msgFromB}/like`);
  expectError(stranger, 404, 'conversation_not_found');
  expectError(await call(a, 'POST', '/v1/reports', { targetType: 'message', targetId: msgFromB, category: 'harassment' }), 422, 'consent_required');
  const rep = await call(a, 'POST', '/v1/reports', { targetType: 'message', targetId: msgFromB, category: 'harassment', consentToShareMessages: true });
  expect(rep.status === 201 && rep.json.priority === 'high', `message report: ${rep.text}`);
  expectError(await call(biz, 'POST', '/v1/reports', { targetType: 'message', targetId: msgFromB, category: 'spam', consentToShareMessages: true }), 404, 'target_not_found');
});

await test('voice message: stored, signed URL, Range, outsider gets nothing', async () => {
  // A tiny valid-looking MPEG-4 audio header ("ftyp") — enough for the signature check.
  const bytes = new Uint8Array(2048); bytes.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: 'audio/mp4' }), 'voice.m4a');
  form.set('duration', '3.2'); form.set('waveform', JSON.stringify([0.1, 0.5, 0.9])); form.set('clientId', cid());
  const r = await call(a, 'POST', `/v1/conversations/${conv}/voice`, form);
  expect(r.status === 201 && r.json.voice?.url, `voice: ${r.status} ${r.text}`);
  const file = await fetch(r.json.voice.url, { headers: { Range: 'bytes=0-15' } });
  expect(file.status === 206, `range: ${file.status}`);
  const tampered = await fetch(r.json.voice.url.replace(/sig=[^&]+/, 'sig=0000'));
  expect(tampered.status === 403, `tampered signature: ${tampered.status}`);
  const bad = new FormData();
  bad.set('file', new Blob([new Uint8Array(64)], { type: 'audio/mp4' }), 'x.m4a'); bad.set('duration', '1');
  expectError(await call(a, 'POST', `/v1/conversations/${conv}/voice`, bad), 415, 'invalid_file');
});

await test('block: server-side, both directions, list, notifications stop, unblock', async () => {
  const r = await call(b, 'POST', '/v1/blocks', { profileId: a.profileId });
  expect(r.json.blocked === true, `block: ${r.text}`);
  expectError(await call(a, 'POST', `/v1/conversations/${conv}/messages`, { body: 'still there?' }), 403, 'blocked');
  expectError(await call(b, 'POST', `/v1/conversations/${conv}/messages`, { body: 'x' }), 403, 'blocked_by_you');
  const list = await call(b, 'GET', '/v1/blocks');
  expect(list.json.items.some((i) => i.profileId === a.profileId), 'not in blocked list');
  const info = await call(b, 'GET', `/v1/conversations/${conv}/messages`);
  expect(info.json.conversation.blockedByMe === true, 'blockedByMe missing');
  expect(info.json.items.length > 0, 'history must stay');
  expectError(await call(a, 'POST', '/v1/contacts/requests', { profileId: b.profileId }), 403, 'blocked');
  // Survives a new session (it's on the server).
  const b2 = await login('creator.free@demo.kolaba.test');
  expect((await call(b2, 'GET', '/v1/blocks')).json.items.length >= 1, 'block lost after re-login');
  expectError(await call(b, 'POST', '/v1/blocks', { profileId: b.profileId }), 422, 'cannot_block_self');
  await call(b, 'DELETE', `/v1/blocks/${a.profileId}`);
  const after = await call(a, 'POST', `/v1/conversations/${conv}/messages`, { body: 'after unblock', clientId: cid() });
  expect(after.status === 201, `after unblock: ${after.status}`);
});

let pendingMedia;
await test('content review: a new public photo waits (hidden from others, owner sees Pending)', async () => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
  const up = await call(a, 'POST', '/v1/media/uploads', { purpose: 'portfolio', kind: 'photo', mime: 'image/png', bytes: png.length, width: 1, height: 1 });
  expect(up.status === 201, `upload request: ${up.status} ${up.text}`);
  const put = await fetch(up.json.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${a.token}`, 'X-Profile-Id': a.profileId,
    'Content-Type': 'image/png', 'Content-Length': String(png.length) }, body: png });
  const putJson = await put.json();
  expect(put.status === 200 && putJson.reviewStatus === 'pending', `put: ${put.status} ${JSON.stringify(putJson)}`);
  pendingMedia = up.json.mediaId;
  const mine = await call(a, 'GET', `/v1/profiles/${a.profileId}/media?purpose=portfolio`);
  expect(mine.json.items.some((m) => m.id === pendingMedia && m.reviewStatus === 'pending'), 'owner should see pending item');
  const theirs = await call(b, 'GET', `/v1/profiles/${a.profileId}/media?purpose=portfolio`);
  expect(!theirs.json.items.some((m) => m.id === pendingMedia), 'others must not see pending media');
});

await test('admin: stats, filters, report detail with shared messages (logged), actions', async () => {
  expect(admin, 'no admin session');
  const stats = await adm('GET', '/moderation/stats');
  expect(stats.status === 200 && stats.json.pendingReports >= 2, `stats: ${stats.text}`);
  const msgs = await adm('GET', '/reports?tab=messages&status=open');
  const rep = msgs.json.items.find((i) => i.targetId === msgFromB);
  expect(rep && rep.category === 'harassment', 'message report not in Messages tab');
  const profilesTab = await adm('GET', '/reports?tab=profiles');
  expect(profilesTab.json.items.every((i) => i.targetType === 'user'), 'tab filter leaks other types');
  const detail = await adm('GET', `/reports/${rep.id}`);
  expect(detail.json.evidence.length >= 2 && detail.json.evidence.some((e) => e.isReported && e.body === 'abusive reply'), `evidence: ${detail.text.slice(0, 300)}`);
  const logs = await adm('GET', '/logs?action=report.evidence_view');
  expect(logs.json.items.some((l) => l.entityId === rep.id), 'evidence access not logged');
  expectError(await adm('POST', `/reports/${rep.id}/action`, { action: 'remove_content', reason: 'harassment' }), 422, 'confirmation_required');
  const removed = await adm('POST', `/reports/${rep.id}/action`, { action: 'remove_content', reason: 'harassment', confirm: true });
  expect(removed.json.status === 'resolved', `remove: ${removed.text}`);
  const hist = await call(a, 'GET', `/v1/conversations/${conv}/messages`);
  expect(hist.json.items.find((m) => m.id === msgFromB)?.body === '', 'removed message still shows its text');
  const warn = await adm('POST', `/reports/${reportId}/action`, { action: 'warn', reason: 'First warning' });
  expect(warn.json.status === 'resolved', `warn: ${warn.text}`);
  const actions = (await adm('GET', `/reports/${reportId}`)).json.actions;
  expect(actions.some((x) => x.action === 'warn'), 'warn not in history');
});

await test('admin: content review approve makes the photo public; reject keeps it hidden with a reason', async () => {
  const queue = await adm('GET', '/content-review?type=media&status=pending');
  expect(queue.json.items.some((m) => m.id === pendingMedia && m.url.includes('sig=')), 'pending photo not in queue with signed preview');
  expectError(await adm('POST', `/content-review/media/${pendingMedia}`, { decision: 'reject' }), 422, 'reason_required');
  await adm('POST', `/content-review/media/${pendingMedia}`, { decision: 'approve' });
  const theirs = await call(b, 'GET', `/v1/profiles/${a.profileId}/media?purpose=portfolio`);
  expect(theirs.json.items.some((m) => m.id === pendingMedia), 'approved photo not public');
  await adm('POST', `/content-review/media/${pendingMedia}`, { decision: 'reject', reason: 'Not your content' });
  const hidden = await call(b, 'GET', `/v1/profiles/${a.profileId}/media?purpose=portfolio`);
  expect(!hidden.json.items.some((m) => m.id === pendingMedia), 'rejected photo still public');
  const file = await fetch(`${API}/v1/media/${pendingMedia}/file`);
  expect(file.status === 403, `rejected file served publicly: ${file.status}`);
  const notes = await call(a, 'GET', '/v1/notifications');
  expect(notes.json.items.some((n) => n.type === 'content_rejected'), 'owner not told about rejection');
  await call(a, 'DELETE', `/v1/media/${pendingMedia}`);
});

await test('restriction blocks posting, lift restores it; user can still report', async () => {
  const r = await adm('POST', `/users/${b.user.id}/sanction`, { action: 'restrict', reason: 'Spam wave', days: 1, confirm: true });
  expect(r.status === 200, `restrict: ${r.text}`);
  expectError(await call(b, 'POST', `/v1/conversations/${conv}/messages`, { body: 'x' }), 403, 'account_restricted');
  const ok = await call(b, 'GET', '/v1/blocks');
  expect(ok.status === 200, 'reading broken while restricted');
  await adm('POST', `/users/${b.user.id}/sanction`, { action: 'unrestrict' });
  const back = await call(b, 'POST', `/v1/conversations/${conv}/messages`, { body: 'back', clientId: cid() });
  expect(back.status === 201, `after lift: ${back.status} ${back.text}`);
});

await test('job text check: a flagged post leaves the feed until approved', async () => {
  const job = await call(biz, 'POST', '/v1/jobs', { title: 'Easy money', description: 'Send me your password and get guaranteed profit via western union',
    location: 'Worldwide', isWorldwide: true, publish: true });
  expect(job.status === 201 && job.json.reviewStatus === 'flagged', `job: ${job.status} ${job.text.slice(0, 200)}`);
  const feed = await call(a, 'GET', '/v1/jobs?q=easy%20money');
  expect(!feed.json.items.some((j) => j.id === job.json.id), 'flagged job in public feed');
  expectError(await call(a, 'GET', `/v1/jobs/${job.json.id}`), 404, 'job_not_found');
  const queue = await adm('GET', '/content-review?type=posts&status=flagged');
  expect(queue.json.items.some((j) => j.id === job.json.id), 'flagged job not in review queue');
  await call(biz, 'DELETE', `/v1/jobs/${job.json.id}`);
});

await test('feedback: validation, screenshot, admin list / status / note, badge count', async () => {
  const empty = new FormData(); empty.set('category', 'bug'); empty.set('message', '  ');
  const bad = await call(a, 'POST', '/v1/feedback', empty);
  expect(bad.status === 400, `empty message accepted: ${bad.status}`);
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
  const form = new FormData();
  form.set('category', 'bug'); form.set('message', 'The chat jumps when the keyboard opens'); form.set('appVersion', '1.0 (42)');
  form.set('osVersion', 'iOS 26.3'); form.set('platform', 'ios'); form.set('screenshot', new Blob([png], { type: 'image/png' }), 's.png');
  const r = await call(a, 'POST', '/v1/feedback', form);
  expect(r.status === 201, `feedback: ${r.status} ${r.text}`);
  const counts = await adm('GET', '/counts');
  expect(counts.json.feedback >= 1, 'badge count');
  const list = await adm('GET', '/feedback?category=bug&status=open');
  const item = list.json.items.find((f) => f.id === r.json.id);
  expect(item && item.hasAttachment && item.appVersion === '1.0 (42)', 'feedback not listed');
  const att = await fetch(`${API}/v1/admin/feedback/${item.id}/attachment`, { headers: { Authorization: `Bearer ${admin.token}`, ...adminHeaders } });
  expect(att.status === 200 && att.headers.get('content-type') === 'image/png', `attachment: ${att.status}`);
  const upd = await adm('PATCH', `/feedback/${item.id}`, { status: 'resolved', adminNote: 'Fixed in build 43' });
  expect(upd.json.status === 'resolved' && upd.json.adminNote === 'Fixed in build 43', 'status/note');
  const anon = await call(null, 'GET', '/v1/admin/feedback');
  expect(anon.status === 401, 'admin API open without a session');
  const asUser = await call(a, 'GET', '/v1/admin/feedback', undefined, undefined, adminHeaders);
  expect(asUser.status === 401, 'app session accepted by admin API');
});

await test('sign-up requires accepting the Terms', async () => {
  const r = await call(null, 'POST', '/v1/auth/signup', { email: 'new-person@example.com', password: 'Str0ng-pass-123' });
  expect(r.status === 422 && r.json.error.code === 'terms_not_accepted' || r.status === 503, `signup: ${r.status} ${r.text}`);
});

console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? `: ${failures.join('; ')}` : ''}`);
process.exit(failures.length ? 1 : 0);
