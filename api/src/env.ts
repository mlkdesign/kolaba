// Bindings and settings of the kolaba-api Worker (wrangler.jsonc). Secrets are set with `wrangler secret put`.
export interface Env {
  DB: D1Database;
  /** R2 bucket kolaba-media — optional until R2 is enabled on the account (uploads answer 503 without it). */
  MEDIA?: R2Bucket;
  /** Workers Rate Limiting bindings. */
  RL_AUTH?: RateLimit;
  RL_WRITE?: RateLimit;

  /** Comma-separated origins allowed to call the API from a browser. */
  ALLOWED_ORIGINS: string;
  /** Public URL of the web app (links in e-mails and review invites). */
  APP_URL: string;
  /** Public URL of this API (absolute media URLs). */
  API_URL: string;
  EMAIL_FROM: string;
  /** New real accounts allowed per UTC day (public demo protection). */
  SIGNUPS_PER_DAY: string;
  MAX_PHOTO_MB: string;
  MAX_VIDEO_MB: string;
  MAX_VIDEO_SECONDS: string;
  /** Comma-separated e-mails allowed to sign up (empty: anyone). Until a sending domain is verified, Resend only
   *  delivers to its own account's address, so sign-up is limited to it. */
  SIGNUP_ALLOWED_EMAILS?: string;
  /** Closed test: every verification / reset code goes to this inbox instead of the address typed in (the address is
   *  then NOT proven — users.email_verification = 'test_inbox'). Unset: codes go to their owners (the default). */
  TEST_CODE_INBOX?: string;
  /** Comma-separated e-mails allowed to switch their own profile between Free and PRO for testing. */
  PRO_TEST_EMAILS?: string;

  /** Admin panel: comma-separated administrator e-mails (only these can ever sign in to /v1/admin). */
  ADMIN_EMAILS?: string;
  /** Admin panel: origins allowed to call /v1/admin/* from a browser. */
  ADMIN_ORIGINS?: string;
  /** Secret: the first administrator password. Used once to create the admins row, then never read again. */
  ADMIN_INITIAL_PASSWORD?: string;

  /** Secrets. */
  RESEND_API_KEY?: string;
  /** HMAC key for signed media URLs of private files. */
  MEDIA_URL_SECRET?: string;
}

export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'moderator' | 'admin';
  isDemo: boolean;
  sessionId: string;
}

export interface ActingProfile {
  id: string;
  type: 'creator' | 'business';
  ownerUserId: string;
}

export interface AdminSession {
  id: string;
  email: string;
  sessionId: string;
  mustChangePassword: boolean;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user?: AuthUser; profile?: ActingProfile; admin?: AdminSession };
};
