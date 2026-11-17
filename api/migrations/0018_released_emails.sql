-- FEATURE 135: an account an administrator deleted (soft) frees its e-mail when someone registers with it again: the
-- old account keeps everything, its address moves here (Restore puts it back when it's still free).
ALTER TABLE users ADD COLUMN released_email TEXT;
