-- FIX 128: a job has one optional Cover (jobs.cover_media_id) and up to 10 separate Reference Media (job_media);
-- a review can carry up to 10 media of its own (review_media). Applications no longer keep a media snapshot: the
-- creator's latest portfolio videos are picked when the application is read (application_media is left in place,
-- unused, nothing deleted).

ALTER TABLE jobs ADD COLUMN cover_media_id TEXT REFERENCES media (id) ON DELETE SET NULL;

-- Demo data: four demo jobs that had a single photo show the "no media" state (their files are kept).
DELETE FROM job_media WHERE job_id IN (
  SELECT j.id FROM jobs j WHERE j.is_demo = 1 AND j.status = 'published' AND j.cover_media_id IS NULL
    AND (SELECT COUNT(*) FROM job_media x WHERE x.job_id = j.id) = 1 ORDER BY j.id LIMIT 4);

-- The first available photo of the old top gallery becomes the Cover; the rest stay as References, in order.
-- Idempotent: a job that has a Cover is left alone, and a Cover is never also a Reference.
UPDATE jobs SET cover_media_id = (
    SELECT jm.media_id FROM job_media jm JOIN media m ON m.id = jm.media_id
    WHERE jm.job_id = jobs.id AND m.kind = 'photo' AND m.status = 'ready' ORDER BY jm.position, jm.media_id LIMIT 1)
  WHERE cover_media_id IS NULL;
DELETE FROM job_media WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_media.job_id AND j.cover_media_id = job_media.media_id);

CREATE TABLE IF NOT EXISTS review_media (
  review_id              TEXT NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
  media_id               TEXT NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  uploaded_by_profile_id TEXT NOT NULL,
  position               INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL,
  PRIMARY KEY (review_id, media_id)
);
CREATE INDEX IF NOT EXISTS review_media_media ON review_media (media_id);
