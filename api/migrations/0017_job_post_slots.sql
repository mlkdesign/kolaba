-- FEATURE 130: an administrator adds job-post slots to a business account (on top of its plan's limit) or gives the
-- used ones back (a reset: only publications after it count — the usage rows themselves stay, nothing is deleted).
ALTER TABLE users ADD COLUMN job_posts_bonus INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN job_posts_reset_at INTEGER;
