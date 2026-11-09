-- Follows (Reels / profile Follow — one-directional, not contacts), as in the iOS app's ProfileFollowsStore.
CREATE TABLE follows (
  follower_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  followee_profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  created_at          INTEGER NOT NULL,
  PRIMARY KEY (follower_profile_id, followee_profile_id),
  CHECK (follower_profile_id <> followee_profile_id)
);
CREATE INDEX follows_followee ON follows (followee_profile_id, created_at DESC);
