// Production email verification end-to-end checks. Starts a local Worker and a local Resend-compatible capture
// server, uses only local D1, and never contacts Resend or production Cloudflare resources.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = resolve(API_DIR, 'node_modules/.bin/wrangler');
const API = 'http://127.0.0.1:8799';
const RESEND_PORT = 8800;
const PASSWORD = 'Production!Otp42';
const WRANGLER_REGISTRY_PATH = `/tmp/kolaba-otp-wrangler-registry-${process.pid}`;
const messages = [];

const resend = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  messages.push(JSON.parse(body));
  response.writeHead(200, { 'Content-Type': 'application/json', 'x-request-id': `local-${messages.length}` });
  response.end(JSON.stringify({ id: `email-${messages.length}` }));
});
resend.listen(RESEND_PORT, '127.0.0.1');
await once(resend, 'listening');

const worker = spawn(WRANGLER, ['dev', '--env', 'local', '--port', '8799', '--ip', '127.0.0.1',
  '--var', 'RESEND_API_KEY:local-test-key',
  '--var', 'OTP_HASH_SECRET:local-test-secret-that-is-longer-than-thirty-two-characters',
  '--var', `RESEND_API_URL:http://127.0.0.1:${RESEND_PORT}`], {
  cwd: API_DIR,
  env: { ...process.env, WRANGLER_LOG_PATH: '/tmp/kolaba-otp-test-wrangler.log', WRANGLER_REGISTRY_PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let workerOutput = '';
worker.stdout.on('data', (chunk) => { workerOutput += chunk; });
worker.stderr.on('data', (chunk) => { workerOutput += chunk; });

const waitForWorker = async () => {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${API}/v1/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Worker did not start:\n${workerOutput}`);
};

const request = async (method, path, body, token) => {
  const headers = { Origin: 'http://localhost:5173' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(API + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, text };
};

const sql = (command) => JSON.parse(execFileSync(WRANGLER,
  ['d1', 'execute', 'kolaba-db', '--local', '--env', 'local', '--json', '--command', command],
  { cwd: API_DIR, encoding: 'utf8', env: { ...process.env, WRANGLER_LOG_PATH: '/tmp/kolaba-otp-test-d1.log', WRANGLER_REGISTRY_PATH } }))[0].results;

const codeFrom = (message) => />(\d{6})<\/div>/.exec(message.html)?.[1];
const lastFor = (email) => [...messages].reverse().find((message) => message.to?.[0] === email);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expectStatus = (response, status, name) => assert(response.status === status, `${name}: ${response.status} ${response.text}`);

let passed = 0;
const test = async (name, operation) => {
  await operation();
  passed++;
  console.log(`  ✓ ${name}`);
};

try {
  await waitForWorker();
  const stamp = Date.now();
  const email = `otp.production.${stamp}@example.com`;
  const resendEmail = `otp.resend.${stamp}@example.com`;
  const changedEmail = `otp.changed.${stamp}@example.com`;
  let token;

  await test('registration sends branded OTP to the exact user address and stores only an HMAC', async () => {
    const response = await request('POST', '/v1/auth/signup', { email, password: PASSWORD, acceptTerms: true });
    expectStatus(response, 201, 'signup');
    const message = lastFor(email);
    assert(message, 'registration email missing');
    assert(message.from === 'KOLABA <verify@kolaba.app>', `unexpected sender: ${message.from}`);
    assert(message.html.includes('KOLABA') && message.html.includes('@media') === false, 'branded responsive email missing');
    const [row] = sql(`SELECT code_hash FROM email_codes c JOIN users u ON u.id = c.user_id WHERE u.email = '${email}' AND c.purpose = 'verify' ORDER BY c.created_at DESC LIMIT 1`);
    assert(row.code_hash.startsWith('hmac:v1:'), 'OTP is not HMAC protected');
    assert(!row.code_hash.includes(codeFrom(message)), 'stored hash contains OTP');
  });

  await test('verification is one-time and login remains compatible', async () => {
    const code = codeFrom(lastFor(email));
    const verified = await request('POST', '/v1/auth/verify', { email, code });
    expectStatus(verified, 200, 'verify');
    token = verified.json.token;
    const reused = await request('POST', '/v1/auth/verify', { email, code });
    assert(reused.json?.error?.code === 'code_expired', `OTP reuse was accepted: ${reused.text}`);
    expectStatus(await request('POST', '/v1/auth/login', { email, password: PASSWORD }), 200, 'login');
  });

  await test('resend keeps 30-second cooldown and sends only to the requested address', async () => {
    expectStatus(await request('POST', '/v1/auth/signup', { email: resendEmail, password: PASSWORD, acceptTerms: true }), 201, 'signup resend');
    const firstCount = messages.filter((message) => message.to?.[0] === resendEmail).length;
    expectStatus(await request('POST', '/v1/auth/resend-code', { email: resendEmail }), 200, 'cooldown resend');
    assert(messages.filter((message) => message.to?.[0] === resendEmail).length === firstCount, 'cooldown sent another email');
    sql(`UPDATE email_codes SET created_at = created_at - 31000 WHERE user_id = (SELECT id FROM users WHERE email = '${resendEmail}')`);
    expectStatus(await request('POST', '/v1/auth/resend-code', { email: resendEmail }), 200, 'resend');
    assert(messages.filter((message) => message.to?.[0] === resendEmail).length === firstCount + 1, 'resend email missing');
  });

  await test('email change verifies current and new addresses independently', async () => {
    const started = await request('POST', '/v1/auth/email/change', { email: changedEmail }, token);
    expectStatus(started, 200, 'email change');
    const currentCode = codeFrom(lastFor(email));
    const next = await request('POST', '/v1/auth/email/change/verify', { code: currentCode }, token);
    expectStatus(next, 200, 'current email verify');
    assert(next.json.step === 'new', next.text);
    const newCode = codeFrom(lastFor(changedEmail));
    const completed = await request('POST', '/v1/auth/email/change/verify', { code: newCode }, token);
    expectStatus(completed, 200, 'new email verify');
    assert(completed.json.email === changedEmail, completed.text);
  });

  await test('password reset delivers OTP, rejects reuse and accepts the new password', async () => {
    const forgot = await request('POST', '/v1/auth/password/forgot', { email: changedEmail });
    expectStatus(forgot, 200, 'forgot password');
    assert(forgot.json.resendAfter === 30, forgot.text);
    const code = codeFrom(lastFor(changedEmail));
    const verified = await request('POST', '/v1/auth/password/verify', { email: changedEmail, code });
    expectStatus(verified, 200, 'reset verify');
    const reused = await request('POST', '/v1/auth/password/verify', { email: changedEmail, code });
    assert(reused.json?.error?.code === 'code_expired', reused.text);
    const reset = await request('POST', '/v1/auth/password/reset', { resetToken: verified.json.resetToken, password: 'Changed!Otp84' });
    expectStatus(reset, 200, 'password reset');
    expectStatus(await request('POST', '/v1/auth/login', { email: changedEmail, password: 'Changed!Otp84' }), 200, 'login after reset');
  });

  await test('unknown reset and resend requests do not disclose account existence', async () => {
    const unknown = `unknown.${stamp}@example.com`;
    const forgot = await request('POST', '/v1/auth/password/forgot', { email: unknown });
    const resendResult = await request('POST', '/v1/auth/resend-code', { email: unknown });
    expectStatus(forgot, 200, 'unknown forgot');
    expectStatus(resendResult, 200, 'unknown resend');
    assert(!lastFor(unknown), 'email was sent to an unknown account');
  });

  console.log(`\n${passed} production email verification tests passed`);
} finally {
  worker.kill('SIGTERM');
  resend.close();
}
