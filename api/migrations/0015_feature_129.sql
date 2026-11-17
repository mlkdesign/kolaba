-- FEATURE 129: Create Job / Apply / Write Review.
--
-- Jobs: a client's Idempotency-Key for "Publish" — the same request sent again (a retry after a lost answer) returns
-- the job it already created instead of a second one (and never spends a second job post).
ALTER TABLE jobs ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency ON jobs (owner_profile_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Applications: which portfolio videos a PRO application shows — 'auto' (the creator's latest 10, picked when it is
-- read) or 'manual' (the creator's own choice, kept in application_media as references, never copies; shown only while
-- each video is still published in the portfolio and the creator has PRO).
ALTER TABLE applications ADD COLUMN media_mode TEXT NOT NULL DEFAULT 'auto' CHECK (media_mode IN ('auto', 'manual'));

-- Job posts are counted over a rolling 30 days (each publication frees its slot 30 × 24 h later): by created_at.
CREATE INDEX IF NOT EXISTS usage_events_rolling ON usage_events (user_id, feature, created_at);
