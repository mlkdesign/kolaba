-- 0011 (FIX 125): Settings → Notifications per PROFILE (a Creator and each Business keep their own): the main Push
-- switch and four categories. No row = everything on. Only optional pushes read these; the feed keeps every event,
-- and mandatory notices (PRO, moderation, sanctions, account security) never depend on them.
CREATE TABLE IF NOT EXISTS notification_preferences (
  profile_id       TEXT PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  push_enabled     INTEGER NOT NULL DEFAULT 1,
  jobs_enabled     INTEGER NOT NULL DEFAULT 1,
  contacts_enabled INTEGER NOT NULL DEFAULT 1,
  activity_enabled INTEGER NOT NULL DEFAULT 1,
  messages_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at       INTEGER NOT NULL
);
