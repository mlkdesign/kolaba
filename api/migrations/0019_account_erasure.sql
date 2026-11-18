-- FIX 131: Delete all data — an account erased for real, kept only as an anonymous tombstone so the conversations,
-- reviews and job history other people have still point at stable ids ("Deleted account").
--
-- users.erased_at / profiles.erased_at: the tombstone marker. The rows keep their ids; every personal field is cleared
-- (e-mail replaced by an unusable placeholder, names by "Deleted account"). An erased account can never be restored
-- and a new sign-up with the same e-mail is a brand-new account.
ALTER TABLE users ADD COLUMN erased_at INTEGER;
ALTER TABLE profiles ADD COLUMN erased_at INTEGER;

-- A chat attachment whose file is gone: the bubble stays, the file shows "Media unavailable".
ALTER TABLE message_voice ADD COLUMN erased_at INTEGER;
ALTER TABLE message_files ADD COLUMN erased_at INTEGER;

-- The erasure as a tracked operation (D1 and R2 can't share a transaction): requested → processing → completed, or
-- failed (retry). Idempotent: every step can run again; files already removed are skipped.
CREATE TABLE account_deletions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  requested_by  TEXT NOT NULL,                 -- 'self' or the admin's id
  status        TEXT NOT NULL CHECK (status IN ('requested', 'processing', 'completed', 'failed')),
  files_total   INTEGER NOT NULL DEFAULT 0,
  files_deleted INTEGER NOT NULL DEFAULT 0,
  files_failed  INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  completed_at  INTEGER
);
CREATE UNIQUE INDEX account_deletions_user ON account_deletions (user_id);

-- Every R2 object the erasure has to remove (collected once, before the rows change).
CREATE TABLE account_deletion_files (
  deletion_id TEXT NOT NULL REFERENCES account_deletions (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  deleted_at  INTEGER,
  error       TEXT,
  PRIMARY KEY (deletion_id, storage_key)
);
