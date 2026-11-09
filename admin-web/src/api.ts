// The one client for the admin API. The session token lives only in this module's memory: a reload, a new tab or
// closing the tab signs out (no localStorage, no cookies — GitHub Pages and the Worker are different sites).

export const API_URL: string = import.meta.env.VITE_API_URL;
export const APP_URL: string = import.meta.env.VITE_APP_URL;

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
let onMustChange: (() => void) | null = null;

export function setSession(next: string | null) { token = next; }
export function onSessionLost(handler: () => void, mustChange: () => void) { onUnauthorized = handler; onMustChange = mustChange; }

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export async function api<T = any>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/admin${path}`, {
      method, signal, cache: 'no-store', credentials: 'omit',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error?.code ?? `http_${res.status}`;
    if (res.status === 401 && path !== '/login') onUnauthorized?.();
    if (res.status === 403 && code === 'password_change_required') onMustChange?.();
    throw new ApiError(res.status, code);
  }
  return data as T;
}

const messages: Record<string, string> = {
  network_error: 'The server could not be reached. Check your connection and try again.',
  invalid_credentials: 'Incorrect email or password.',
  account_locked: 'Too many attempts. Sign-in is locked for 15 minutes.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  session_expired: 'Your session has expired. Sign in again.',
  admin_auth_required: 'Sign in to continue.',
  password_too_short: 'The new password must be at least 12 characters.',
  password_unchanged: 'The new password must differ from the current one.',
  username_taken: 'This username is already taken.',
  invalid_username: 'Usernames use 3–30 characters: a–z, 0–9, dot and underscore.',
  invalid_link: 'Enter a valid website address.',
  reason_required: 'Enter a reason (at least 3 characters).',
  invalid_transition: 'This action is not available for the current status. Refresh and try again.',
  user_not_found: 'This account no longer exists.',
  profile_not_found: 'This profile no longer exists.',
  job_not_found: 'This job no longer exists.',
  media_not_found: 'This media file no longer exists.',
  invalid_request: 'Some fields are invalid. Check the form and try again.',
  payload_too_large: 'The request is too large.',
  internal_error: 'Server error. Try again in a moment.',
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return messages[e.code] ?? `Request failed (${e.code}).`;
  return 'Something went wrong.';
}

// ─── shapes ───

export interface Card {
  id: string; type: 'creator' | 'business'; displayName: string; username: string; avatarUrl: string | null; isPro: boolean;
  isDemo: boolean; location: string | null; category: string | null; userId?: string;
}
export interface AdminProfile extends Card {
  status: string; bio: string; website: string | null; visibility: string; createdAt: number; publicUrl: string | null;
  city?: string | null; country?: string | null;
  subscription?: { plan: string; source: string; startedAt: number; expiresAt: number | null } | null;
}
export interface UserRow {
  id: string; email: string; status: 'active' | 'blocked' | 'deleted'; isDemo: boolean; createdAt: number; blockedReason: string | null;
  accountType: 'creator' | 'business' | 'both' | 'none'; isPro: boolean; profiles: AdminProfile[];
}
export interface LogRow {
  id: number; adminEmail: string | null; action: string; entityType: string | null; entityId: string | null; result: 'success' | 'failure';
  reason: string | null; detail: Record<string, any> | null; createdAt: number;
}
export interface UserDetail extends UserRow {
  emailVerifiedAt: number | null; emailVerification: string | null; blockedAt: number | null; deletedAt: number | null;
  deletedReason: string | null; counts: { jobs: number; media: number; sessions: number };
  logs: { id: number; admin_email: string; action: string; result: string; reason: string | null; created_at: number }[];
}
export interface JobRow {
  id: string; title: string; category: string | null; status: string; moderationReason: string | null; publishedAt: number | null;
  createdAt: number; applicationsCount: number; thumbnailUrl: string | null; author: Card | null;
}
export interface Media {
  id: string; kind: 'photo' | 'video'; purpose: string; url: string | null; posterUrl: string | null; title: string | null;
  duration: number | null; createdAt: number; width: number | null; height: number | null;
}
export interface JobDetail {
  id: string; title: string; description: string; category: string | null; tags: string[]; location: string; flag: string | null;
  compensationType: string; budgetMin: number | null; budgetMax: number | null; currency: string | null;
  deliverables: { kind: string; count: number }[]; deadline: number | null; status: string; publishedAt: number | null;
  closedAt: number | null; createdAt: number; viewsCount: number; isDemo: boolean; media: Media[]; owner: Card | null;
  ownerProfileId: string; ownerUserId: string; moderationStatus: string | null; moderationReason: string | null;
  moderatedAt: number | null; applicationsTotal: number; applicationsWithdrawn: number; liveUrl: string | null;
  logs: UserDetail['logs'];
}
export interface MediaRow extends Media {
  status: 'visible' | 'hidden'; moderationReason: string | null; bytes: number | null; jobId: string | null; owner: Card | null;
  publicUrl: string | null; ownerProfileId: string;
}
export interface Paged<T> { total: number; page: number; limit: number; items: T[] }
export interface Dashboard {
  stats: { totalUsers: number; blockedUsers: number; creatorProfiles: number; businessProfiles: number; totalJobs: number;
           activeJobs: number; hiddenJobs: number; proAccounts: number };
  recent: { type: 'user.registered' | 'job.published'; id: string; title: string; subtitle: string | null; at: number }[];
}

export function query(params: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const text = s.toString();
  return text ? `?${text}` : '';
}
