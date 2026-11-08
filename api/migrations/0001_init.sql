-- KOLABA WEB MVP 01 — D1 schema (SQLite). One database: kolaba-db.
-- Conventions: ids are TEXT (random, prefixed by kind); times are INTEGER milliseconds since epoch;
-- everything a user owns points at a PROFILE (creator or business), never at the account, so two profiles of one
-- person never mix. Rules (who may do what) are enforced by the Worker before every write.

PRAGMA foreign_keys = ON;

-- ─────────────────────────── Accounts ───────────────────────────

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash     TEXT,                 -- base64, PBKDF2-SHA256 (see src/lib/password.ts); NULL for OAuth-only
  password_salt     TEXT,
  password_scheme   TEXT,                 -- e.g. "pbkdf2-sha256:6x100000"
  email_verified_at INTEGER,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  role              TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  is_demo           INTEGER NOT NULL DEFAULT 0,
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- id = sha256(token) — the token itself lives only in the client.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent   TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);

-- OAuth (Google / Apple) — prepared, not connected yet.
CREATE TABLE auth_identities (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_user_id TEXT NOT NULL,
  email            TEXT,
  created_at       INTEGER NOT NULL,
  UNIQUE (provider, provider_user_id)
);

-- E-mail verification and password reset codes (6 digits, hashed).
CREATE TABLE email_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX email_codes_user ON email_codes (user_id, purpose, created_at);

CREATE TABLE user_settings (
  user_id       TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  language      TEXT NOT NULL DEFAULT 'en',
  notifications TEXT NOT NULL DEFAULT '{}',   -- JSON switches
  updated_at    INTEGER NOT NULL
);

-- ─────────────────────────── Profiles ───────────────────────────

CREATE TABLE profiles (
  id                   TEXT PRIMARY KEY,
  owner_user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type                 TEXT NOT NULL CHECK (type IN ('creator', 'business')),
  display_name         TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  username             TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(username) BETWEEN 3 AND 30),
  avatar_media_id      TEXT,
  intro_video_media_id TEXT,
  bio                  TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 1000),
  category             TEXT,                -- creator niche / business category
  country_code         TEXT,
  country              TEXT,
  city                 TEXT,
  flag                 TEXT,
  languages            TEXT NOT NULL DEFAULT '[]',   -- JSON array of ISO codes
  website              TEXT,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'suspended', 'deleted')),
  visibility           TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  is_demo              INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX profiles_owner ON profiles (owner_user_id);
CREATE INDEX profiles_type ON profiles (type, status, display_name);

CREATE TABLE profile_links (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('instagram', 'tiktok', 'youtube', 'telegram', 'whatsapp', 'website', 'email')),
  url        TEXT NOT NULL CHECK (length(url) <= 300),
  position   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (profile_id, kind)
);

CREATE TABLE profile_social_accounts (
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  platform   TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'pinterest')),
  handle     TEXT,
  followers  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, platform)
);

CREATE TABLE profile_settings (
  profile_id      TEXT PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  show_location   INTEGER NOT NULL DEFAULT 1,
  who_can_message TEXT NOT NULL DEFAULT 'everyone' CHECK (who_can_message IN ('everyone', 'contacts', 'nobody')),
  show_links      INTEGER NOT NULL DEFAULT 1,
  hide_job_posts  INTEGER NOT NULL DEFAULT 0
);

-- Test entitlements (no real payments). The server decides PRO from here.
CREATE TABLE subscriptions (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  plan       TEXT NOT NULL CHECK (plan IN ('creator_pro', 'business_pro')),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  source     TEXT NOT NULL CHECK (source IN ('demo', 'test', 'admin', 'app_store')),
  started_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE INDEX subscriptions_profile ON subscriptions (profile_id, status);

-- ─────────────────────────── Media ───────────────────────────

-- One model for uploaded files (provider r2) and demo stock media (provider external / r2 copies).
CREATE TABLE media (
  id               TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
  purpose          TEXT NOT NULL CHECK (purpose IN ('avatar', 'portfolio', 'intro', 'collection', 'job', 'application', 'chat', 'poster')),
  provider         TEXT NOT NULL CHECK (provider IN ('r2', 'external')),
  storage_key      TEXT UNIQUE,            -- R2 object key
  url              TEXT,                   -- external URL (demo)
  fallback_url     TEXT,
  poster_media_id  TEXT,
  poster_url       TEXT,
  mime             TEXT,
  bytes            INTEGER,
  width            INTEGER,
  height           INTEGER,
  duration         REAL,
  title            TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed', 'deleted')),
  is_public        INTEGER NOT NULL DEFAULT 1,
  source_provider  TEXT,                   -- Pexels, Unsplash…
  source_url       TEXT,
  license          TEXT,
  attribution      TEXT,
  likes_count      INTEGER NOT NULL DEFAULT 0,
  views_count      INTEGER NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  deleted_at       INTEGER
);
CREATE INDEX media_owner ON media (owner_profile_id, purpose, status, position);
CREATE INDEX media_reels ON media (kind, purpose, status, created_at);

CREATE TABLE collections (
  id               TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 40),
  description      TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  cover_media_id   TEXT REFERENCES media (id) ON DELETE SET NULL,
  visibility       TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);
CREATE INDEX collections_owner ON collections (owner_profile_id, sort_order);

CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  media_id      TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, media_id)
);

CREATE TABLE media_views (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id          TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  viewer_profile_id TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX media_views_media ON media_views (media_id);

CREATE TABLE likes (
  media_id   TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (media_id, profile_id)
);
CREATE INDEX likes_profile ON likes (profile_id);

-- ─────────────────────────── Jobs ───────────────────────────

CREATE TABLE jobs (
  id                TEXT PRIMARY KEY,
  owner_profile_id  TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  description       TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  category          TEXT,
  tags              TEXT NOT NULL DEFAULT '[]',
  location          TEXT NOT NULL DEFAULT 'Worldwide',
  country_code      TEXT,
  city              TEXT,
  flag              TEXT,
  is_worldwide      INTEGER NOT NULL DEFAULT 0,
  languages         TEXT NOT NULL DEFAULT '[]',
  compensation_type TEXT NOT NULL DEFAULT 'not_selected' CHECK (compensation_type IN ('not_selected', 'barter', 'fixed', 'range')),
  budget_min        REAL,
  budget_max        REAL,
  currency          TEXT,
  deliverables      TEXT NOT NULL DEFAULT '[]',
  deadline          INTEGER,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'removed')),
  published_at      INTEGER,
  closed_at         INTEGER,
  views_count       INTEGER NOT NULL DEFAULT 0,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX jobs_feed ON jobs (status, published_at DESC, id);
CREATE INDEX jobs_owner ON jobs (owner_profile_id, created_at DESC);

CREATE TABLE job_media (
  job_id   TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, media_id)
);

CREATE TABLE applications (
  id                 TEXT PRIMARY KEY,
  job_id             TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  creator_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  message            TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  status             TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'withdrawn')),
  shortlisted_at     INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  withdrawn_at       INTEGER
);
-- One active application per creator per job; withdrawn ones stay in history.
CREATE UNIQUE INDEX applications_one_active ON applications (job_id, creator_profile_id) WHERE status = 'submitted';
CREATE INDEX applications_creator ON applications (creator_profile_id, created_at DESC);

CREATE TABLE application_media (
  application_id TEXT NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  media_id       TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  position       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (application_id, media_id)
);

CREATE TABLE saved_jobs (
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  job_id     TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, job_id)
);

-- ─────────────────────────── Contacts ───────────────────────────

-- A request between two profiles; accepted = confirmed contacts. pair_key = "<smaller id>|<larger id>".
CREATE TABLE contact_requests (
  id                   TEXT PRIMARY KEY,
  sender_profile_id    TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  recipient_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  pair_key             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'removed')),
  origin               TEXT NOT NULL DEFAULT 'request' CHECK (origin IN ('request', 'review_invite')),
  created_at           INTEGER NOT NULL,
  responded_at         INTEGER,
  CHECK (sender_profile_id <> recipient_profile_id)
);
CREATE UNIQUE INDEX contact_requests_live_pair ON contact_requests (pair_key) WHERE status IN ('pending', 'accepted');
CREATE INDEX contact_requests_recipient ON contact_requests (recipient_profile_id, status);
CREATE INDEX contact_requests_sender ON contact_requests (sender_profile_id, status);

-- ─────────────────────────── Messages ───────────────────────────

CREATE TABLE conversations (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'job')),
  pair_key        TEXT NOT NULL,
  related_job_id  TEXT NOT NULL DEFAULT '',   -- '' for a direct chat (keeps the UNIQUE below simple)
  last_message_id TEXT,
  last_message_at INTEGER,
  created_at      INTEGER NOT NULL,
  UNIQUE (pair_key, related_job_id)
);

CREATE TABLE conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  profile_id      TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  joined_at       INTEGER NOT NULL,
  muted           INTEGER NOT NULL DEFAULT 0,
  hidden_at       INTEGER,
  PRIMARY KEY (conversation_id, profile_id)
);
CREATE INDEX conversation_participants_profile ON conversation_participants (profile_id);

CREATE TABLE conversation_read_state (
  conversation_id      TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  profile_id           TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  last_read_at         INTEGER NOT NULL DEFAULT 0,
  last_read_message_id TEXT,
  PRIMARY KEY (conversation_id, profile_id)
);

CREATE TABLE messages (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  kind              TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'media')),
  body              TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  created_at        INTEGER NOT NULL,
  edited_at         INTEGER,
  deleted_at        INTEGER
);
CREATE INDEX messages_conversation ON messages (conversation_id, created_at DESC, id);

CREATE TABLE message_attachments (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  media_id   TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, media_id)
);

-- ─────────────────────────── Reviews ───────────────────────────

CREATE TABLE review_requests (
  id                   TEXT PRIMARY KEY,
  requester_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  contact_profile_id   TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  created_at           INTEGER NOT NULL,
  expires_at           INTEGER NOT NULL,
  completed_at         INTEGER
);
CREATE UNIQUE INDEX review_requests_one_pending ON review_requests (requester_profile_id, contact_profile_id) WHERE status = 'pending';
CREATE INDEX review_requests_contact ON review_requests (contact_profile_id, status);

CREATE TABLE review_invites (
  id                     TEXT PRIMARY KEY,
  owner_profile_id       TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  token_hash             TEXT NOT NULL UNIQUE,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked', 'expired')),
  created_at             INTEGER NOT NULL,
  expires_at             INTEGER NOT NULL,
  accepted_by_profile_id TEXT,
  accepted_at            INTEGER,
  used_at                INTEGER,
  revoked_at             INTEGER
);
CREATE INDEX review_invites_owner ON review_invites (owner_profile_id, created_at);

CREATE TABLE reviews (
  id                   TEXT PRIMARY KEY,
  author_profile_id    TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  author_user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipient_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  quality              INTEGER NOT NULL CHECK (quality BETWEEN 1 AND 5),
  speed                INTEGER NOT NULL CHECK (speed BETWEEN 1 AND 5),
  contact              INTEGER NOT NULL CHECK (contact BETWEEN 1 AND 5),
  comment              TEXT NOT NULL CHECK (length(comment) BETWEEN 1 AND 2000),
  request_id           TEXT,
  invite_id            TEXT,
  status               TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at           INTEGER NOT NULL,
  CHECK (author_profile_id <> recipient_profile_id)
);
-- One published review per author ACCOUNT per profile.
CREATE UNIQUE INDEX reviews_one_per_account ON reviews (author_user_id, recipient_profile_id) WHERE status = 'published';
CREATE INDEX reviews_recipient ON reviews (recipient_profile_id, status, created_at DESC);

-- ─────────────────────────── Notifications ───────────────────────────

CREATE TABLE notifications (
  id                   TEXT PRIMARY KEY,
  recipient_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  type                 TEXT NOT NULL,
  actor_profile_id     TEXT,
  payload              TEXT NOT NULL DEFAULT '{}',
  created_at           INTEGER NOT NULL,
  read_at              INTEGER
);
CREATE INDEX notifications_recipient ON notifications (recipient_profile_id, created_at DESC);
CREATE INDEX notifications_unread ON notifications (recipient_profile_id) WHERE read_at IS NULL;

-- ─────────────────────────── System ───────────────────────────

CREATE TABLE reports (
  id                  TEXT PRIMARY KEY,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  target_type         TEXT NOT NULL CHECK (target_type IN ('profile', 'media', 'job', 'message', 'review')),
  target_id           TEXT NOT NULL,
  reason              TEXT NOT NULL CHECK (reason IN ('spam', 'scam', 'inappropriate', 'harassment', 'other')),
  details             TEXT,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at          INTEGER NOT NULL
);
CREATE INDEX reports_status ON reports (status, created_at);

CREATE TABLE audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  detail        TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE demo_seed_versions (
  version    TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
