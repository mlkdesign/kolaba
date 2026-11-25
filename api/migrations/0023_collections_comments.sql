-- 0023 (FEATURE 134): Collections (title up to 100, description up to 1000) and Video Comments (with replies, likes,
-- moderation). SQLite can't change a CHECK in place: `collections` and `reports` are rebuilt. Their child rows
-- (collection_items, report_evidence) are kept aside first and put back — a DROP's implicit delete would cascade them.
PRAGMA defer_foreign_keys = true;

-- ─── Collections: longer title and description ───
CREATE TABLE collection_items_keep AS SELECT * FROM collection_items;

CREATE TABLE collections_new (
  id               TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  description      TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  cover_media_id   TEXT REFERENCES media (id) ON DELETE SET NULL,
  visibility       TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER
);
INSERT INTO collections_new (id, owner_profile_id, title, description, cover_media_id, visibility, sort_order, created_at, updated_at)
  SELECT id, owner_profile_id, title, description, cover_media_id, visibility, sort_order, created_at, created_at FROM collections;
DROP TABLE collection_items;
DROP TABLE collections;
ALTER TABLE collections_new RENAME TO collections;
CREATE INDEX collections_owner ON collections (owner_profile_id, sort_order);

CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  media_id      TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, media_id)
);
INSERT INTO collection_items (collection_id, media_id, position)
  SELECT k.collection_id, k.media_id, k.position FROM collection_items_keep k WHERE EXISTS (SELECT 1 FROM collections c WHERE c.id = k.collection_id);
DROP TABLE collection_items_keep;
CREATE INDEX collection_items_media ON collection_items (media_id);

-- ─── Reports: a comment can be reported ───
CREATE TABLE report_evidence_keep AS SELECT * FROM report_evidence;

CREATE TABLE reports_new (
  id                       TEXT PRIMARY KEY,
  reporter_user_id         TEXT,
  reporter_profile_id      TEXT,
  source                   TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'auto')),
  target_type              TEXT NOT NULL CHECK (target_type IN ('user', 'post', 'media', 'message', 'conversation', 'review', 'comment')),
  target_id                TEXT NOT NULL,
  target_profile_id        TEXT,
  target_user_id           TEXT,
  conversation_id          TEXT,
  category                 TEXT NOT NULL CHECK (category IN ('spam', 'sexual', 'violence', 'harassment', 'hate', 'scam',
                                                           'impersonation', 'copyright', 'illegal', 'other')),
  details                  TEXT CHECK (details IS NULL OR length(details) <= 1000),
  priority                 TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'resolved', 'dismissed')),
  resolution               TEXT,
  consent_shared_messages  INTEGER NOT NULL DEFAULT 0,
  context                  TEXT NOT NULL DEFAULT '{}',
  handled_by               TEXT,
  handled_at               INTEGER,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
INSERT INTO reports_new SELECT id, reporter_user_id, reporter_profile_id, source, target_type, target_id, target_profile_id, target_user_id,
  conversation_id, category, details, priority, status, resolution, consent_shared_messages, context, handled_by, handled_at, created_at,
  updated_at FROM reports;
DROP TABLE report_evidence;
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
CREATE INDEX reports_queue ON reports (status, priority, created_at);
CREATE INDEX reports_target ON reports (target_type, target_id);
CREATE INDEX reports_target_user ON reports (target_user_id, created_at);
CREATE UNIQUE INDEX reports_one_open ON reports (reporter_user_id, target_type, target_id)
  WHERE status IN ('pending', 'under_review') AND reporter_user_id IS NOT NULL;

CREATE TABLE report_evidence (
  report_id         TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  message_id        TEXT NOT NULL,
  sender_profile_id TEXT,
  is_reported       INTEGER NOT NULL DEFAULT 0,
  body              TEXT NOT NULL DEFAULT '',
  attachments       TEXT NOT NULL DEFAULT '[]',
  sent_at           INTEGER NOT NULL,
  PRIMARY KEY (report_id, message_id)
);
INSERT INTO report_evidence SELECT * FROM report_evidence_keep;
DROP TABLE report_evidence_keep;

-- ─── Video comments ───
-- One level of replies: a reply's parent is always a top-level comment (a reply to a reply joins that thread, naming
-- whom it answers). A comment with replies is "deleted" in place (its text gone) so the thread stays readable.
CREATE TABLE media_comments (
  id                  TEXT PRIMARY KEY,
  media_id            TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  author_profile_id   TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  parent_id           TEXT REFERENCES media_comments (id) ON DELETE CASCADE,
  reply_to_profile_id TEXT,
  body                TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  status              TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'deleted', 'removed')),
  likes_count         INTEGER NOT NULL DEFAULT 0,
  replies_count       INTEGER NOT NULL DEFAULT 0,
  client_key          TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX media_comments_thread ON media_comments (media_id, parent_id, created_at);
CREATE INDEX media_comments_author ON media_comments (author_profile_id, created_at);
CREATE UNIQUE INDEX media_comments_client ON media_comments (author_profile_id, client_key) WHERE client_key IS NOT NULL;

CREATE TABLE media_comment_likes (
  comment_id  TEXT NOT NULL REFERENCES media_comments (id) ON DELETE CASCADE,
  profile_id  TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (comment_id, profile_id)
);

ALTER TABLE media ADD COLUMN comments_count INTEGER NOT NULL DEFAULT 0;
