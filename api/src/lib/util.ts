import { HTTPException } from 'hono/http-exception';

/** An API refusal: HTTP status + a machine-readable code the web app maps to a message. */
export class ApiError extends HTTPException {
  constructor(status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 429 | 500 | 503, readonly code: string,
              message?: string) {
    super(status, { message: message ?? code });
  }
}

export const fail = (status: ConstructorParameters<typeof ApiError>[0], code: string, message?: string): never => {
  throw new ApiError(status, code, message);
};

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Random id with a kind prefix, e.g. "job_k3x9…" (128 bits). */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (const b of bytes) out += alphabet[b % 36];
  return `${prefix}_${out}${Date.now().toString(36)}`;
}

/** URL-safe random token (256 bits). */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const now = () => Date.now();

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function parseJSON<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Cursor = base64url of a JSON object (opaque to the client). */
export function encodeCursor(value: Record<string, string | number>): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor<T extends Record<string, string | number>>(cursor: string | undefined | null): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))) as T;
  } catch {
    return fail(400, 'invalid_cursor');
  }
}

export function clampLimit(raw: string | undefined, fallback = 20, max = 50): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : fallback;
}
