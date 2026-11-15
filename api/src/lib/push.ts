// FEATURE 115: Apple Push Notification service. A push goes to every device of the account that owns the recipient
// profile; the payload names the profile, so the app opens the right one. Without the APNs secrets nothing is sent
// (the in-app Notifications feed and the Chat badge still work) — a push is never faked locally.
import type { Env } from '../env';

export const apnsConfigured = (env: Env) =>
  Boolean(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY && env.APNS_BUNDLE_ID);

let cachedJWT: { token: string; at: number; kid: string } | null = null;

const b64url = (bytes: ArrayBuffer | Uint8Array | string) => {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  let s = '';
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** The provider token (ES256, reused for 50 minutes as Apple asks). */
async function providerToken(env: Env): Promise<string> {
  const t = Math.floor(Date.now() / 1000);
  if (cachedJWT && cachedJWT.kid === env.APNS_KEY_ID && t - cachedJWT.at < 50 * 60) return cachedJWT.token;
  const pem = env.APNS_PRIVATE_KEY!.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const unsigned = `${b64url(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID }))}.${b64url(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: t }))}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  cachedJWT = { token: `${unsigned}.${b64url(signature)}`, at: t, kid: env.APNS_KEY_ID! };
  return cachedJWT.token;
}

export interface PushContent {
  title: string;
  body: string;
  /** Shown instead of `body` on a device whose owner turned message previews off. */
  privateBody?: string;
  /** Groups a chat's pushes; the same id replaces the previous banner. */
  threadId?: string;
  collapseId?: string;
  /** Opened by the app: kind, profileId, conversationId… */
  data: Record<string, string>;
  /** Which Settings switch may silence it (null: never — account security). */
  setting: PushSetting | null;
}

/** Settings → Notifications switches that gate a push (stored per account in user_settings.notifications). */
export type PushSetting = 'newMessages' | 'projectUpdates' | 'newApplications' | 'followersAndMentions' | 'reviews'
  | 'content' | 'subscription';

/** Sends to every device of the profile's owner. Never throws (a push must not fail the request that caused it). */
export async function pushToProfile(env: Env, profileId: string, content: PushContent): Promise<void> {
  if (!apnsConfigured(env)) return;
  const owner = await env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(profileId)
    .first<{ owner_user_id: string }>().catch(() => null);
  if (!owner) return;
  await pushToUser(env, owner.owner_user_id, content, profileId);
}

/** Sends to every device of the account; `profileId` (when the push is a profile's) tells the app which profile
 *  to open. An account push (security) has none and ignores the switches. */
export async function pushToUser(env: Env, userId: string, content: PushContent, profileId: string | null = null): Promise<void> {
  if (!apnsConfigured(env)) return;
  try {
    const row = await env.DB.prepare(`SELECT notifications FROM user_settings WHERE user_id = ?`).bind(userId)
      .first<{ notifications: string | null }>();
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(row?.notifications ?? '{}'); } catch { /* defaults: everything on */ }
    if (content.setting && (settings.push === false || settings[content.setting] === false)) return;
    const owner = { user_id: userId };
    const devices = await env.DB.prepare(`SELECT token, environment, previews FROM device_tokens WHERE user_id = ?`)
      .bind(owner.user_id).all<{ token: string; environment: string; previews: number }>();
    if (!devices.results.length) return;
    const jwt = await providerToken(env);
    await Promise.all(devices.results.map(async (d) => {
      const host = d.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
      const body = d.previews === 0 && content.privateBody ? content.privateBody : content.body;
      const payload = {
        aps: { alert: { title: content.title, body }, sound: 'default', 'thread-id': content.threadId, 'mutable-content': 1 },
        ...content.data, ...(profileId ? { profileId } : {}),
      };
      const res = await fetch(`${host}/3/device/${d.token}`, {
        method: 'POST',
        headers: {
          authorization: `bearer ${jwt}`, 'apns-topic': env.APNS_BUNDLE_ID!, 'apns-push-type': 'alert', 'apns-priority': '10',
          ...(content.collapseId ? { 'apns-collapse-id': content.collapseId.slice(0, 64) } : {}),
        },
        body: JSON.stringify(payload),
      });
      // A token Apple no longer accepts is forgotten (the app registers again on its next launch).
      if (res.status === 410 || res.status === 400) {
        const reason = await res.text();
        if (res.status === 410 || reason.includes('BadDeviceToken')) {
          await env.DB.prepare(`DELETE FROM device_tokens WHERE token = ?`).bind(d.token).run();
        }
      } else if (!res.ok) {
        console.error('apns', res.status, await res.text());
      }
    }));
  } catch (error) {
    console.error('push failed', error);
  }
}
