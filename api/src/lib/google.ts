// Google ID token verification (Sign in with Google / Google Identity Services), with Web Crypto only:
// RS256 signature against Google's published keys (JWKS, cached per isolate by their max-age), issuer
// (accounts.google.com), audience (our Web client id), expiry / issued-at with a little clock skew, and a verified
// e-mail. The token's `sub` is the stable Google account id; nothing else in it is trusted for identity.

export interface GoogleClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const SKEW = 60; // seconds

type Jwk = JsonWebKey & { kid: string; alg?: string };
let cache: { url: string; keys: Jwk[]; until: number } | null = null;

async function keys(url: string, refresh = false): Promise<Jwk[]> {
  if (!refresh && cache && cache.url === url && cache.until > Date.now()) return cache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new GoogleTokenError('jwks_unavailable');
  const body = await res.json<{ keys: Jwk[] }>();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  cache = { url, keys: body.keys, until: Date.now() + Math.min(maxAge, 86_400) * 1000 };
  return body.keys;
}

export class GoogleTokenError extends Error {}

const b64urlBytes = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
};
const b64urlJSON = <T>(s: string): T => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

/** The token's claims when it is a valid Google ID token for one of our client ids (the Web client — Google Identity
 *  Services — or the iOS app's client, GoogleSignIn-iOS); throws GoogleTokenError otherwise. */
export async function verifyGoogleIdToken(token: string, clientId: string | string[], jwksUrl = GOOGLE_JWKS_URL, nowSeconds = Math.floor(Date.now() / 1000)): Promise<GoogleClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new GoogleTokenError('malformed');
  let header: { alg: string; kid: string; typ?: string };
  let claims: GoogleClaims;
  try { header = b64urlJSON(parts[0]); claims = b64urlJSON(parts[1]); } catch { throw new GoogleTokenError('malformed'); }
  if (header.alg !== 'RS256' || !header.kid) throw new GoogleTokenError('bad_algorithm');

  let jwk = (await keys(jwksUrl)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await keys(jwksUrl, true)).find((k) => k.kid === header.kid); // keys rotate
  if (!jwk) throw new GoogleTokenError('unknown_key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new GoogleTokenError('bad_signature');

  if (!ISSUERS.includes(claims.iss)) throw new GoogleTokenError('bad_issuer');
  const audiences = (Array.isArray(clientId) ? clientId : [clientId]).filter(Boolean);
  if (!audiences.includes(claims.aud)) throw new GoogleTokenError('bad_audience');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW < nowSeconds) throw new GoogleTokenError('expired');
  if (typeof claims.iat === 'number' && claims.iat - SKEW > nowSeconds) throw new GoogleTokenError('not_yet_valid');
  if (!claims.sub || !claims.email) throw new GoogleTokenError('incomplete');
  if (claims.email_verified !== true && (claims.email_verified as unknown) !== 'true') throw new GoogleTokenError('email_not_verified');
  return { ...claims, email: claims.email.trim().toLowerCase(), email_verified: true };
}
