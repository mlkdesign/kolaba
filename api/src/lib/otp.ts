import type { Env } from '../env';
import { fail, sha256Hex, timingSafeEqual } from './util';

const OTP_SPACE = 1_000_000;
const UINT32_RANGE = 0x1_0000_0000;
const UNBIASED_LIMIT = Math.floor(UINT32_RANGE / OTP_SPACE) * OTP_SPACE;

/** Six cryptographically random digits, using rejection sampling to avoid modulo bias. */
export function newOTPCode(): string {
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= UNBIASED_LIMIT);
  return (values[0] % OTP_SPACE).toString().padStart(6, '0');
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function otpSecret(env: Env): string {
  const secret = env.OTP_HASH_SECRET?.trim();
  if (!secret || secret.length < 32) fail(503, 'email_unavailable', 'E-mail verification is not configured yet.');
  return secret!;
}

/** New hashes are keyed and bind the OTP to its account, purpose, record and expiration. */
export async function hashOTP(
  env: Env,
  fields: { userId: string; purpose: string; recordId: string; expiresAt: number; code: string },
): Promise<string> {
  const payload = `${fields.userId}:${fields.purpose}:${fields.recordId}:${fields.expiresAt}:${fields.code}`;
  return `hmac:v1:${await hmacHex(otpSecret(env), payload)}`;
}

/**
 * Accepts HMAC v1 and, during the rollout window, legacy SHA-256 records already stored in D1.
 * Every newly issued code uses HMAC; no database rewrite or user-data migration is needed.
 */
export async function verifyOTP(
  env: Env,
  storedHash: string,
  fields: { userId: string; purpose: string; recordId: string; expiresAt: number; code: string; legacyValue: string },
): Promise<boolean> {
  if (storedHash.startsWith('hmac:v1:')) {
    return timingSafeEqual(storedHash, await hashOTP(env, fields));
  }
  return timingSafeEqual(storedHash, await sha256Hex(fields.legacyValue));
}
