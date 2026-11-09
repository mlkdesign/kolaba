-- ADMIN PANEL MVP (2026-11-09). Additive only: new tables + nullable columns; no existing row is changed.
--
-- Administrators are a separate system from KOLABA accounts: a KOLABA user (whatever users.role says) can never sign
-- in to the admin panel, and an admin session never works on the app API.

CREATE TABLE admins (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash        TEXT NOT NULL,          -- PBKDF2-SHA256 (src/lib/password.ts), same scheme as users
  password_salt        TEXT NOT NULL,
  password_scheme      TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_logins        INTEGER NOT NULL DEFAULT 0,
  locked_until         INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  password_changed_at  INTEGER
);

-- id = sha256(token); the token lives only in the admin tab's memory.
CREATE TABLE admin_sessions (
  id           TEXT PRIMARY KEY,
  admin_id     TEXT NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,             -- absolute limit (8 h)
  last_seen_at INTEGER NOT NULL,             -- idle limit (60 min) is checked against this
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX admin_sessions_admin ON admin_sessions (admin_id);

CREATE TABLE admin_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    TEXT,
  admin_email TEXT,
  action      TEXT NOT NULL,                 -- login.success, user.block, job.hide, …
  entity_type TEXT,
  entity_id   TEXT,
  result      TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success', 'failure')),
  reason      TEXT,
  detail      TEXT,                          -- JSON; never tokens or passwords
  ip          TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX admin_logs_time ON admin_logs (created_at DESC);

-- Account moderation. users.status keeps its meaning: 'suspended' = blocked, 'deleted' = soft-deleted.
ALTER TABLE users ADD COLUMN blocked_reason TEXT;
ALTER TABLE users ADD COLUMN blocked_at INTEGER;
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
ALTER TABLE users ADD COLUMN deleted_reason TEXT;
-- Profiles an admin soft-delete hid (status 'hidden'), so a restore brings back exactly those.
ALTER TABLE profiles ADD COLUMN admin_hidden_at INTEGER;

-- Job moderation. A hidden / deleted job gets status 'removed' (every public query already excludes it);
-- the status it had is kept here so Restore brings it back unchanged.
ALTER TABLE jobs ADD COLUMN moderation_status TEXT CHECK (moderation_status IN ('hidden', 'deleted'));
ALTER TABLE jobs ADD COLUMN moderation_reason TEXT;
ALTER TABLE jobs ADD COLUMN moderated_at INTEGER;
ALTER TABLE jobs ADD COLUMN pre_moderation_status TEXT;

-- Media moderation: hidden media get status 'deleted' for the app (file stays in R2), restored from here.
ALTER TABLE media ADD COLUMN moderation_status TEXT CHECK (moderation_status IN ('hidden'));
ALTER TABLE media ADD COLUMN moderation_reason TEXT;
ALTER TABLE media ADD COLUMN pre_moderation_status TEXT;
