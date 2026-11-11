-- Messenger rework: replies, delivery receipts, chat files (private R2 objects, signed URLs only).
ALTER TABLE messages ADD COLUMN reply_to_id TEXT;
ALTER TABLE conversation_read_state ADD COLUMN last_delivered_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE message_files (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX message_files_message ON message_files (message_id);
