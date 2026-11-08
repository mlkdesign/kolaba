// App state (signals) and the one navigation system: five main tabs, each with its own stack of screens. Screens
// below the top stay mounted (hidden), so going back keeps their scroll position and loaded data.
import { computed, signal } from '@preact/signals';
import { get, OwnProfile, post, session, setUnauthorizedHandler } from './api';

export type Tab = 'jobs' | 'chat' | 'kolaba' | 'creators' | 'profile';

export interface Route { screen: string; params?: Record<string, any>; key: number }

export const user = signal<{ id: string; email: string; isDemo: boolean; role: string } | null>(null);
export const profiles = signal<OwnProfile[]>([]);
export const activeProfileId = signal<string | null>(session.profileId);
export const activeProfile = computed(() => profiles.value.find((p) => p.id === activeProfileId.value) ?? null);
export const isBusiness = computed(() => activeProfile.value?.type === 'business');
export const booted = signal(false);

export const tab = signal<Tab>('jobs');
let keySeq = 1;
const root = (screen: string): Route => ({ screen, key: keySeq++ });
const initialStacks = (): Record<Tab, Route[]> => ({
  jobs: [root('jobs')], chat: [root('chat')], kolaba: [root('kolaba')], creators: [root('creators')], profile: [root('profile')],
});
export const stacks = signal<Record<Tab, Route[]>>(initialStacks());

export const badges = signal({ notifications: 0, conversations: 0, contactRequests: 0 });
/** Bumped when something changes that lists should reload (after an action, or new server data). */
export const refreshTick = signal(0);
export const refresh = () => { refreshTick.value++; };

export interface Sheet { id: number; render: (close: () => void) => any; tall?: boolean }
export const sheets = signal<Sheet[]>([]);
export const toast = signal<{ text: string; id: number; tone?: 'error' | 'ok' } | null>(null);

export function push(screen: string, params?: Record<string, any>, inTab: Tab = tab.value) {
  stacks.value = { ...stacks.value, [inTab]: [...stacks.value[inTab], { screen, params, key: keySeq++ }] };
  if (inTab !== tab.value) tab.value = inTab;
}

export function back() {
  const stack = stacks.value[tab.value];
  if (stack.length > 1) stacks.value = { ...stacks.value, [tab.value]: stack.slice(0, -1) };
}

/** Tapping the current tab again returns to its root. */
export function selectTab(next: Tab) {
  if (next === tab.value && stacks.value[next].length > 1) {
    stacks.value = { ...stacks.value, [next]: stacks.value[next].slice(0, 1) };
    return;
  }
  tab.value = next;
}

export function openSheet(render: Sheet['render'], tall = false) {
  const id = keySeq++;
  sheets.value = [...sheets.value, { id, render, tall }];
  return () => { sheets.value = sheets.value.filter((s) => s.id !== id); };
}

let toastTimer: number | undefined;
export function showToast(text: string, tone?: 'error' | 'ok') {
  toast.value = { text, id: keySeq++, tone };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.value = null; }, 2600);
}

export function applySession(data: { token?: string; user: any; profiles: OwnProfile[] }) {
  if (data.token) session.set(data.token);
  user.value = data.user;
  profiles.value = data.profiles;
  const keep = data.profiles.find((p) => p.id === activeProfileId.value);
  setActiveProfile(keep?.id ?? data.profiles[0]?.id ?? null, false);
}

/** Switching profiles: everything profile-scoped (messages, contacts, notifications, jobs) reloads. */
export function setActiveProfile(id: string | null, resetStacks = true) {
  activeProfileId.value = id;
  session.setProfile(id);
  if (resetStacks) {
    stacks.value = initialStacks();
    tab.value = 'profile';
  }
  badges.value = { notifications: 0, conversations: 0, contactRequests: 0 };
  refresh();
  void syncNow();
}

export async function reloadSession() {
  const data = await get('/v1/auth/session');
  applySession(data);
}

export function signOutLocally() {
  session.set(null);
  session.setProfile(null);
  user.value = null;
  profiles.value = [];
  activeProfileId.value = null;
  stacks.value = initialStacks();
  tab.value = 'jobs';
  sheets.value = [];
}

export async function signOut() {
  try { await post('/v1/auth/logout'); } catch { /* the server session may already be gone */ }
  signOutLocally();
}

setUnauthorizedHandler(() => { if (user.value) signOutLocally(); });

// ─── Polling (the "realtime" of this MVP): adaptive and paused when the tab is hidden ───

export const chatOpen = signal<string | null>(null);
let lastMessageAt: number | null = null;
let pollTimer: number | undefined;

export async function syncNow() {
  if (!session.token || !activeProfileId.value || document.hidden) return;
  try {
    const data = await get('/v1/sync');
    badges.value = data.unread;
    if (lastMessageAt !== null && data.lastMessageAt && data.lastMessageAt !== lastMessageAt) refresh();
    lastMessageAt = data.lastMessageAt ?? 0;
  } catch { /* offline: try again on the next tick */ }
}

function schedule() {
  window.clearTimeout(pollTimer);
  const interval = chatOpen.value ? 4000 : 15000;
  pollTimer = window.setTimeout(async () => { await syncNow(); schedule(); }, interval);
}

export function startPolling() {
  schedule();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { void syncNow(); schedule(); } });
  chatOpen.subscribe(() => schedule());
}
