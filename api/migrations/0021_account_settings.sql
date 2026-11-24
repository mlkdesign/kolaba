-- 0021 (FIX 169): Settings → Login & Password and Push & Alerts.
-- Changing the login e-mail: a code to the current address, then one to the new address; the account's address changes
-- only after both. One live request per account (a new one ends the previous); five wrong tries end a step.
CREATE TABLE IF NOT EXISTS email_change_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  new_email     TEXT NOT NULL COLLATE NOCASE,
  step          TEXT NOT NULL CHECK (step IN ('current', 'new')),
  code_hash     TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  sent_at       INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_change_requests_user ON email_change_requests (user_id, created_at);

-- Push & Alerts, per DEVICE: sounds, and pushes of the account's profiles that aren't the one open on this device.
ALTER TABLE device_tokens ADD COLUMN sounds INTEGER NOT NULL DEFAULT 1;
ALTER TABLE device_tokens ADD COLUMN other_profiles INTEGER NOT NULL DEFAULT 1;
ALTER TABLE device_tokens ADD COLUMN active_profile_id TEXT;
