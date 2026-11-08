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

export type AppEnv = {
  Bindings: Env;
  Variables: { user?: AuthUser; profile?: ActingProfile };
};
