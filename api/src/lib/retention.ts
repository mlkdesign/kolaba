// Retention (scheduled daily): what is kept only for a limited time is removed here. See docs/DATA_RETENTION.md.
import type { Env } from '../env';

export async function purgeExpired(env: Env) {
  const t = Date.now();
  const evidenceDays = Number(env.EVIDENCE_RETENTION_DAYS ?? 180);
  await env.DB.batch([
    // Messages shared with a report: gone once the report has been closed for the retention period.
    env.DB.prepare(`DELETE FROM report_evidence WHERE report_id IN (SELECT id FROM reports WHERE status IN ('resolved', 'dismissed')
        AND COALESCE(handled_at, updated_at) < ?)`).bind(t - evidenceDays * 86_400_000),
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(t),
    env.DB.prepare(`DELETE FROM admin_sessions WHERE expires_at < ?`).bind(t),
    env.DB.prepare(`DELETE FROM email_codes WHERE expires_at < ?`).bind(t - 86_400_000),
    // FEATURE 115: spent reset tokens; PRO an administrator gave ends by its date (quietly — no notification).
    env.DB.prepare(`DELETE FROM password_reset_tokens WHERE expires_at < ?`).bind(t - 86_400_000),
    env.DB.prepare(`UPDATE pro_grants SET status = 'expired' WHERE status = 'active' AND (expires_at <= ?1
        OR subscription_id IN (SELECT id FROM subscriptions WHERE status <> 'active' OR (expires_at IS NOT NULL AND expires_at <= ?1)))`).bind(t),
    env.DB.prepare(`UPDATE subscriptions SET status = 'expired' WHERE status = 'active' AND source = 'admin'
        AND expires_at IS NOT NULL AND expires_at <= ?`).bind(t),
  ]);
  // A sign-up never confirmed within 7 days (no profile, never verified) is removed — it was never an active account
  // or profile. Separate, so a row another table still points to can't stop the purge above.
  try {
    await env.DB.prepare(`DELETE FROM users WHERE email_verified_at IS NULL AND is_demo = 0 AND created_at < ?
        AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.owner_user_id = users.id)
        AND NOT EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id = users.id)`).bind(t - 7 * 86_400_000).run();
  } catch (error) {
    console.error('pending sign-up cleanup', error);
  }
}
