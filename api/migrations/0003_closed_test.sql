-- Closed test (2026-11-09): how an address was confirmed, a chat's own "deleted up to" mark.
-- users.email_verification: NULL / 'owner' — the address owner entered the code; 'test_inbox' — the code went to the
-- closed test's shared inbox, so the address itself is NOT proven (such accounts re-verify before a public launch).
ALTER TABLE users ADD COLUMN email_verification TEXT;
-- A participant's "Delete chat": everything up to this moment is gone for them (the other side keeps theirs).
ALTER TABLE conversation_participants ADD COLUMN cleared_at INTEGER;
