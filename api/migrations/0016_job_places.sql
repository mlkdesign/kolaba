-- FEATURE 129 (round 2): a job can name several places (up to 5 — countries or cities); country_code / city / location
-- keep the first one (older apps, the feed's flag).
ALTER TABLE jobs ADD COLUMN places TEXT NOT NULL DEFAULT '[]';
