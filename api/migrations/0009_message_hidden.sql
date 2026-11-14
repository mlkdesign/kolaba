-- 0009: "Delete for me" — a message hidden for one profile only (the other side keeps it). Additive, reversible by
-- dropping the table.
CREATE TABLE IF NOT EXISTS message_hidden (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  hidden_at  INTEGER NOT NULL,
  PRIMARY KEY (message_id, profile_id)
);
CREATE INDEX IF NOT EXISTS message_hidden_profile ON message_hidden (profile_id);
