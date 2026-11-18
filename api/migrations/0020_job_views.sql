-- FIX 140: a job's views are the people who saw it — in the feed or on its page — each account once.
-- The count lives on jobs.views_count (earlier views kept); a trigger adds one per new viewer.
CREATE TABLE job_views (
  job_id         TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  viewer_user_id TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (job_id, viewer_user_id)
);

CREATE TRIGGER job_views_count AFTER INSERT ON job_views
BEGIN
  UPDATE jobs SET views_count = views_count + 1 WHERE id = NEW.job_id;
END;
