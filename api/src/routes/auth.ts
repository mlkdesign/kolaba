// Sign up → 6-digit e-mail code → verified → create a profile. Log in, log out, session, password reset.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { clientIP, createSession, currentUser, rateLimit, requireAuth } from '../lib/auth';
import { hashPassword, passwordProblem, verifyPassword } from '../lib/password';
import { fail, newId, newToken, now, sha256Hex, timingSafeEqual } from '../lib/util';
import { profilesOf } from './profiles';
import { isBannedEmail, monetizationEnabled } from '../lib/moderation';

/** The Terms of Service / Privacy Policy version a new account accepts (bump when the documents change). */
export const TERMS_VERSION = '2026-11-09';
import { GoogleTokenError, verifyGoogleIdToken } from '../lib/google';

const auth = new Hono<AppEnv>();

const Credentials = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) });
const CodeBody = z.object({ email: z.string().trim().toLowerCase().email().max(254), code: z.string().regex(/^\d{6}$/) });

const CODE_TTL = 15 * 60_000;
/** FEATURE 115: a password reset code lives 10 minutes; a new one only after 30 seconds; a verified code gives a
 *  one-time reset token for 10 minutes. */
const RESET_CODE_TTL = 10 * 60_000;
const RESEND_AFTER_MS = 30_000;
const RESET_TOKEN_TTL = 10 * 60_000;
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
    .bind(newId('code'), userId, purpose, await sha256Hex(`${userId}:${code}`), now() + (purpose === 'reset' ? RESET_CODE_TTL : CODE_TTL), now()).run();
  const inbox = env.TEST_CODE_INBOX?.trim().toLowerCase();
  const subject = (purpose === 'verify' ? 'Your kolaba. verification code' : 'Reset your kolaba. password')
    + (inbox && inbox !== email ? ` — for ${email} (closed test)` : '');
  await sendEmail(env, inbox || email, subject,
    `${purpose === 'verify' ? 'Verification' : 'Password reset'} code: ${code}\n\nIt expires in ${purpose === 'reset' ? 10 : 15} minutes. ` +
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

/** Who may switch their own PRO for testing: an admin, an address in PRO_TEST_EMAILS, or — while the closed test
 *  runs (TEST_CODE_INBOX) — an account verified through the test inbox (only the team can complete those sign-ups). */
export function canTestPro(env: Env, u: { role: string; email: string; email_verification: string | null }) {
  const testers = (env.PRO_TEST_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return u.role === 'admin' || testers.includes(u.email.toLowerCase()) || (!!env.TEST_CODE_INBOX && u.email_verification === 'test_inbox');
}

async function sessionPayload(env: Env, userId: string, token: string) {
  const user = await env.DB.prepare(`SELECT id, email, role, is_demo, email_verified_at, email_verification FROM users WHERE id = ?`).bind(userId)
    .first<{ id: string; email: string; role: string; is_demo: number; email_verified_at: number | null; email_verification: string | null }>();
  return {
    token,
    user: { id: user!.id, email: user!.email, role: user!.role, isDemo: user!.is_demo === 1, verified: Boolean(user!.email_verified_at),
            emailProof: user!.email_verification ?? (user!.email_verified_at ? 'owner' : null),
            canTestPro: monetizationEnabled(env) && canTestPro(env, user!), monetizationEnabled: monetizationEnabled(env) },
    profiles: await profilesOf(env, userId),
  };
}

auth.post('/signup', async (c) => {
  await rateLimit(c, 'RL_AUTH', `signup:${clientIP(c)}`);
  const raw = await c.req.json();
  const { email, password } = Credentials.parse(raw);
  // Creating an account means accepting the Terms of Service and acknowledging the Privacy Policy (both linked on the form).
  if (raw?.acceptTerms !== true) fail(422, 'terms_not_accepted');
  const problem = passwordProblem(password);
  if (problem) fail(422, problem);
  if (await isBannedEmail(c.env, email)) fail(403, 'registration_blocked');
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
    await c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, password_scheme = ?, terms_accepted_at = ?, terms_version = ?,
        updated_at = ? WHERE id = ?`).bind(hash, salt, scheme, now(), TERMS_VERSION, now(), userId).run();
  } else {
    userId = newId('usr');
    await c.env.DB.prepare(`INSERT INTO users (id, email, password_hash, password_salt, password_scheme, terms_accepted_at, terms_version,
                            created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(userId, email, hash, salt, scheme, now(), TERMS_VERSION, now(), now()).run();
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
  // Not verified yet: the right password sends a fresh code at once (the verify screen that follows expects one —
  // before, it came only after Resend). The resend limit applies, so this can't be used to flood an inbox.
  if (!user!.email_verified_at) {
    await rateLimit(c, 'RL_AUTH', `resend:${email}`);
    await issueCode(c.env, user!.id, email, 'verify');
    return c.json({ status: 'verification_required', email, codeSent: true }, 403);
  }
  await c.env.DB.prepare(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?`).bind(user!.id).run();
  const token = await createSession(c.env.DB, user!.id, c.req.header('User-Agent'));
  return c.json(await sessionPayload(c.env, user!.id, token));
});

// POST /v1/auth/google {credential, password?} — Sign in with Google (an ID token from Google Identity Services).
// The token is verified here (signature, issuer, audience = our Web client id, expiry, verified e-mail); its `sub`
// is the Google account. 1) A linked Google account signs in. 2) An address that already has a KOLABA account is
// never merged by e-mail alone: the person proves the account with its password (`password`), then Google is linked
// to it — profiles, posts, contacts, messages and PRO stay as they are. (An address that was only started with a
// password and never verified, with no profile, belongs to whoever proves the address: Google's verified e-mail does,
// and that empty sign-up is taken over.) 3) A new address creates a KOLABA user — no OTP, Google has verified it —
// who continues to the usual onboarding (no profile yet).
auth.post('/google', async (c) => {
  await rateLimit(c, 'RL_AUTH', `google:${clientIP(c)}`);
  const clientId = c.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) fail(503, 'google_unavailable', 'Google sign-in is not configured.');
  const body = z.object({ credential: z.string().min(20).max(8192), password: z.string().min(1).max(200).optional(),
                          acceptTerms: z.boolean().optional() }).parse(await c.req.json());
  let claims;
  try { claims = await verifyGoogleIdToken(body.credential, clientId!, c.env.GOOGLE_JWKS_URL || undefined); }
  catch (e) { fail(401, 'google_token_invalid', e instanceof GoogleTokenError ? e.message : 'invalid'); }
  const { sub, email } = claims!;
  const ua = c.req.header('User-Agent');
  const signIn = async (userId: string, isNew: boolean) => {
    const token = await createSession(c.env.DB, userId, ua);
    // The name on the Google account, for the onboarding to start from (shown and editable there, never stored here).
    return c.json({ ...(await sessionPayload(c.env, userId, token)), isNew, google: { name: claims!.name?.trim().slice(0, 80) || null } });
  };

  // 1) Already linked.
  const linked = await c.env.DB.prepare(`SELECT u.id, u.status FROM auth_identities i JOIN users u ON u.id = i.user_id
      WHERE i.provider = 'google' AND i.provider_user_id = ?`).bind(sub).first<{ id: string; status: string }>();
  if (linked) {
    if (linked.status !== 'active') fail(403, 'account_suspended');
    return signIn(linked.id, false);
  }

  const addIdentity = (userId: string) => c.env.DB.prepare(`INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email, created_at)
      VALUES (?, ?, 'google', ?, ?, ?)`).bind(newId('aid'), userId, sub, email, now()).run();

  // 2) The address already has an account.
  const existing = await c.env.DB.prepare(`SELECT id, password_hash, password_salt, password_scheme, email_verified_at, status, is_demo,
      failed_logins, locked_until, (SELECT COUNT(*) FROM profiles p WHERE p.owner_user_id = users.id) AS profiles
      FROM users WHERE email = ?`).bind(email)
    .first<{ id: string; password_hash: string | null; password_salt: string | null; password_scheme: string | null; email_verified_at: number | null;
             status: string; is_demo: number; failed_logins: number; locked_until: number | null; profiles: number }>();
  if (existing) {
    if (existing.status !== 'active') fail(403, 'account_suspended');
    const other = await c.env.DB.prepare(`SELECT 1 AS ok FROM auth_identities WHERE user_id = ? AND provider = 'google'`).bind(existing.id).first();
    if (other) fail(409, 'google_other_account_linked', 'This KOLABA account is linked to a different Google account.');
    if (!existing.email_verified_at && !existing.profiles && !existing.is_demo) {
      // An unfinished password sign-up: the verified Google owner of the address takes it (nothing in it to merge).
      await c.env.DB.prepare(`UPDATE users SET password_hash = NULL, password_salt = NULL, password_scheme = NULL, email_verified_at = ?,
          email_verification = 'google', failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?`).bind(now(), now(), existing.id).run();
      await c.env.DB.prepare(`UPDATE email_codes SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL`).bind(now(), existing.id).run();
      await addIdentity(existing.id);
      return signIn(existing.id, true);
    }
    if (existing.is_demo) fail(403, 'demo_account');
    if (!body.password) return c.json({ error: { code: 'google_link_required', message: 'Sign in with your password to link Google.' }, email }, 409);
    await rateLimit(c, 'RL_AUTH', `login:${email}`);
    if (existing.locked_until && existing.locked_until > now()) fail(429, 'account_locked');
    const ok = existing.password_hash && existing.password_salt && existing.password_scheme
      ? await verifyPassword(body.password!, existing.password_hash, existing.password_salt, existing.password_scheme) : false;
    if (!ok) {
      const failed = existing.failed_logins + 1;
      await c.env.DB.prepare(`UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?`)
        .bind(failed >= MAX_FAILED_LOGINS ? 0 : failed, failed >= MAX_FAILED_LOGINS ? now() + LOCK_MS : null, existing.id).run();
      fail(401, 'invalid_credentials');
    }
    // The password proves the account, Google proves the address: link, and the address counts as verified.
    await c.env.DB.prepare(`UPDATE users SET failed_logins = 0, locked_until = NULL, email_verified_at = COALESCE(email_verified_at, ?),
        email_verification = CASE WHEN email_verification IS NULL OR email_verification = 'test_inbox' THEN 'google' ELSE email_verification END,
        updated_at = ? WHERE id = ?`).bind(now(), now(), existing.id).run();
    await addIdentity(existing.id);
    return signIn(existing.id, false);
  }

  // 3) A new person: only with the Terms accepted on the sign-up screen, never a banned address.
  if (await isBannedEmail(c.env, email)) fail(403, 'registration_blocked');
  if (body.acceptTerms !== true) fail(422, 'terms_not_accepted');
  const allowed = (c.env.SIGNUP_ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!c.env.TEST_CODE_INBOX && allowed.length && !allowed.includes(email)) fail(403, 'registration_invite_only');
  const dayStart = Math.floor(now() / 86_400_000) * 86_400_000;
  const today = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_demo = 0 AND created_at >= ?`).bind(dayStart).first<{ n: number }>();
  if ((today?.n ?? 0) >= Number(c.env.SIGNUPS_PER_DAY || 50)) fail(429, 'signups_paused');
  const userId = newId('usr');
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO users (id, email, email_verified_at, email_verification, terms_accepted_at, terms_version, created_at, updated_at)
        VALUES (?, ?, ?, 'google', ?, ?, ?, ?)`).bind(userId, email, now(), now(), TERMS_VERSION, now(), now()),
    c.env.DB.prepare(`INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, 'google', ?, ?, ?)`)
      .bind(newId('aid'), userId, sub, email, now()),
  ]);
  return signIn(userId, true);
});

auth.post('/logout', requireAuth, async (c) => {
  await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(currentUser(c).sessionId).run();
  return c.json({ status: 'signed_out' });
});

auth.get('/session', requireAuth, async (c) => {
  const user = currentUser(c);
  return c.json(await sessionPayload(c.env, user.id, ''));
});

// ─── Password recovery (FEATURE 115): Forgot → code (e-mail) → verify → one-time reset token → new password ───

/** Seconds until another reset code may be sent to this account (0: now). */
async function resetCooldown(env: Env, userId: string): Promise<number> {
  const last = await env.DB.prepare(`SELECT created_at FROM email_codes WHERE user_id = ? AND purpose = 'reset'
      ORDER BY created_at DESC LIMIT 1`).bind(userId).first<{ created_at: number }>();
  return last ? Math.max(0, Math.ceil((last.created_at + RESEND_AFTER_MS - now()) / 1000)) : 0;
}

// POST /v1/auth/password/forgot {email} — the same answer whether or not the address has an account. A new code
// replaces the previous one (only one is ever valid); within 30 s of the last one nothing new is sent.
auth.post('/password/forgot', async (c) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(await c.req.json());
  await rateLimit(c, 'RL_AUTH', `forgot-ip:${clientIP(c)}`);
  await rateLimit(c, 'RL_AUTH', `forgot:${email}`);
  const user = await c.env.DB.prepare(`SELECT id, password_hash FROM users WHERE email = ? AND status = 'active' AND is_demo = 0
      AND email_verified_at IS NOT NULL`).bind(email).first<{ id: string; password_hash: string | null }>();
  let resendAfter = RESEND_AFTER_MS / 1000;
  if (user) {
    const wait = await resetCooldown(c.env, user.id);
    if (wait > 0) {
      resendAfter = wait;
    } else if (user.password_hash) {
      await issueCode(c.env, user.id, email, 'reset');
    } else {
      // Google / Apple only: no password to reset — and none is invented. The e-mail says how this account signs in.
      const methods = await c.env.DB.prepare(`SELECT provider FROM auth_identities WHERE user_id = ?`).bind(user.id).all<{ provider: string }>();
      const names = methods.results.map((m) => (m.provider === 'google' ? 'Google' : m.provider === 'apple' ? 'Apple' : m.provider));
      const inbox = c.env.TEST_CODE_INBOX?.trim().toLowerCase();
      await c.env.DB.prepare(`INSERT INTO email_codes (id, user_id, purpose, code_hash, expires_at, consumed_at, created_at)
          VALUES (?, ?, 'reset', '', ?, ?, ?)`).bind(newId('code'), user.id, now(), now(), now()).run(); // cooldown marker
      await sendEmail(c.env, inbox || email, 'Signing in to kolaba.',
        `Your kolaba. account has no password: it signs in with ${names.join(' or ') || 'a linked account'}.\n` +
        `Use that button on the Log in screen.\n\nIf you didn't ask for this, ignore this e-mail.`);
    }
  }
  return c.json({ status: 'sent', resendAfter });
});

// POST /v1/auth/password/verify {email, code} → {resetToken} (five wrong tries end the code).
auth.post('/password/verify', async (c) => {
  await rateLimit(c, 'RL_AUTH', `reset-verify:${clientIP(c)}`);
  const { email, code } = CodeBody.parse(await c.req.json());
  await rateLimit(c, 'RL_AUTH', `reset-verify:${email}`);
  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ? AND status = 'active' AND is_demo = 0`).bind(email)
    .first<{ id: string }>();
  if (!user) fail(400, 'code_invalid');
  await checkCode(c.env, user!.id, 'reset', code);
  const token = newToken();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).bind(now(), user!.id),
    c.env.DB.prepare(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(newId('rst'), user!.id, await sha256Hex(token), now() + RESET_TOKEN_TTL, now()),
  ]);
  return c.json({ resetToken: token, expiresAt: now() + RESET_TOKEN_TTL });
});

// POST /v1/auth/password/reset {resetToken, password} — sets the new password once; every session ends (signed out
// everywhere), old codes and tokens stop working. (The old one-step body {email, code, password} still works.)
auth.post('/password/reset', async (c) => {
  await rateLimit(c, 'RL_AUTH', `reset:${clientIP(c)}`);
  const raw = await c.req.json();
  const password = z.string().min(1).max(200).parse(raw?.password);
  const problem = passwordProblem(password);
  if (problem) fail(422, problem);
  let userId: string;
  let tokenId: string | null = null;
  if (typeof raw?.resetToken === 'string') {
    const row = await c.env.DB.prepare(`SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?`)
      .bind(await sha256Hex(raw.resetToken)).first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>();
    if (!row || row.used_at || row.expires_at < now()) fail(400, 'reset_token_expired');
    userId = row!.user_id;
    tokenId = row!.id;
  } else {
    const body = CodeBody.parse(raw);
    const user = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ? AND is_demo = 0`).bind(body.email).first<{ id: string }>();
    if (!user) fail(400, 'code_invalid');
    await checkCode(c.env, user!.id, 'reset', body.code);
    userId = user!.id;
  }
  const { hash, salt, scheme } = await hashPassword(password);
  const t = now();
  const consumed = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL AND (?3 IS NULL OR id = ?3)`)
      .bind(t, userId, tokenId),
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, password_scheme = ?, failed_logins = 0,
                      locked_until = NULL, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`)
      .bind(hash, salt, scheme, t, t, userId),
    c.env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).bind(t, userId),
    c.env.DB.prepare(`UPDATE email_codes SET consumed_at = ? WHERE user_id = ? AND purpose = 'reset' AND consumed_at IS NULL`).bind(t, userId),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId), // signs out everywhere
  ]);
  // Two requests with the same token: only the first one finds it unused.
  if (tokenId && !consumed[0].meta.changes) fail(400, 'reset_token_expired');
  const email = await c.env.DB.prepare(`SELECT email FROM users WHERE id = ?`).bind(userId).first<{ email: string }>();
  if (email) {
    const inbox = c.env.TEST_CODE_INBOX?.trim().toLowerCase();
    try {
      await sendEmail(c.env, inbox || email.email, 'Your kolaba. password was changed',
        `The password of your kolaba. account${inbox && inbox !== email.email ? ` (${email.email})` : ''} was just changed, and every ` +
        `device was signed out.\n\nIf it wasn't you, reset your password again right away from the Log in screen.`);
    } catch { /* the password is changed either way */ }
  }
  return c.json({ status: 'password_changed' });
});

export default auth;
