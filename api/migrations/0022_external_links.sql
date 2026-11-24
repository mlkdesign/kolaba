-- 0022 (FIX 170): Links & Contact → External links — a profile's own named links (any site), up to five, in order.
CREATE TABLE IF NOT EXISTS profile_external_links (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  url        TEXT NOT NULL CHECK (length(url) <= 300),
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS profile_external_links_profile ON profile_external_links (profile_id, position);
