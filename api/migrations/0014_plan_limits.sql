-- Entitlements & Usage Limits (src/lib/entitlements.ts).
--
-- plan_config: the plans' limits as JSON, one row ('current'). Absent: the defaults in code (DEFAULT_PLAN_CONFIG). The
-- admin API (PUT /v1/admin/plan-config) changes it without a new app or Worker release.
CREATE TABLE plan_config (
  id         TEXT PRIMARY KEY CHECK (id = 'current'),
  config     TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- usage_events: one row per counted use of a limited feature (a job's first publication). Never deleted with the thing it
-- counts (a deleted / archived job keeps its row: deleting doesn't give the publication back). Account level: user_id
-- is the owner account; profile_id says which profile used it. UNIQUE (feature, subject_id): the same job is never
-- counted twice (re-opening an archived job is not a new publication).
CREATE TABLE usage_events (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  profile_id   TEXT,
  feature      TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (feature, subject_id)
);
CREATE INDEX usage_events_period ON usage_events (user_id, feature, period_start);

-- Jobs already published count in the month (UTC) they were first published.
INSERT OR IGNORE INTO usage_events (id, user_id, profile_id, feature, subject_id, period_start, created_at)
  SELECT 'use_' || j.id, p.owner_user_id, j.owner_profile_id, 'job_posts', j.id,
         CAST(strftime('%s', date(j.published_at / 1000, 'unixepoch', 'start of month')) AS INTEGER) * 1000, j.published_at
    FROM jobs j JOIN profiles p ON p.id = j.owner_profile_id
   WHERE j.published_at IS NOT NULL;

-- Portfolio limit counts are by owner + purpose + kind + status (already indexed by media_owner).
