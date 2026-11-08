// The one client for kolaba-api. Every request carries the session token and the active profile (X-Profile-Id);
// the server checks both — the UI never decides permissions on its own.

export const API_URL: string = (import.meta as any).env?.VITE_API_URL ?? 'https://kolaba-api.mlkdesignweb.workers.dev';

export type ProfileType = 'creator' | 'business';

export interface Card {
  id: string; type: ProfileType; displayName: string; username: string; city: string | null; country: string | null;
  countryCode: string | null; flag: string | null; location: string | null; category: string | null; avatarUrl: string | null;
  rating: number | null; reviewsCount: number; isPro: boolean; isDemo: boolean;
}

export interface Entitlements {
  plan: string; isPro: boolean; canCreateJobs: boolean; canApply: boolean; canAttachMediaToApplications: boolean;
  hasPortfolio: boolean; collections: 'available' | 'locked' | 'unavailable'; introVideo: 'available' | 'locked' | 'unavailable';
}

export interface OwnProfile extends Card { entitlements: Entitlements }

export interface Media {
  id: string; ownerProfileId: string; kind: 'photo' | 'video'; purpose: string; url: string | null; fallbackUrl: string | null;
  posterUrl: string | null; width: number | null; height: number | null; duration: number | null; title: string | null;
  likesCount: number; viewsCount: number; source: { provider: string; url: string | null; license: string | null; attribution: string | null } | null;
  createdAt: number; isLiked?: boolean; author?: Card;
}

export interface ProfilePage extends Card {
  bio: string; website: string | null; languages: string[]; links: { kind: string; url: string }[];
  socialAccounts: { platform: string; followers: number }[];
  ratings: { rating: number | null; quality: number | null; speed: number | null; contact: number | null; count: number } | null;
  counts: { portfolio: number; jobs: number; contacts: number; likes: number } | null;
  introVideo: Media | null; hideJobPosts: boolean; visibility: string; isOwner: boolean;
  settings?: { showLocation: boolean; whoCanMessage: string; showLinks: boolean; hideJobPosts: boolean };
  entitlements?: Entitlements;
}

export interface Job {
  id: string; ownerProfileId: string; owner: Card | null; title: string; description: string; category: string | null;
  tags: string[]; location: string; countryCode: string | null; city: string | null; flag: string | null; isWorldwide: boolean;
  languages: string[]; compensationType: 'not_selected' | 'barter' | 'fixed' | 'range'; budgetMin: number | null;
  budgetMax: number | null; currency: string | null; deliverables: { kind: string; count: number }[]; deadline: number | null;
  status: 'draft' | 'published' | 'closed' | 'removed'; publishedAt: number | null; closedAt: number | null; createdAt: number;
  viewsCount: number; isDemo: boolean; media: Media[]; applicationsCount: number; myApplicationId: string | null; isSaved: boolean;
  acceptsApplications: boolean;
}

export interface Application {
  id: string; jobId: string; message: string; status: string; createdAt: number; isShortlisted: boolean; applicant: Card | null; media: Media[];
}

export interface Message {
  id: string; conversationId: string; senderProfileId: string; isOutgoing: boolean; kind: string; body: string; createdAt: number;
  attachments: Media[]; isReadByOther?: boolean;
}

export interface Conversation {
  id: string; kind: string; relatedJobId: string | null; relatedJobTitle: string | null; activityAt: number; muted: boolean;
  unreadCount: number; partner: Card | null; lastMessage: Message | null;
}

export interface Notification {
  id: string; type: string; payload: Record<string, any>; createdAt: number; readAt: number | null; actor: Card | null;
}

export interface Review {
  id: string; quality: number; speed: number; contact: number; comment: string; rating: number; createdAt: number; author: Card | null;
}

export interface Page<T> { items: T[]; nextCursor: string | null }

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) { super(message ?? code); }
}

let token: string | null = null;
let profileId: string | null = null;
try { token = localStorage.getItem('kolaba.token'); profileId = localStorage.getItem('kolaba.profile'); } catch { /* private mode */ }

export const session = {
  get token() { return token; },
  get profileId() { return profileId; },
  set(newToken: string | null) {
    token = newToken;
    try { newToken ? localStorage.setItem('kolaba.token', newToken) : localStorage.removeItem('kolaba.token'); } catch { /* */ }
  },
  setProfile(id: string | null) {
    profileId = id;
    try { id ? localStorage.setItem('kolaba.profile', id) : localStorage.removeItem('kolaba.profile'); } catch { /* */ }
  },
};

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = any>(method: string, path: string, body?: unknown, options: { profileId?: string | null; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const acting = options.profileId === undefined ? profileId : options.profileId;
  if (acting) headers['X-Profile-Id'] = acting;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: options.signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'network_error', 'No connection to the server');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = json?.error?.code ?? json?.status ?? `http_${res.status}`;
    if (res.status === 401 && code === 'not_signed_in') onUnauthorized();
    throw new ApiError(res.status, code, json?.error?.message);
  }
  return json as T;
}

export const get = <T = any>(path: string, signal?: AbortSignal) => api<T>('GET', path, undefined, { signal });
export const post = <T = any>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const put = <T = any>(path: string, body?: unknown) => api<T>('PUT', path, body ?? {});
export const patch = <T = any>(path: string, body?: unknown) => api<T>('PATCH', path, body ?? {});
export const del = <T = any>(path: string) => api<T>('DELETE', path);

/** Upload: authorize → PUT the file (streamed to R2) → the media. Progress via XHR. */
export async function uploadFile(file: File, purpose: string, extra: Record<string, unknown> = {},
                                 onProgress?: (fraction: number) => void): Promise<Media> {
  const kind = file.type.startsWith('video/') ? 'video' : 'photo';
  let duration: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  if (kind === 'video') ({ duration, width, height } = await videoInfo(file).catch(() => ({} as any)));
  const ticket = await post<{ mediaId: string; uploadUrl: string }>('/v1/media/uploads', {
    purpose, kind, mime: file.type || 'application/octet-stream', bytes: file.size, duration, width, height, ...extra,
  });
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.uploadUrl);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (profileId) xhr.setRequestHeader('X-Profile-Id', profileId);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      const json = (() => { try { return JSON.parse(xhr.responseText); } catch { return null; } })();
      xhr.status < 300 ? resolve(json) : reject(new ApiError(xhr.status, json?.error?.code ?? 'upload_failed'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network_error'));
    xhr.send(file);
  });
}

function videoInfo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => { resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }); URL.revokeObjectURL(url); };
    v.onerror = () => { reject(new Error('metadata')); URL.revokeObjectURL(url); };
    v.src = url;
  });
}

/** A poster frame for an uploaded video (JPEG), made in the browser. */
export function posterFrom(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const url = URL.createObjectURL(file);
    v.src = url;
    v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
      canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
      canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => { URL.revokeObjectURL(url); resolve(blob ? new File([blob], 'poster.jpg', { type: 'image/jpeg' }) : null); },
        'image/jpeg', 0.82);
    };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
  });
}

/** Human message for an API error code. */
export function errorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'unknown';
  const map: Record<string, string> = {
    invalid_credentials: 'Wrong e-mail or password.', email_taken: 'This e-mail is already registered — log in instead.',
    registration_closed: 'Registration opens once e-mail delivery is connected. Try a demo account meanwhile.',
    email_unavailable: 'E-mail delivery is not configured yet.', code_invalid: 'Wrong code — check the e-mail and try again.',
    code_expired: 'The code expired. Ask for a new one.', password_too_short: 'At least 8 characters.',
    rate_limited: 'Too many attempts — wait a minute and try again.', account_locked: 'Too many attempts — try again in 15 minutes.',
    signups_paused: 'New registrations are paused for today (test environment limit).', username_taken: 'This username is taken.',
    invalid_username: 'Username: 3–30 letters, digits, dots or underscores.', creator_profile_exists: 'You already have a creator profile.',
    business_profile_limit: 'You can have up to 5 business profiles.', already_applied: 'You have already applied to this job.',
    job_closed: 'This job no longer takes applications.', deadline_passed: 'The deadline has passed.', own_job: 'This is your own job.',
    pro_required: 'This needs creator.pro.', not_contact: 'Reviews are for confirmed contacts only.', self_review: 'You can\'t review yourself.',
    already_reviewed: 'You have already reviewed this profile.', messaging_not_allowed: 'This profile doesn\'t accept messages.',
    storage_unavailable: 'File uploads are not enabled on the server yet (R2).', file_too_large: 'The file is too large.',
    invalid_mime_type: 'This file type isn\'t supported.', invalid_file: 'The file doesn\'t match its type.',
    media_limit_reached: 'You have reached the limit for this kind of media.', video_too_long: 'The video is too long.',
    network_error: 'No connection to the server.', invalid_token: 'This invite link is not valid.', invite_expired: 'This invite link has expired.',
    invite_used: 'This invite link has already been used.', invite_revoked: 'This invite link was revoked.',
    same_account: 'That is one of your own profiles.', self_contact: 'That is your own profile.',
  };
  return map[code] ?? (error instanceof ApiError ? `Something went wrong (${code}).` : 'Something went wrong.');
}
