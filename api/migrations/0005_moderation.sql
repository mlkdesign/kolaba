-- APP STORE READINESS (2026-11-09): moderation (reports, content review, sanctions), blocks, feedback, chat reactions,
-- voice messages, duplicate-send protection. Additive: new tables and nullable / defaulted columns. The only rebuilt
-- table is `reports` (its CHECKs change); nothing references it, so no cascade can fire. Existing accounts, profiles,
-- media and messages are not changed: every existing row starts as review_status = 'approved'.
-- Backup before applying: backups/app-store-readiness-2026-11-09/kolaba-db-before-moderation.sql

PRAGMA defer_foreign_keys = true;

-- ─────────────────────────── Reports (rebuilt) ───────────────────────────
-- Target types: user (a profile), post (a job), media, message, conversation, review.
-- Categories: spam, sexual, violence, harassment, hate, scam, impersonation, copyright, illegal, other.
-- Status: pending → under_review → resolved | dismissed.
CREATE TABLE reports_v2 (
  id                       TEXT PRIMARY KEY,
  reporter_user_id         TEXT,                       -- NULL after the reporter deleted their account
  reporter_profile_id      TEXT,
  source                   TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'auto')),
  target_type              TEXT NOT NULL CHECK (target_type IN ('user', 'post', 'media', 'message', 'conversation', 'review')),
  target_id                TEXT NOT NULL,
  target_profile_id        TEXT,                       -- the reported profile (owner of the content)
  target_user_id           TEXT,                       -- its account (never shown to the reporter)
  conversation_id          TEXT,
  category                 TEXT NOT NULL CHECK (category IN ('spam', 'sexual', 'violence', 'harassment', 'hate', 'scam',
                                                           'impersonation', 'copyright', 'illegal', 'other')),
  details                  TEXT CHECK (details IS NULL OR length(details) <= 1000),
  priority                 TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'resolved', 'dismissed')),
  resolution               TEXT,
  consent_shared_messages  INTEGER NOT NULL DEFAULT 0,
  context                  TEXT NOT NULL DEFAULT '{}',  -- JSON: what the moderator needs (title, excerpt) — never tokens
  handled_by               TEXT,
  handled_at               INTEGER,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
INSERT INTO reports_v2 (id, reporter_user_id, reporter_profile_id, target_type, target_id, category, details, status, created_at, updated_at)
  SELECT r.id, (SELECT owner_user_id FROM profiles WHERE id = r.reporter_profile_id), r.reporter_profile_id,
         CASE r.target_type WHEN 'profile' THEN 'user' WHEN 'job' THEN 'post' ELSE r.target_type END, r.target_id,
         CASE r.reason WHEN 'inappropriate' THEN 'other' ELSE r.reason END, r.details,
         CASE r.status WHEN 'open' THEN 'pending' ELSE r.status END, r.created_at, r.created_at
    FROM reports r;
DROP TABLE reports;
ALTER TABLE reports_v2 RENAME TO reports;
CREATE INDEX reports_queue ON reports (status, priority, created_at);
CREATE INDEX reports_target ON reports (target_type, target_id);
CREATE INDEX reports_target_user ON reports (target_user_id, created_at);
-- One open report per reporter and target (no flood of identical reports).
CREATE UNIQUE INDEX reports_one_open ON reports (reporter_user_id, target_type, target_id)
  WHERE status IN ('pending', 'under_review') AND reporter_user_id IS NOT NULL;

-- Messages the reporter explicitly agreed to share with moderators: a copy of only those (and a little context), kept
-- with the report. Moderators never read conversations directly. Purged 180 days after the report is closed.
CREATE TABLE report_evidence (
  report_id         TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  message_id        TEXT NOT NULL,
  sender_profile_id TEXT,
  is_reported       INTEGER NOT NULL DEFAULT 0,      -- 1: the message the report is about; 0: context
  body              TEXT NOT NULL DEFAULT '',
  attachments       TEXT NOT NULL DEFAULT '[]',      -- JSON [{mediaId, kind}] — opened through signed URLs only
  sent_at           INTEGER NOT NULL,
  PRIMARY KEY (report_id, message_id)
);

-- Every moderation decision (the admin panel's history per report / target). Admin access is also in admin_logs.
CREATE TABLE moderation_actions (
  id              TEXT PRIMARY KEY,
  report_id       TEXT,
  target_type     TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  target_user_id  TEXT,
  action          TEXT NOT NULL,       -- dismiss, review, remove, restore, warn, restrict, suspend, ban, unrestrict, resolve, approve, reject
  reason          TEXT,
  detail          TEXT,                -- JSON
  admin_id        TEXT,
  admin_email     TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX moderation_actions_target ON moderation_actions (target_type, target_id, created_at);
CREATE INDEX moderation_actions_user ON moderation_actions (target_user_id, created_at);
CREATE INDEX moderation_actions_report ON moderation_actions (report_id);

-- ─────────────────────────── Content review ───────────────────────────
-- pending: waits for a moderator · approved · flagged: automatic checks found something · rejected · removed (after publication)
ALTER TABLE media ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (review_status IN ('pending', 'approved', 'flagged', 'rejected', 'removed'));
ALTER TABLE media ADD COLUMN review_reason TEXT;
ALTER TABLE media ADD COLUMN reviewed_at INTEGER;
ALTER TABLE media ADD COLUMN auto_flags TEXT;                       -- JSON from automatic checks
CREATE INDEX media_review ON media (review_status, created_at);

ALTER TABLE jobs ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (review_status IN ('pending', 'approved', 'flagged', 'rejected', 'removed'));
ALTER TABLE jobs ADD COLUMN review_reason TEXT;
ALTER TABLE jobs ADD COLUMN auto_flags TEXT;

ALTER TABLE reviews ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (review_status IN ('pending', 'approved', 'flagged', 'rejected', 'removed'));
ALTER TABLE reviews ADD COLUMN review_reason TEXT;

-- ─────────────────────────── Sanctions ───────────────────────────
-- users.status 'suspended' = no sign-in (existing). A restriction keeps sign-in but blocks posting until it ends.
ALTER TABLE users ADD COLUMN restricted_until INTEGER;
ALTER TABLE users ADD COLUMN restriction_reason TEXT;
ALTER TABLE users ADD COLUMN banned_at INTEGER;
ALTER TABLE users ADD COLUMN warnings_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
ALTER TABLE users ADD COLUMN terms_version TEXT;

-- A permanently banned address can't open a new account (sha256 of the lower-cased e-mail only).
CREATE TABLE banned_identities (
  email_hash TEXT PRIMARY KEY,
  reason     TEXT,
  created_at INTEGER NOT NULL
);

-- ─────────────────────────── Blocks ───────────────────────────
-- Account-level: blocking one profile of a person blocks the person (all their profiles) for every profile of the
-- blocker. blocked_profile_id is the profile that was blocked (what the Blocked list shows).
CREATE TABLE blocks (
  blocker_user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocker_profile_id TEXT,
  blocked_profile_id TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);
CREATE INDEX blocks_blocked ON blocks (blocked_user_id);

-- ─────────────────────────── Feedback ───────────────────────────
CREATE TABLE feedback (
  id               TEXT PRIMARY KEY,
  user_id          TEXT REFERENCES users (id) ON DELETE SET NULL,
  profile_id       TEXT,
  category         TEXT NOT NULL CHECK (category IN ('suggestion', 'bug', 'general', 'other')),
  message          TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  attachment_key   TEXT,                -- R2 key of the screenshot (fb/<id>.<ext>)
  attachment_mime  TEXT,
  attachment_bytes INTEGER,
  app_version      TEXT,
  os_version       TEXT,
  platform         TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  admin_note       TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  resolved_at      INTEGER
);
CREATE INDEX feedback_status ON feedback (status, created_at DESC);
CREATE INDEX feedback_user ON feedback (user_id);

-- ─────────────────────────── Chat ───────────────────────────
-- The sender's own id for a message (retries never create a second copy).
ALTER TABLE messages ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX messages_client_id ON messages (conversation_id, sender_profile_id, client_id) WHERE client_id IS NOT NULL;
-- Who opened the conversation (new-contact anti-spam limits).
ALTER TABLE conversations ADD COLUMN created_by_profile_id TEXT;

CREATE TABLE message_reactions (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'like' CHECK (kind IN ('like')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, profile_id, kind)
);

-- A voice message: the audio file lives in R2 (private, served through signed URLs to participants only).
CREATE TABLE message_voice (
  message_id  TEXT PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  duration    REAL NOT NULL,
  waveform    TEXT NOT NULL DEFAULT '[]',   -- JSON array of 0…1 samples (≤ 64)
  created_at  INTEGER NOT NULL
);
