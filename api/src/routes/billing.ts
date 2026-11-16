// Paid plans bought in the iOS app (StoreKit 2): creator.pro / business.pro auto-renewable subscriptions.
//
// The app sends the signed transaction it got from StoreKit; the server never trusts that JWS itself — it asks Apple's
// App Store Server API for the transaction by its id (over TLS, with this app's API key) and keeps what Apple answers:
// the product (which plan), the original transaction (one subscription), the expiry, a refund. Renewals, expiries and
// refunds arrive later from App Store Server Notifications V2, and are again re-read from Apple before they count.
//
// One subscription row per original transaction (`subscriptions.source = 'app_store'`, `external_id`); a purchase made
// by one KOLABA account is never moved to another account's profile. PRO is then the subscription's own rule:
// `status = 'active' AND (expires_at IS NULL OR expires_at > now)`.
//
// Secrets (wrangler secret put): APPSTORE_ISSUER_ID, APPSTORE_KEY_ID, APPSTORE_PRIVATE_KEY (the .p8, PEM).
// Var: APPSTORE_BUNDLE_ID. Without them every purchase call answers 503 billing_not_configured (nothing is granted).
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, currentUser, requireAuth, requireProfile } from '../lib/auth';
import { fail, newId, now } from '../lib/util';

export const billing = new Hono<AppEnv>();

const PRODUCTS: Record<string, 'creator_pro' | 'business_pro'> = {
  'app.kolaba.creator.pro.yearly': 'creator_pro',
  'app.kolaba.creator.pro.monthly': 'creator_pro',
  'app.kolaba.business.pro.yearly': 'business_pro',
  'app.kolaba.business.pro.monthly': 'business_pro',
};

const PRODUCTION = 'https://api.storekit.itunes.apple.com';
const SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com';

export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  expiresDate?: number;
  revocationDate?: number;
  environment?: string;
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJSON = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

/** The payload of a JWS, unverified (only to read an id that is then looked up at Apple). */
export function jwsPayload<T>(jws: string): T {
  const part = jws.split('.')[1];
  if (!part) fail(422, 'invalid_transaction');
  const text = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(text, (ch) => ch.charCodeAt(0)))) as T; }
  catch { return fail(422, 'invalid_transaction'); }
}

function configured(env: Env) {
  return Boolean(env.APPSTORE_ISSUER_ID && env.APPSTORE_KEY_ID && env.APPSTORE_PRIVATE_KEY && env.APPSTORE_BUNDLE_ID);
}

/** The App Store Server API token (ES256, at most 20 minutes). */
async function apiToken(env: Env): Promise<string> {
  const pem = env.APPSTORE_PRIVATE_KEY!.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const iat = Math.floor(Date.now() / 1000);
  const head = b64urlJSON({ alg: 'ES256', kid: env.APPSTORE_KEY_ID, typ: 'JWT' });
  const body = b64urlJSON({ iss: env.APPSTORE_ISSUER_ID, iat, exp: iat + 1200, aud: 'appstoreconnect-v1', bid: env.APPSTORE_BUNDLE_ID });
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(signature)}`;
}

/** Apple's own record of a transaction: production first, then the sandbox (TestFlight and Xcode purchases). */
export async function appleTransaction(env: Env, transactionId: string): Promise<AppleTransaction | null> {
  if (!/^\d{1,30}$/.test(transactionId)) return null;
  const token = await apiToken(env);
  const bases = env.APPSTORE_API_URL ? [env.APPSTORE_API_URL] : [PRODUCTION, SANDBOX];
  for (const base of bases) {
    const res = await fetch(`${base}/inApps/v1/transactions/${transactionId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) continue;
    if (!res.ok) fail(503, 'app_store_unavailable');
    const { signedTransactionInfo } = await res.json<{ signedTransactionInfo: string }>();
    return jwsPayload<AppleTransaction>(signedTransactionInfo);
  }
  return null;
}

/** Keeps Apple's record of a transaction for a profile (a new purchase, a restore, a renewal). */
async function keep(env: Env, tx: AppleTransaction, profile: { id: string; type: string; ownerUserId?: string }) {
  if (tx.bundleId !== env.APPSTORE_BUNDLE_ID) fail(422, 'wrong_app');
  const plan = PRODUCTS[tx.productId];
  if (!plan) fail(422, 'unknown_product');
  if ((plan === 'business_pro') !== (profile.type === 'business')) fail(422, 'plan_for_other_profile_type');
  const existing = await env.DB.prepare(`SELECT s.id, s.profile_id, p.owner_user_id FROM subscriptions s JOIN profiles p ON p.id = s.profile_id
      WHERE s.source = 'app_store' AND s.external_id = ?`).bind(tx.originalTransactionId)
    .first<{ id: string; profile_id: string; owner_user_id: string }>();
  // A purchase stays with the KOLABA account that made it.
  if (existing && profile.ownerUserId && existing.owner_user_id !== profile.ownerUserId) fail(409, 'purchase_belongs_to_another_account');
  const active = !tx.revocationDate && (tx.expiresDate ?? 0) > now();
  const status = tx.revocationDate ? 'cancelled' : active ? 'active' : 'expired';
  if (existing) {
    await env.DB.prepare(`UPDATE subscriptions SET profile_id = ?, plan = ?, status = ?, expires_at = ?, product_id = ? WHERE id = ?`)
      .bind(existing.owner_user_id === profile.ownerUserId ? profile.id : existing.profile_id, plan, status,
            tx.revocationDate ?? tx.expiresDate ?? null, tx.productId, existing.id).run();
  } else {
    await env.DB.prepare(`INSERT INTO subscriptions (id, profile_id, plan, status, source, started_at, expires_at, external_id, product_id)
        VALUES (?, ?, ?, ?, 'app_store', ?, ?, ?, ?)`)
      .bind(newId('sub'), profile.id, plan, status, now(), tx.revocationDate ?? tx.expiresDate ?? null, tx.originalTransactionId, tx.productId).run();
  }
  return { isPro: active, plan, expiresAt: tx.expiresDate ?? null };
}

// POST /v1/billing/app-store/transactions {signedTransaction} — the acting profile's purchase or restore.
billing.post('/app-store/transactions', requireAuth, requireProfile, async (c) => {
  if (!configured(c.env)) fail(503, 'billing_not_configured');
  const user = currentUser(c);
  const profile = actingProfile(c);
  const { signedTransaction } = z.object({ signedTransaction: z.string().min(20).max(20_000) }).parse(await c.req.json());
  const claimed = jwsPayload<{ transactionId?: string }>(signedTransaction);
  const tx = claimed.transactionId ? await appleTransaction(c.env, String(claimed.transactionId)) : null;
  if (!tx) fail(422, 'transaction_not_found');
  return c.json(await keep(c.env, tx!, { id: profile.id, type: profile.type, ownerUserId: user.id }));
});

// POST /v1/billing/app-store/notifications — App Store Server Notifications V2 (renewals, expiries, refunds). The payload
// only says which transaction changed; its state is re-read from Apple. Always 200 so Apple doesn't retry for nothing.
billing.post('/app-store/notifications', async (c) => {
  if (!configured(c.env)) return c.json({ status: 'ignored' });
  const body = await c.req.json<{ signedPayload?: string }>().catch(() => ({} as { signedPayload?: string }));
  if (!body.signedPayload) return c.json({ status: 'ignored' });
  const payload = jwsPayload<{ data?: { signedTransactionInfo?: string } }>(body.signedPayload);
  const info = payload.data?.signedTransactionInfo ? jwsPayload<{ transactionId?: string }>(payload.data.signedTransactionInfo) : null;
  if (!info?.transactionId) return c.json({ status: 'ignored' });
  const tx = await appleTransaction(c.env, String(info.transactionId));
  if (!tx) return c.json({ status: 'ignored' });
  const row = await c.env.DB.prepare(`SELECT s.profile_id, p.type, p.owner_user_id FROM subscriptions s JOIN profiles p ON p.id = s.profile_id
      WHERE s.source = 'app_store' AND s.external_id = ?`).bind(tx.originalTransactionId)
    .first<{ profile_id: string; type: string; owner_user_id: string }>();
  // A purchase nobody has sent from the app yet: it's kept when the app sends it.
  if (!row) return c.json({ status: 'unknown' });
  await keep(c.env, tx, { id: row.profile_id, type: row.type, ownerUserId: row.owner_user_id });
  return c.json({ status: 'updated' });
});
