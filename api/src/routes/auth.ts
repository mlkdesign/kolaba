// Sign up → 6-digit e-mail code → verified → create a profile. Log in, log out, session, password reset.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { clientIP, createSession, currentUser, rateLimit, requireAuth } from '../lib/auth';
import { hashPassword, passwordProblem, verifyPassword } from '../lib/password';
import { fail, newId, now, sha256Hex, timingSafeEqual } from '../lib/util';
import { profilesOf } from './profiles';

const auth = new Hono<AppEnv>();

const Credentials = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) });
const CodeBody = z.object({ email: z.string().trim().toLowerCase().email().max(254), code: z.string().regex(/^\d{6}$/) });

const CODE_TTL = 15 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_FAILED_LOGINS = 8;
const LOCK_MS = 15 * 60_000;

function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, '0');
}

async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
  if (!env.RESEND_API_KEY) fail(503, 'email_unavailable', 'E-mail delivery is not configured yet.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) {
    console.error('resend failed', res.status, await res.text());
    fail(503, 'email_failed');
  }
}

async function issueCode(env: Env, userId: string, email: string, purpose: 'verify' | 'reset') {
  const code = newCode();
  await env.DB.prepare(`UPDATE email_codes SET consumed_at = ? WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`)
    .bind(now(), userId, purpose).run();
  await env.DB.prepare(`INSERT INTO email_codes (id, user_id, purpose, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(newId('code'), userId, purpose, await sha256Hex(`${userId}:${code}`), now() + CODE_TTL, now()).run();
  const inbox = env.TEST_CODE_INBOX?.trim().toLowerCase();
  const subject = (purpose === 'verify' ? 'Your kolaba. verification code' : 'Reset your kolaba. password')
    + (inbox && inbox !== email ? ` — for ${email} (closed test)` : '');
  await sendEmail(env, inbox || email, subject,
    `${purpose === 'verify' ? 'Verification' : 'Password reset'} code: ${code}\n\nIt expires in 15 minutes. ` +
    `If you didn't ask for it, ignore this e-mail.\n\nkolaba. — test environment`);
}

/** Checks a code; consumes it on success. Wrong codes count; after 5 the code is dead. */
async function checkCode(env: Env, userId: string, purpose: 'verify' | 'reset', code: string): Promise<void> {
  const row = await env.DB.prepare(`SELECT id, code_hash, attempts, expires_at FROM email_codes
      WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .bind(userId, purpose).first<{ id: string; code_hash: string; attempts: number; expires_at: number }>();
  if (!row || row.expires_at < now() || row.attempts >= MAX_CODE_ATTEMPTS) fail(400, 'code_expired');
  if (!timingSafeEqual(row!.code_hash, await sha256Hex(`${userId}:${code}`))) {
    await env.DB.prepare(`UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?`).bind(row!.id).run();
    fail(400, 'code_invalid');
  }
  await env.DB.prepare(`UPDATE email_codes SET consumed_at = ? WHERE id = ?`).bind(now(), row!.id).run();
}

async function sessionPayload(env: Env, userId: string, token: string) {
  const user = await env.DB.prepare(`SELECT id, email, role, is_demo, email_verified_at, email_verification FROM users WHERE id = ?`).bind(userId)
    .first<{ id: string; email: string; role: string; is_demo: number; email_verified_at: number | null; email_verification: string | null }>();
  const proTesters = (env.PRO_TEST_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return {
    token,
    user: { id: user!.id, email: user!.email, role: user!.role, isDemo: user!.is_demo === 1, verified: Boolean(user!.email_verified_at),
            emailProof: user!.email_verification ?? (user!.email_verified_at ? 'owner' : null),
            canTestPro: user!.role === 'admin' || proTesters.includes(user!.email.toLowerCase()) },
    profiles: await profilesOf(env, userId),
  };
}

auth.post('/signup', async (c) => {
  await rateLimit(c, 'RL_AUTH', `signup:${clientIP(c)}`);
  const { email, password } = Credentials.parse(await c.req.json());
  const problem = passwordProblem(password);
  if (problem) fail(422, problem);
  if (!c.env.RESEND_API_KEY) fail(503, 'registration_closed', 'Registration opens once e-mail delivery is configured.');
  // Closed test: any address may sign up — its code goes to the test inbox, so only the team can complete it.
  const allowed = (c.env.SIGNUP_ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!c.env.TEST_CODE_INBOX && allowed.length && !allowed.includes(email)) fail(403, 'registration_invite_only');
  // Public demo protection: a daily cap on new real accounts.
  const dayStart = Math.floor(now() / 86_400_000) * 86_400_000;
  const today = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_demo = 0 AND created_at >= ?`).bind(dayStart)
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= Number(c.env.SIGNUPS_PER_DAY || 50)) fail(429, 'signups_paused');

  const existing = await c.env.DB.prepare(`SELECT id, email_verified_at FROM users WHERE email = ?`).bind(email)
    .first<{ id: string; email_verified_at: number | null }>();
  if (existing?.email_verified_at) fail(409, 'email_taken');
  const { hash, salt, scheme } = await hashPassword(password);
  let userId = existing?.id;
  if (userId) {
    // An unverified sign-up again: new password, new code (the address owner proves it with the code).
    await c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, password_scheme = ?, updated_at = ? WHERE id = ?`)
      .bind(hash, salt, scheme, now(), userId).run();
  } else {
    userId = newId('usr');
    await c.env.DB.prepare(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(userId, email, hash, salt, scheme, now(), now()).run();
  }
  await issueCode(c.env, userId, email, 'verify');
  return c.json({ status: 'verification_sent', email }, 201);
});

auth.post('/verify', async (c) => {
  await rateLimit(c, 'RL_AUTH', `verify:${clientIP(c)}`);
  const { email, code } = CodeBody.parse(await c.req.json());
  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ? AND status = 'active'`).bind(email).first<{ id: string }>();
  if (!user) fail(400, 'code_invalid');
  await checkCode(c.env, user!.id, 'verify', code);
  // The code went to the address's owner — or, in the closed test, to the shared inbox (the address is not proven).
  const viaInbox = Boolean(c.env.TEST_CODE_INBOX) && c.env.TEST_CODE_INBOX!.trim().toLowerCase() !== email;
  await c.env.DB.prepare(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ?,
      email_verification = COALESCE(email_verification, ?) WHERE id = ?`)
    .bind(now(), now(), viaInbox ? 'test_inbox' : 'owner', user!.id).run();
  const token = await createSession(c.env.DB, user!.id, c.req.header('User-Agent'));
  return c.json(await sessionPayload(c.env, user!.id, token));
});

auth.post('/resend-code', async (c) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(await c.req.json());
  await rateLimit(c, 'RL_AUTH', `resend:${email}`);
  const user = await c.env.DB.prepare(`SELECT id, email_verified_at FROM users WHERE email = ?`).bind(email)
    .first<{ id: string; email_verified_at: number | null }>();
  if (user && !user.email_verified_at) await issueCode(c.env, user.id, email, 'verify');
  return c.json({ status: 'sent' }); // same answer either way (no account enumeration)
});

auth.post('/login', async (c) => {
  const { email, password } = Credentials.parse(await c.req.json());
  await rateLimit(c, 'RL_AUTH', `login:${clientIP(c)}`);
  await rateLimit(c, 'RL_AUTH', `login:${email}`);
  const user = await c.env.DB.prepare(`SELECT id, password_hash, password_salt, password_scheme, email_verified_at, status,
                                              failed_logins, locked_until FROM users WHERE email = ?`).bind(email)
    .first<{ id: string; password_hash: string | null; password_salt: string | null; password_scheme: string | null;
             email_verified_at: number | null; status: string; failed_logins: number; locked_until: number | null }>();
  if (user?.locked_until && user.locked_until > now()) fail(429, 'account_locked');
  const ok = user?.password_hash && user.password_salt && user.password_scheme
    ? await verifyPassword(password, user.password_hash, user.password_salt, user.password_scheme)
    : (await hashPassword(password), false); // same work either way (timing)
  if (!ok || !user) {
    if (user) {
      const failed = user.failed_logins + 1;
      await c.env.DB.prepare(`UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?`)
        .bind(failed >= MAX_FAILED_LOGINS ? 0 : failed, failed >= MAX_FAILED_LOGINS ? now() + LOCK_MS : null, user.id).run();
    }
    fail(401, 'invalid_credentials');
  }
  if (user!.status !== 'active') fail(403, 'account_suspended');
  if (!user!.email_verified_at) return c.json({ status: 'verification_required', email }, 403);
  await c.env.DB.prepare(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?`).bind(user!.id).run();
  const token = await createSession(c.env.DB, user!.id, c.req.header('User-Agent'));
  return c.json(await sessionPayload(c.env, user!.id, token));
});

auth.post('/logout', requireAuth, async (c) => {
  await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(currentUser(c).sessionId).run();
  return c.json({ status: 'signed_out' });
});

auth.get('/session', requireAuth, async (c) => {
  const user = currentUser(c);
  return c.json(await sessionPayload(c.env, user.id, ''));
});

auth.post('/password/forgot', async (c) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(await c.req.json());
  await rateLimit(c, 'RL_AUTH', `forgot:${email}`);
  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ? AND status = 'active' AND is_demo = 0`).bind(email)
    .first<{ id: string }>();
  if (user) await issueCode(c.env, user.id, email, 'reset');
  return c.json({ status: 'sent' });
});

auth.post('/password/reset', async (c) => {
  await rateLimit(c, 'RL_AUTH', `reset:${clientIP(c)}`);
  const body = CodeBody.extend({ password: z.string().min(1).max(200) }).parse(await c.req.json());
  const problem = passwordProblem(body.password);
  if (problem) fail(422, problem);
  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ? AND is_demo = 0`).bind(body.email).first<{ id: string }>();
  if (!user) fail(400, 'code_invalid');
  await checkCode(c.env, user!.id, 'reset', body.code);
  const { hash, salt, scheme } = await hashPassword(body.password);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, password_scheme = ?, failed_logins = 0,
                      locked_until = NULL, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`)
      .bind(hash, salt, scheme, now(), now(), user!.id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(user!.id), // signs out everywhere
  ]);
  return c.json({ status: 'password_changed' });
});

export default auth;
