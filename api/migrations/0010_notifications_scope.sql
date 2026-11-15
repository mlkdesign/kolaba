-- 0010: notifications per profile OR per account (security / account events), with a de-duplication key and the
-- target they point at. The table is rebuilt (SQLite can't relax NOT NULL on recipient_profile_id); every existing
-- row is kept as a profile notification of its profile's owner. Rows of features that no longer exist (follows,
-- profile views) and message rows (messages live in Chat only) are dropped.
CREATE TABLE notifications_v2 (
  id                   TEXT PRIMARY KEY,
  recipient_user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- NULL for an account notification (shown on every profile of the account, stored once).
  recipient_profile_id TEXT REFERENCES profiles (id) ON DELETE CASCADE,
  scope                TEXT NOT NULL DEFAULT 'profile' CHECK (scope IN ('profile', 'account')),
  type                 TEXT NOT NULL,
  actor_profile_id     TEXT,
  target_type          TEXT,
  target_id            TEXT,
  payload              TEXT NOT NULL DEFAULT '{}',
  dedup_key            TEXT,
  created_at           INTEGER NOT NULL,
  read_at              INTEGER,
  CHECK ((scope = 'profile' AND recipient_profile_id IS NOT NULL) OR (scope = 'account' AND recipient_profile_id IS NULL))
);

INSERT INTO notifications_v2 (id, recipient_user_id, recipient_profile_id, scope, type, actor_profile_id, payload, created_at, read_at)
  SELECT n.id, p.owner_user_id, n.recipient_profile_id, 'profile', n.type, n.actor_profile_id, n.payload, n.created_at, n.read_at
  FROM notifications n JOIN profiles p ON p.id = n.recipient_profile_id
  WHERE n.type NOT IN ('followed', 'new_message', 'viewed_profile');

DROP TABLE notifications;
ALTER TABLE notifications_v2 RENAME TO notifications;

CREATE INDEX notifications_profile ON notifications (recipient_profile_id, created_at DESC) WHERE scope = 'profile';
CREATE INDEX notifications_account ON notifications (recipient_user_id, created_at DESC) WHERE scope = 'account';
CREATE INDEX notifications_unread ON notifications (recipient_user_id, recipient_profile_id) WHERE read_at IS NULL;
-- The same event never makes a second row (a repeated request, webhook or retry).
CREATE UNIQUE INDEX notifications_dedup ON notifications (dedup_key) WHERE dedup_key IS NOT NULL;
