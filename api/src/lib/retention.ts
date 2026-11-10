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
  ]);
}
