// Password hashing: PBKDF2-HMAC-SHA256, 600 000 iterations (OWASP 2023), 16-byte random salt per user.
//
// Workers' WebCrypto refuses more than 100 000 PBKDF2 iterations per call, so the work is done as 6 chained rounds
// of 100 000 (each round's 256-bit output is the next round's key material, same salt). An attacker has to do the
// same 600 000 HMAC-SHA256 iterations per guess. Measured on the Workers Free plan: 30/30 requests OK, ~0.2 s wall
// time (see docs/CLOUDFLARE_ARCHITECTURE.md). The scheme is stored per user, so it can be raised later.

export const PASSWORD_SCHEME = 'pbkdf2-sha256:6x100000';
const ROUNDS = 6;
const ITERATIONS = 100_000;

const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, rounds = ROUNDS): Promise<ArrayBuffer> {
  let material: ArrayBuffer = new TextEncoder().encode(password.normalize('NFKC')).buffer as ArrayBuffer;
  for (let i = 0; i < rounds; i++) {
    const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
    material = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  }
  return material;
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string; scheme: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: b64(await derive(password, salt)), salt: b64(salt), scheme: PASSWORD_SCHEME };
}

export async function verifyPassword(password: string, hash: string, salt: string, scheme: string): Promise<boolean> {
  const rounds = scheme === PASSWORD_SCHEME ? ROUNDS : Number(/:(\d+)x/.exec(scheme)?.[1] ?? NaN);
  if (!Number.isFinite(rounds)) return false;
  const actual = new Uint8Array(await derive(password, unb64(salt), rounds));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** A password the app accepts (the iOS rule: at least 8 characters) — plus a ceiling against hashing DoS. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'password_too_short';
  if (password.length > 128) return 'password_too_long';
  return null;
}
