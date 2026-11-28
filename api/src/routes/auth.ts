// Sign up → 6-digit e-mail code → verified → create a profile. Log in, log out, session, password reset.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { clientIP, createSession, currentUser, rateLimit, requireAuth } from '../lib/auth';
import { hashPassword, passwordProblem, verifyPassword } from '../lib/password';
import { fail, newId, newToken, now, sha256Hex } from '../lib/util';
import { profilesOf } from './profiles';
import { notifyAccount } from '../lib/cards';
import { isBannedEmail, monetizationEnabled } from '../lib/moderation';
import { canSendEmail, sendEmail } from '../lib/email';
import { hashOTP, newOTPCode, verifyOTP } from '../lib/otp';

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

async function issueCode(env: Env, userId: string, email: string, purpose: 'verify' | 'reset') {
  const code = newOTPCode();
  const id = newId('code');
  const expiresAt = now() + (purpose === 'reset' ? RESET_CODE_TTL : CODE_TTL);
  await env.DB.prepare(`UPDATE email_codes SET consumed_at = ? WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`)
    .bind(now(), userId, purpose).run();
  await env.DB.prepare(`INSERT INTO email_codes (id, user_id, purpose, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, userId, purpose, await hashOTP(env, { userId, purpose, recordId: id, expiresAt, code }), expiresAt, now()).run();
  const message = purpose === 'verify' ? {
    subject: 'Verify your KOLABA email',
    title: 'Verify your email',
    intro: 'Use this six-digit code to finish setting up your KOLABA account.',
    code,
    detail: 'This code expires in 15 minutes and can be used only once.',
    warning: 'If you did not request this code, you can safely ignore this email.',
  } : {
    subject: 'Reset your KOLABA password',
    title: 'Reset your password',
    intro: 'Use this six-digit code to continue resetting your KOLABA password.',
    code,
    detail: 'This code expires in 10 minutes and can be used only once.',
    warning: 'If you did not request a password reset, secure your account and contact support.',
  };
  try {
    await sendEmail(env, email, message);
  } catch (error) {
    await env.DB.prepare(`UPDATE email_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`).bind(now(), id).run();
    throw error;
  }
}

/** Checks a code; consumes it on success. Wrong codes count; after 5 the code is dead. */
async function checkCode(env: Env, userId: string, purpose: 'verify' | 'reset', code: string): Promise<void> {
  const row = await env.DB.prepare(`SELECT id, code_hash, attempts, expires_at FROM email_codes
      WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .bind(userId, purpose).first<{ id: string; code_hash: string; attempts: number; expires_at: number }>();
  if (!row || row.expires_at < now() || row.attempts >= MAX_CODE_ATTEMPTS) fail(400, 'code_expired');
  if (!await verifyOTP(env, row!.code_hash, {
    userId, purpose, recordId: row!.id, expiresAt: row!.expires_at, code, legacyValue: `${userId}:${code}`,
  })) {
    await env.DB.prepare(`UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?`).bind(row!.id).run();
    fail(400, 'code_invalid');
  }
  await env.DB.prepare(`UPDATE email_codes SET consumed_at = ? WHERE id = ?`).bind(now(), row!.id).run();
}

/** Who may switch their own PRO for testing: an admin or an address in PRO_TEST_EMAILS. */
export function canTestPro(env: Env, u: { role: string; email: string; email_verification: string | null }) {
  const testers = (env.PRO_TEST_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return u.role === 'admin' || testers.includes(u.email.toLowerCase());
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

/** FEATURE 135: an account an administrator deleted doesn't hold its e-mail — registering with that address again
 *  frees it: the old account keeps all its data (its address moves to `released_email`, its Google link goes), and a
 *  new account is made. A blocked (suspended) or banned account keeps its address: no new account with it. */
async function releaseDeletedAccount(env: Env, email: string) {
  const old = await env.DB.prepare(`SELECT id FROM users WHERE email = ? AND status = 'deleted'`).bind(email).first<{ id: string }>();
  if (!old) return;
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET released_email = email, email = ?, updated_at = ? WHERE id = ?`)
      .bind(`deleted+${old.id}@users.kolaba.invalid`, now(), old.id),
    env.DB.prepare(`DELETE FROM auth_identities WHERE user_id = ?`).bind(old.id),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(old.id),
  ]);
}

auth.post('/signup', async (c) => {
  await rateLimit(c, 'RL_AUTH', `signup:${clientIP(c)}`);
  const raw = await c.req.json();
  const { email, password } = Credentials.parse(raw);
  await rateLimit(c, 'RL_AUTH', `signup-email:${email}`);
  // Creating an account means accepting the Terms of Service and acknowledging the Privacy Policy (both linked on the form).
  if (raw?.acceptTerms !== true) fail(422, 'terms_not_accepted');
  const problem = passwordProblem(password);
  if (problem) fail(422, problem);
  if (await isBannedEmail(c.env, email)) fail(403, 'registration_blocked');
  await releaseDeletedAccount(c.env, email);
  // A blocked account's address can't start a new account.
  const holder = await c.env.DB.prepare(`SELECT status FROM users WHERE email = ?`).bind(email).first<{ status: string }>();
  if (holder?.status === 'suspended') fail(403, 'account_suspended');
  if (!canSendEmail(c.env)) fail(503, 'registration_closed', 'Registration opens once e-mail delivery is configured.');
  // Public demo protection: a daily cap on new real accounts.
  const dayStart = Math.floor(now() / 86_400_000) * 86_400_000;
  const today = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_demo = 0 AND created_at >= ?`).bind(dayStart)
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= Number(c.env.SIGNUPS_PER_DAY || 50)) fail(429, 'signups_paused');

  const existing = await c.env.DB.prepare(`SELECT id, email_verified_at, status FROM users WHERE email = ?`).bind(email)
    .first<{ id: string; email_verified_at: number | null; status: string }>();
  // Same public answer for a new or existing active address. The existing account is not modified; proving ownership
  // of the delivered OTP signs its owner in, avoiding account enumeration without pretending an email was sent.
  if (existing?.email_verified_at) {
    await rateLimit(c, 'RL_AUTH', `signup-account:${existing.id}`);
    const wait = await verifyCooldown(c.env, existing.id);
    if (wait === 0) await issueCode(c.env, existing.id, email, 'verify');
    return c.json({ status: 'verification_sent', email }, 201);
  }
  if (existing?.id) {
    const wait = await verifyCooldown(c.env, existing.id);
    if (wait > 0) fail(429, 'resend_too_soon', undefined, { resendAfter: wait });
  }
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
  await rateLimit(c, 'RL_AUTH', `signup-account:${userId}`);
  await issueCode(c.env, userId, email, 'verify');
  return c.json({ status: 'verification_sent', email }, 201);
});

auth.post('/verify', async (c) => {
  await rateLimit(c, 'RL_AUTH', `verify:${clientIP(c)}`);
  const { email, code } = CodeBody.parse(await c.req.json());
  await rateLimit(c, 'RL_AUTH', `verify-email:${email}`);
  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ? AND status = 'active'`).bind(email).first<{ id: string }>();
  if (!user) fail(400, 'code_invalid');
  await rateLimit(c, 'RL_AUTH', `verify-account:${user!.id}`);
  await checkCode(c.env, user!.id, 'verify', code);
  await c.env.DB.prepare(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ?,
      email_verification = COALESCE(email_verification, ?) WHERE id = ?`)
    .bind(now(), now(), 'owner', user!.id).run();
  const token = await createSession(c.env.DB, user!.id, c.req.header('User-Agent'));
  return c.json(await sessionPayload(c.env, user!.id, token));
});

auth.post('/resend-code', async (c) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(await c.req.json());
  await rateLimit(c, 'RL_AUTH', `resend-ip:${clientIP(c)}`);
  await rateLimit(c, 'RL_AUTH', `resend-email:${email}`);
  const user = await c.env.DB.prepare(`SELECT id, email_verified_at FROM users WHERE email = ?`).bind(email)
    .first<{ id: string; email_verified_at: number | null }>();
  if (user && !user.email_verified_at) {
    await rateLimit(c, 'RL_AUTH', `resend-account:${user.id}`);
    if (await verifyCooldown(c.env, user.id) === 0) await issueCode(c.env, user.id, email, 'verify');
  }
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
  // FEATURE 135: a deleted account doesn't sign in (its address may be registered again).
  if (user?.status === 'deleted') fail(403, 'account_deleted');
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
    await rateLimit(c, 'RL_AUTH', `resend-ip:${clientIP(c)}`);
    await rateLimit(c, 'RL_AUTH', `resend-email:${email}`);
    await rateLimit(c, 'RL_AUTH', `resend-account:${user!.id}`);
    const wait = await verifyCooldown(c.env, user!.id);
    if (wait === 0) await issueCode(c.env, user!.id, email, 'verify');
    return c.json({ status: 'verification_required', email, codeSent: wait === 0 }, 403);
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
  // The Web client (Google Identity Services) and the iOS app's client (GoogleSignIn-iOS): one KOLABA account either way.
  const clientIds = [c.env.GOOGLE_CLIENT_ID, ...(c.env.GOOGLE_IOS_CLIENT_IDS ?? '').split(',')].map((v) => v?.trim() ?? '').filter(Boolean);
  if (!clientIds.length) fail(503, 'google_unavailable', 'Google sign-in is not configured.');
  const body = z.object({ credential: z.string().min(20).max(8192), password: z.string().min(1).max(200).optional(),
                          acceptTerms: z.boolean().optional() }).parse(await c.req.json());
  let claims;
  try { claims = await verifyGoogleIdToken(body.credential, clientIds, c.env.GOOGLE_JWKS_URL || undefined); }
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
    // FEATURE 135: a deleted account's Google link is let go — the person continues as someone new below.
    if (linked.status === 'deleted') {
      const row = await c.env.DB.prepare(`SELECT email FROM users WHERE id = ?`).bind(linked.id).first<{ email: string }>();
      if (row) await releaseDeletedAccount(c.env, row.email);
      await c.env.DB.prepare(`DELETE FROM auth_identities WHERE user_id = ? AND provider = 'google'`).bind(linked.id).run();
    } else if (linked.status !== 'active') {
      fail(403, 'account_suspended');
    } else {
      return signIn(linked.id, false);
    }
  }
  await releaseDeletedAccount(c.env, email);

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

async function verifyCooldown(env: Env, userId: string): Promise<number> {
  const last = await env.DB.prepare(`SELECT created_at FROM email_codes WHERE user_id = ? AND purpose = 'verify'
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
    await rateLimit(c, 'RL_AUTH', `forgot-account:${user.id}`);
    const wait = await resetCooldown(c.env, user.id);
    if (wait > 0) {
      resendAfter = wait;
    } else if (user.password_hash) {
      await issueCode(c.env, user.id, email, 'reset');
    } else {
      // Google / Apple only: no password to reset — and none is invented. The e-mail says how this account signs in.
      const methods = await c.env.DB.prepare(`SELECT provider FROM auth_identities WHERE user_id = ?`).bind(user.id).all<{ provider: string }>();
      const names = methods.results.map((m) => (m.provider === 'google' ? 'Google' : m.provider === 'apple' ? 'Apple' : m.provider));
      await c.env.DB.prepare(`INSERT INTO email_codes (id, user_id, purpose, code_hash, expires_at, consumed_at, created_at)
          VALUES (?, ?, 'reset', '', ?, ?, ?)`).bind(newId('code'), user.id, now(), now(), now()).run(); // cooldown marker
      await sendEmail(c.env, email, {
        subject: 'How to sign in to KOLABA',
        title: 'Use your linked account',
        intro: `Your KOLABA account has no password. Sign in with ${names.join(' or ') || 'your linked account'}.`,
        detail: 'Use the corresponding button on the Log in screen.',
        warning: 'If you did not request this email, you can safely ignore it.',
      });
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
  await rateLimit(c, 'RL_AUTH', `reset-verify-account:${user!.id}`);
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
    try {
      await sendEmail(c.env, email.email, {
        subject: 'Your KOLABA password was changed',
        title: 'Password changed',
        intro: 'The password for your KOLABA account was changed and every device was signed out.',
        warning: 'If this was not you, reset your password immediately from the Log in screen.',
      });
    } catch { /* the password is changed either way */ }
  }
  // In the app too, on every profile of the account (never switched off; no password or code in it).
  await notifyAccount(c.env, userId, 'password_changed', {}, { dedupKey: `password_changed:${userId}:${t}` });
  return c.json({ status: 'password_changed' });
});

// ─── FIX 169: Settings → Login & Password (signed in) ───

const EMAIL_CHANGE_TTL = 10 * 60_000;

function mask(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`;
}

async function liveEmailChange(env: Env, userId: string) {
  return env.DB.prepare(`SELECT id, new_email, step, code_hash, attempts, sent_at, expires_at FROM email_change_requests
      WHERE user_id = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`).bind(userId)
    .first<{ id: string; new_email: string; step: 'current' | 'new'; code_hash: string; attempts: number; sent_at: number; expires_at: number }>();
}

async function sendEmailChangeCode(env: Env, requestId: string, userId: string, to: string, step: 'current' | 'new', newEmail: string) {
  const code = newOTPCode();
  const t = now();
  const expiresAt = t + EMAIL_CHANGE_TTL;
  await env.DB.prepare(`UPDATE email_change_requests SET step = ?, code_hash = ?, attempts = 0, sent_at = ?, expires_at = ? WHERE id = ?`)
    .bind(step, await hashOTP(env, { userId, purpose: `email-change:${step}`, recordId: requestId, expiresAt, code }),
      t, expiresAt, requestId).run();
  await sendEmail(env, to, step === 'current' ? {
    subject: 'Confirm your KOLABA email change',
    title: 'Confirm your email change',
    intro: `Someone requested changing your KOLABA sign-in email to ${mask(newEmail)}.`,
    code,
    detail: 'This code expires in 10 minutes and can be used only once.',
    warning: 'If this was not you, ignore this email and change your password.',
  } : {
    subject: 'Confirm your new KOLABA email',
    title: 'Confirm your new email',
    intro: 'Use this code to confirm this address as your new KOLABA sign-in email.',
    code,
    detail: 'This code expires in 10 minutes and can be used only once.',
    warning: 'If you did not request this change, you can safely ignore this email.',
  });
}

async function emailInUse(env: Env, email: string, userId: string): Promise<boolean> {
  const other = await env.DB.prepare(`SELECT id FROM users WHERE email = ? AND id <> ?`).bind(email, userId).first<{ id: string }>();
  return Boolean(other);
}

// POST /v1/auth/email/change {email} — step 1: a code to the CURRENT address. Nothing changes yet.
auth.post('/email/change', requireAuth, async (c) => {
  const user = currentUser(c);
  if (user.isDemo) fail(403, 'demo_account');
  await rateLimit(c, 'RL_AUTH', `email-change-ip:${clientIP(c)}`);
  await rateLimit(c, 'RL_AUTH', `email-change-account:${user.id}`);
  const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(await c.req.json());
  await rateLimit(c, 'RL_AUTH', `email-change-current:${user.email.toLowerCase()}`);
  await rateLimit(c, 'RL_AUTH', `email-change-new:${email}`);
  if (email === user.email.toLowerCase()) fail(422, 'email_same');
  if (await emailInUse(c.env, email, user.id)) fail(409, 'email_taken');
  const live = await liveEmailChange(c.env, user.id);
  if (live && live.sent_at + RESEND_AFTER_MS > now()) {
    fail(429, 'resend_too_soon', undefined, { resendAfter: Math.ceil((live.sent_at + RESEND_AFTER_MS - now()) / 1000) });
  }
  const id = newId('emc');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE email_change_requests SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL`).bind(now(), user.id),
    c.env.DB.prepare(`INSERT INTO email_change_requests (id, user_id, new_email, step, code_hash, sent_at, expires_at, created_at)
        VALUES (?, ?, ?, 'current', '', 0, 0, ?)`).bind(id, user.id, email, now()),
  ]);
  await sendEmailChangeCode(c.env, id, user.id, user.email, 'current', email);
  return c.json({ step: 'current', sentTo: user.email, resendAfter: RESEND_AFTER_MS / 1000, expiresIn: EMAIL_CHANGE_TTL / 1000 });
});

// POST /v1/auth/email/change/resend — the live step's code again (after 30 s).
auth.post('/email/change/resend', requireAuth, async (c) => {
  const user = currentUser(c);
  await rateLimit(c, 'RL_AUTH', `email-change-ip:${clientIP(c)}`);
  await rateLimit(c, 'RL_AUTH', `email-change-account:${user.id}`);
  const live = await liveEmailChange(c.env, user.id);
  if (!live) fail(400, 'code_expired');
  const wait = Math.ceil((live!.sent_at + RESEND_AFTER_MS - now()) / 1000);
  if (wait > 0) fail(429, 'resend_too_soon', undefined, { resendAfter: wait });
  const to = live!.step === 'current' ? user.email : live!.new_email;
  await rateLimit(c, 'RL_AUTH', `email-change-email:${to.toLowerCase()}`);
  await sendEmailChangeCode(c.env, live!.id, user.id, to, live!.step, live!.new_email);
  return c.json({ step: live!.step, sentTo: to, resendAfter: RESEND_AFTER_MS / 1000 });
});

// POST /v1/auth/email/change/verify {code} — the current address's code sends one to the new address; the new
// address's code changes the account's e-mail (this session stays; profiles' public e-mails are not touched).
auth.post('/email/change/verify', requireAuth, async (c) => {
  const user = currentUser(c);
  await rateLimit(c, 'RL_AUTH', `email-change-verify-ip:${clientIP(c)}`);
  await rateLimit(c, 'RL_AUTH', `email-change-verify-account:${user.id}`);
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(await c.req.json());
  const live = await liveEmailChange(c.env, user.id);
  if (!live || live.expires_at < now() || live.attempts >= MAX_CODE_ATTEMPTS) fail(400, 'code_expired');
  const targetEmail = live!.step === 'current' ? user.email : live!.new_email;
  await rateLimit(c, 'RL_AUTH', `email-change-verify-email:${targetEmail.toLowerCase()}`);
  if (!await verifyOTP(c.env, live!.code_hash, {
    userId: user.id, purpose: `email-change:${live!.step}`, recordId: live!.id, expiresAt: live!.expires_at, code,
    legacyValue: `${user.id}:${live!.id}:${code}`,
  })) {
    await c.env.DB.prepare(`UPDATE email_change_requests SET attempts = attempts + 1 WHERE id = ?`).bind(live!.id).run();
    fail(400, 'code_invalid');
  }
  if (live!.step === 'current') {
    if (await emailInUse(c.env, live!.new_email, user.id)) fail(409, 'email_taken');
    await sendEmailChangeCode(c.env, live!.id, user.id, live!.new_email, 'new', live!.new_email);
    return c.json({ step: 'new', sentTo: live!.new_email, resendAfter: RESEND_AFTER_MS / 1000 });
  }
  // Two taps at once: only the first one consumes the request.
  const consumed = await c.env.DB.prepare(`UPDATE email_change_requests SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`)
    .bind(now(), live!.id).run();
  if (!consumed.meta.changes) fail(400, 'code_expired');
  if (await emailInUse(c.env, live!.new_email, user.id)) fail(409, 'email_taken');
  const old = user.email;
  try {
    await c.env.DB.prepare(`UPDATE users SET email = ?, email_verified_at = ?, updated_at = ? WHERE id = ?`)
      .bind(live!.new_email, now(), now(), user.id).run();
  } catch {
    fail(409, 'email_taken');
  }
  try {
    await sendEmail(c.env, old, {
      subject: 'Your KOLABA sign-in email was changed',
      title: 'Sign-in email changed',
      intro: `Your KOLABA sign-in email was changed to ${mask(live!.new_email)}.`,
      warning: 'If this was not you, contact support immediately.',
    });
  } catch { /* changed either way */ }
  await notifyAccount(c.env, user.id, 'email_changed', {}, { dedupKey: `email_changed:${user.id}:${now()}` });
  return c.json({ status: 'email_changed', email: live!.new_email });
});

// POST /v1/auth/password/code — Change password: a code to the account's e-mail (Google / Apple only: no password).
auth.post('/password/code', requireAuth, async (c) => {
  const user = currentUser(c);
  if (user.isDemo) fail(403, 'demo_account');
  await rateLimit(c, 'RL_AUTH', `password-code-ip:${clientIP(c)}`);
  await rateLimit(c, 'RL_AUTH', `password-code-email:${user.email.toLowerCase()}`);
  await rateLimit(c, 'RL_AUTH', `password-code-account:${user.id}`);
  const row = await c.env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(user.id).first<{ password_hash: string | null }>();
  if (!row?.password_hash) {
    const methods = await c.env.DB.prepare(`SELECT provider FROM auth_identities WHERE user_id = ?`).bind(user.id).all<{ provider: string }>();
    fail(409, 'no_password', undefined, { providers: methods.results.map((m) => m.provider) });
  }
  const wait = await resetCooldown(c.env, user.id);
  if (wait > 0) return c.json({ status: 'sent', sentTo: user.email, resendAfter: wait });
  await issueCode(c.env, user.id, user.email, 'reset');
  return c.json({ status: 'sent', sentTo: user.email, resendAfter: RESEND_AFTER_MS / 1000 });
});

// POST /v1/auth/password/code/verify {code} → {resetToken} for /password/change.
auth.post('/password/code/verify', requireAuth, async (c) => {
  const user = currentUser(c);
  await rateLimit(c, 'RL_AUTH', `reset-verify-ip:${clientIP(c)}`);
  await rateLimit(c, 'RL_AUTH', `reset-verify-email:${user.email.toLowerCase()}`);
  await rateLimit(c, 'RL_AUTH', `reset-verify-account:${user.id}`);
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(await c.req.json());
  await checkCode(c.env, user.id, 'reset', code);
  const token = newToken();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).bind(now(), user.id),
    c.env.DB.prepare(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(newId('rst'), user.id, await sha256Hex(token), now() + RESET_TOKEN_TTL, now()),
  ]);
  return c.json({ resetToken: token, expiresAt: now() + RESET_TOKEN_TTL });
});

// POST /v1/auth/password/change {resetToken, password} — the new password; every OTHER device is signed out, this one
// stays signed in.
auth.post('/password/change', requireAuth, async (c) => {
  const user = currentUser(c);
  await rateLimit(c, 'RL_AUTH', `reset:${user.id}`);
  const body = z.object({ resetToken: z.string().min(10).max(200), password: z.string().min(1).max(200) }).parse(await c.req.json());
  const problem = passwordProblem(body.password);
  if (problem) fail(422, problem);
  const row = await c.env.DB.prepare(`SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?`)
    .bind(await sha256Hex(body.resetToken)).first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>();
  if (!row || row.user_id !== user.id || row.used_at || row.expires_at < now()) fail(400, 'reset_token_expired');
  const { hash, salt, scheme } = await hashPassword(body.password);
  const t = now();
  const done = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL`).bind(t, row!.id),
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, password_scheme = ?, failed_logins = 0, locked_until = NULL,
                      updated_at = ? WHERE id = ?`).bind(hash, salt, scheme, t, user.id),
    c.env.DB.prepare(`UPDATE email_codes SET consumed_at = ? WHERE user_id = ? AND purpose = 'reset' AND consumed_at IS NULL`).bind(t, user.id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND id <> ?`).bind(user.id, user.sessionId),
  ]);
  if (!done[0].meta.changes) fail(400, 'reset_token_expired');
  try {
    await sendEmail(c.env, user.email, {
      subject: 'Your KOLABA password was changed',
      title: 'Password changed',
      intro: 'Your KOLABA password was changed and your other devices were signed out.',
      warning: 'If this was not you, reset your password immediately from the Log in screen.',
    });
  } catch { /* changed either way */ }
  await notifyAccount(c.env, user.id, 'password_changed', {}, { dedupKey: `password_changed:${user.id}:${t}` });
  return c.json({ status: 'password_changed' });
});

export default auth;
