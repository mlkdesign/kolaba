-- FIX 128: a job has no Cover — its media are up to 10 Reference Media (job_media, unchanged); a review can carry up
-- to 10 media of its own (review_media). Applications no longer keep a media snapshot: the creator's latest portfolio
-- videos are picked when the application is read (application_media is left in place, unused, nothing deleted).

-- Demo data: four demo jobs that had a single photo show the "no media" state (their files are kept).
DELETE FROM job_media WHERE job_id IN (
  SELECT j.id FROM jobs j WHERE j.is_demo = 1 AND j.status = 'published'
    AND (SELECT COUNT(*) FROM job_media x WHERE x.job_id = j.id) = 1 ORDER BY j.id LIMIT 4);

CREATE TABLE IF NOT EXISTS review_media (
  review_id              TEXT NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
  media_id               TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  uploaded_by_profile_id TEXT NOT NULL,
  position               INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL,
  PRIMARY KEY (review_id, media_id)
);
CREATE INDEX IF NOT EXISTS review_media_media ON review_media (media_id);
