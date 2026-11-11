-- FEATURE 115: password reset tokens, admin PRO grants, push device tokens. Additive only — no existing row changes.

-- A verified reset code becomes a short-lived one-time token that may set the new password.
CREATE TABLE password_reset_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX password_reset_tokens_user ON password_reset_tokens (user_id, created_at);

-- Free PRO given by an administrator to one profile (the entitlement itself is the subscriptions row it points to).
CREATE TABLE pro_grants (
  id              TEXT PRIMARY KEY,
  profile_id      TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  plan            TEXT NOT NULL CHECK (plan IN ('creator_pro', 'business_pro')),
  source          TEXT NOT NULL DEFAULT 'admin_grant',
  subscription_id TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  granted_by      TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  request_key     TEXT UNIQUE,      -- the admin form's idempotency key: the same submit never grants twice
  created_at      INTEGER NOT NULL
);
CREATE INDEX pro_grants_profile ON pro_grants (profile_id, status);

-- APNs device tokens of an account (a push is routed to the owner of the recipient profile).
CREATE TABLE device_tokens (
  token        TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  environment  TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('production', 'sandbox')),
  previews     INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX device_tokens_user ON device_tokens (user_id);
