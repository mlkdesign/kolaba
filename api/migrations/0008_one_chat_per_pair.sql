-- 0008: one chat per pair of profiles (no separate job chats).
-- A job conversation becomes the pair's direct chat when the pair has none yet (checked before writing: on 2026-11-12
-- no pair had both, 3 job conversations / 9 messages). A pair that has both keeps both rows untouched here; the app
-- shows the latest one. Reversible only by hand (the old related_job_id is kept in a backup table).
CREATE TABLE IF NOT EXISTS conversations_job_backup_0008 AS
  SELECT id, kind, related_job_id FROM conversations WHERE related_job_id <> '';
UPDATE conversations SET kind = 'direct', related_job_id = ''
  WHERE related_job_id <> ''
    AND NOT EXISTS (SELECT 1 FROM conversations d WHERE d.pair_key = conversations.pair_key AND d.related_job_id = '');
