// The app: auth gate; the five sections side by side (MainTabContainer — the tab bar slides them, no sideways swipe
// between sections, FIX 106); screens pushed over them slide in from the right and go back with an edge swipe; one
// bottom gradient, one tab bar (KolabaTabBar), sheets and toasts.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, session } from './api';
import { CreatorsScreen, ContactsScreen } from './screens/creators';
import { ChatListScreen, ConversationScreen } from './screens/chat';
import { ApplicantsScreen, JobEditor, JobScreen, JobsScreen } from './screens/jobs';
import { NotificationsScreen, ReelsScreen } from './screens/reels';
import { CollectionScreen, EditProfileScreen, InviteScreen, ProfileScreen, ReviewForm, SettingsScreen } from './screens/profile';
import { AuthFlow, CreateProfile } from './screens/auth';
import {
  activeProfile, applySession, back, badges, booted, isBusiness, leaving, profiles, push, Route, selectTab, setActiveProfile, signOutLocally,
  stacks, startPolling, switcherOpen, Tab, tab, TAB_ORDER, toast, user,
} from './state';
import { Avatar, headerSlots, Icon, SectionSlot, Sheets, Spinner, TopBlur } from './ui';
import { uiScale } from './scale';
import { trackScreen } from './analytics';

/** Screens whose text is private (messages, notifications, account forms, reviews being written): masked in Clarity
 *  recordings. A display: contents wrapper — no box of its own, layout unchanged. */
const MASKED = new Set(['chat', 'conversation', 'notifications', 'profile-edit', 'settings', 'review-form', 'invite', 'create-profile', 'job-editor', 'applicants']);

function renderRoute(route: Route) {
  const view = routeView(route);
  return MASKED.has(route.screen) ? <div data-clarity-mask="True" style={{ display: 'contents' }}>{view}</div> : view;
}

function routeView(route: Route) {
  const p = route.params ?? {};
  switch (route.screen) {
    case 'jobs': return <JobsScreen />;
    case 'job': return <JobScreen id={p.id} />;
    case 'job-editor': return <JobEditor job={p.job} />;
    case 'applicants': return <ApplicantsScreen job={p.job} />;
    case 'chat': return <ChatListScreen />;
    case 'conversation': return <ConversationScreen id={p.id} />;
    case 'kolaba': return <ReelsScreen />;
    case 'notifications': return <NotificationsScreen />;
    case 'creators': return <CreatorsScreen />;
    case 'contacts': return <ContactsScreen filter={p.filter} />;
    case 'profile': return <ProfileScreen />;
    case 'profile-view': return <ProfileScreen id={p.id} tab={p.tab} />;
    case 'profile-edit': return <EditProfileScreen />;
    case 'settings': return <SettingsScreen />;
    case 'collection': return <CollectionScreen id={p.id} own={p.own} />;
    case 'review-form': return <ReviewForm recipient={p.recipient} requestId={p.requestId} inviteId={p.inviteId} />;
    case 'invite': return <InviteScreen token={p.token} />;
    case 'create-profile': return <CreateProfile allowed={[p.type]} onCancel={() => back()} onDone={() => { back(false); p.then?.(); }} />;
    default: return null;
  }
}

const GLYPHS: Partial<Record<Tab, [string, string, string]>> = {
  jobs: ['TabProjects', 'TabProjectsSelected', 'job.'],
  creators: ['TabCreators', 'TabCreatorsSelected', 'creators.'],
  kolaba: ['TabReels', 'TabReelsSelected', 'kolaba.'],
  chat: ['TabMessages', 'TabMessagesSelected', 'chat.'],
};

/** Long press (0.4 s) without moving: the profile item's account switcher (FIX 70). */
function useLongPress(onLong: () => void) {
  const timer = useRef<number>();
  const fired = useRef(false);
  return {
    onPointerDown: () => { fired.current = false; timer.current = window.setTimeout(() => { fired.current = true; onLong(); }, 400); },
    onPointerUp: () => window.clearTimeout(timer.current),
    onPointerLeave: () => window.clearTimeout(timer.current),
    onContextMenu: (e: Event) => e.preventDefault(),
    wasLong: () => fired.current,
  };
}

function TabBar({ hidden }: { hidden: boolean }) {
  const index = TAB_ORDER.indexOf(tab.value);
  const press = useLongPress(() => { switcherOpen.value = true; });
  const scrollTop = (t: Tab) => {
    const el = document.querySelector<HTMLElement>(`.pager__page[data-tab="${t}"] .scroll, .pager__page[data-tab="${t}"] .reels`);
    el?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const choose = (t: Tab) => {
    if (t === tab.value && stacks.value[t].length === 1) scrollTop(t);
    selectTab(t);
  };
  return (
    <nav class={`tabbar glass ${hidden ? 'is-hidden' : ''}`} aria-label="Main">
      <i class="tabbar__indicator" style={{ transform: `translateX(${index * 70}px)` }} />
      {TAB_ORDER.map((t) => {
        const active = t === tab.value;
        if (t === 'profile') {
          return (
            <button class={`tabbar__item ${active ? 'is-active' : ''}`} aria-label="My Profile" aria-current={active ? 'page' : undefined}
              onPointerDown={press.onPointerDown} onPointerUp={press.onPointerUp} onPointerLeave={press.onPointerLeave} onContextMenu={press.onContextMenu}
              onClick={() => { if (!press.wasLong()) choose(t); }}>
              <span class="tab-avatar"><Avatar card={activeProfile.value} size={24} /></span>
            </button>
          );
        }
        const [outline, filled, label] = GLYPHS[t]!;
        const count = t === 'chat' ? badges.value.conversations : 0;
        return (
          <button class={`tabbar__item ${active ? 'is-active' : ''}`} aria-label={label} aria-current={active ? 'page' : undefined} onClick={() => choose(t)}>
            <span class="tabbar__glyph">
              <img class="is-outline" src={`${import.meta.env.BASE_URL}icons/${outline}.svg`} alt="" draggable={false} />
              <img class="is-filled" src={`${import.meta.env.BASE_URL}icons/${filled}.svg`} alt="" draggable={false} />
              {count > 0 && <span class="badge">{count > 99 ? '99+' : count}</span>}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** Switch accounts (SwitchAccountsSheet in KolabaGlassModalContainer, Figma 885:7386): a glass modal 6 pt in from the
 *  screen's sides and bottom, radius 34, ending above the tab bar; the grabber, "Switch accounts" and the round glass
 *  close; 56 pt rows (radius 20, 16 pt inside) — the active profile first, lit white 10 % with the green check, the
 *  others with a caret; a 21 pt separator; Add business account after the businesses (gone at the limit of 5).
 *  It rises in .45 s, leaves in .35 s, and follows a pull down from its header (closes past 90 pt or on a flick). */
function AccountSwitcher() {
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const [settling, setSettling] = useState(false);
  if (!switcherOpen.value) return null;
  const close = (then?: () => void) => { if (closing) return; setClosing(true); window.setTimeout(() => { switcherOpen.value = false; setClosing(false); setDrag(0); then?.(); }, 350); };
  const all = profiles.value;
  const active = all.find((p) => p.id === activeProfile.value?.id);
  const businesses = all.filter((p) => p.type === 'business' && p.id !== active?.id);
  const creators = all.filter((p) => p.type === 'creator' && p.id !== active?.id);
  const canAddBusiness = all.filter((p) => p.type === 'business').length < 5;
  const hasCreator = all.some((p) => p.type === 'creator');
  const choose = (id: string) => close(() => setActiveProfile(id));
  const startDrag = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const k = uiScale(); const y0 = e.clientY; let v = 0; let last = y0; let lastT = performance.now();
    const move = (ev: PointerEvent) => {
      const t = performance.now(); v = ((ev.clientY - last) / k / Math.max(t - lastT, 1)) * 1000; last = ev.clientY; lastT = t;
      setDrag(Math.max(0, (ev.clientY - y0) / k));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      const dy = Math.max(0, (ev.clientY - y0) / k);
      if (dy > 90 || v > 700) close();
      else { setSettling(true); setDrag(0); window.setTimeout(() => setSettling(false), 300); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  const row = (p: typeof all[number], isActive: boolean) => (
    <button class={`sw-row ${isActive ? 'is-active' : ''}`} aria-current={isActive ? 'true' : undefined} onClick={() => (isActive ? close() : choose(p.id))}>
      <span class={`sw-avatar ${p.type === 'business' ? 'is-business' : ''}`}><Avatar card={p} size={32} /></span>
      <span class="sw-labels">
        <span class="sw-title"><span class="ellipsis">{p.displayName}</span>{p.isPro && <span class={`pro ${p.type === 'business' ? 'is-business' : ''}`}><img src={`${import.meta.env.BASE_URL}icons/IconCrownSimple.svg`} alt="" />PRO</span>}</span>
        <span class="sw-sub">{p.type === 'business' ? 'Business' : 'Creator'}</span>
      </span>
      {isActive ? <Icon name="IconCheckActive" size={16} /> : <Icon name="IconCaretRight" size={16} />}
    </button>
  );
  const addBusiness = canAddBusiness && (
    <button class="sw-row" onClick={() => close(() => push('create-profile', { type: 'business' }, 'profile'))}>
      <img src={`${import.meta.env.BASE_URL}icons/IconAddAccount.svg`} alt="" width={32} height={32} />
      <span class="sw-labels"><span class="sw-title">Add business account</span><span class="sw-sub">Create a profile for your brand or agency</span></span>
    </button>
  );
  const addCreator = !hasCreator && (
    <button class="sw-row" onClick={() => close(() => push('create-profile', { type: 'creator' }, 'profile'))}>
      <img src={`${import.meta.env.BASE_URL}icons/IconAddAccount.svg`} alt="" width={32} height={32} />
      <span class="sw-labels"><span class="sw-title">Add creator account</span><span class="sw-sub">Portfolio, Reels and applications to jobs</span></span>
    </button>
  );
  const sep = <div class="sw-sep" aria-hidden="true"><i /></div>;
  const isBusiness = active?.type === 'business';
  return (
    <>
      <div class={`switcher-dim ${closing ? 'is-closing' : ''}`} style={drag ? { opacity: Math.max(0, 1 - drag / 300) } : undefined} onClick={() => close()} />
      <div class={`switcher ${closing ? 'is-closing' : ''} ${settling ? 'is-settling' : ''}`} role="dialog" aria-label="Switch accounts"
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}>
        <div class="sw-head" onPointerDown={startDrag as any}>
          <span class="sw-grabber" />
          <div class="sw-bar"><span style={{ width: 44 }} /><div class="sw-heading">Switch accounts</div>
            <button class="glass sw-close" aria-label="Close" onClick={() => close()}><Icon name="IconSheetClose" size={24} /></button></div>
        </div>
        <div class="sw-rows">
          {active && row(active, true)}
          {isBusiness ? <>{businesses.map((p) => row(p, false))}{addBusiness}{sep}{creators.map((p) => row(p, false))}{addCreator}</>
            : <>{sep}{businesses.map((p) => row(p, false))}{addBusiness}{creators.map((p) => row(p, false))}</>}
        </div>
      </div>
    </>
  );
}

/** The pushed screen on top: slides in; a drag from the left 24 pt takes it back (past half or 700 px/s). */
function PushLayer({ route, under }: { route: Route; under: boolean }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [settle, setSettle] = useState(false);
  const isLeaving = leaving.value === route.key;
  const start = (e: PointerEvent) => {
    const k = uiScale();
    const x0 = e.clientX; let last = x0; let lastT = performance.now(); let v = 0;
    const width = (e.currentTarget as HTMLElement).parentElement!.clientWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const now = performance.now(); v = ((ev.clientX - last) / k / Math.max(now - lastT, 1)) * 1000; last = ev.clientX; lastT = now;
      setDrag(Math.max(0, (ev.clientX - x0) / k));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      const dx = Math.max(0, (ev.clientX - x0) / k);
      if (dx > width * 0.5 || v > 700) {
        setSettle(true); setDrag(width);
        window.setTimeout(() => { back(false); }, 300);
      } else { setSettle(true); setDrag(0); window.setTimeout(() => { setSettle(false); setDrag(null); }, 300); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  return (
    <>
      <div class="push-under" style={drag !== null ? { opacity: 0.5 * (1 - drag / 400) } : isLeaving ? { opacity: 0 } : undefined} />
      <div class={`push-layer ${isLeaving ? 'is-leaving' : ''} ${drag !== null ? (settle ? 'is-settling' : 'is-dragging') : ''}`}
        style={drag !== null ? { transform: `translateX(${drag}px)` } : undefined} aria-hidden={under}>
        {renderRoute(route)}
        <div class="edge-catcher" onPointerDown={start as any} />
      </div>
    </>
  );
}

function MainApp() {
  useEffect(() => {
    startPolling();
    let token: string | null = null;
    try { token = localStorage.getItem('kolaba.invite'); } catch { /* */ }
    if (token) push('invite', { token }, 'profile');
    // A direct link to one job / profile (#/job/<id>, #/profile/<id> — e.g. "View Live Post" in the admin panel).
    let link: string | null = null;
    try { link = sessionStorage.getItem('kolaba.deeplink'); sessionStorage.removeItem('kolaba.deeplink'); } catch { /* */ }
    const [kind, id] = (link ?? '').split(':');
    if (id && kind === 'job') push('job', { id }, 'jobs');
    else if (id && kind === 'profile') push('profile-view', { id }, 'creators');
  }, []);
  const all = stacks.value;
  const index = TAB_ORDER.indexOf(tab.value);
  // Clarity: the SPA's screens by name (the section, or the screen pushed on top of it) — never ids or content.
  const topScreen = all[tab.value][all[tab.value].length - 1]?.screen ?? tab.value;
  useEffect(() => { trackScreen(topScreen === tab.value ? tab.value : `${tab.value}/${topScreen}`); }, [tab.value, topScreen]);
  const pushed = all[tab.value].slice(1);
  // Instant jump when a section is chosen with screens open elsewhere is not needed: sections slide like iOS.
  return (
    <div class={`app ${isBusiness.value ? 'is-business' : ''}`}>
      {/* 1 — the sections' scrolling content */}
      <div class="pager" style={{ transform: `translateX(${-index * 100}%)` }}>
        {TAB_ORDER.map((t) => (
          <section class="pager__page" data-tab={t} aria-hidden={t !== tab.value} key={t}>
            <SectionSlot.Provider value={t}>{renderRoute(all[t][0])}</SectionSlot.Provider>
          </section>
        ))}
      </div>
      {/* 2 — the one top blur: fixed, from the first frame, never re-created by a slide */}
      <div class="app-blur"><TopBlur /></div>
      {/* 3 — every section's header, pinned tabs and photo dots, sliding with the pager over the blur */}
      <div class="header-layer" style={{ transform: `translateX(${-index * 100}%)` }}>
        {TAB_ORDER.map((t) => (
          <div class="header-slot" data-tab={t} aria-hidden={t !== tab.value} key={t}
            ref={(el) => { if (el && headerSlots.value[t] !== el) headerSlots.value = { ...headerSlots.value, [t]: el }; }} />
        ))}
      </div>
      <div class={`bottom-gradient ${tab.value === 'chat' ? 'is-low' : ''} ${tab.value === 'kolaba' ? 'is-off' : ''}`} />
      <TabBar hidden={false} />
      {/* Every pushed screen of every section stays mounted (scroll and data survive Back); only the selected section's show. */}
      {TAB_ORDER.map((t) => all[t].slice(1).map((route, i, list) => (
        <div key={route.key} hidden={t !== tab.value} style={{ position: 'absolute', inset: 0, zIndex: 40 + i, pointerEvents: t === tab.value ? undefined : 'none' }}>
          <PushLayer route={route} under={i < list.length - 1} />
        </div>
      )))}
      <AccountSwitcher />
      <Sheets />
      {toast.value && <div class={`toast glass ${toast.value.tone ?? ''}`} role="status" key={toast.value.id}>{toast.value.text}</div>}
    </div>
  );
}

export function App() {
  useEffect(() => {
    const match = /^#\/invite\/([A-Za-z0-9_-]{32,64})$/.exec(location.hash);
    if (match) { try { localStorage.setItem('kolaba.invite', match[1]); } catch { /* */ } history.replaceState(null, '', location.pathname); }
    const direct = /^#\/(job|profile)\/([A-Za-z0-9_-]{3,80})$/.exec(location.hash);
    if (direct) { try { sessionStorage.setItem('kolaba.deeplink', `${direct[1]}:${direct[2]}`); } catch { /* */ } history.replaceState(null, '', location.pathname); }
    if (!session.token) { booted.value = true; return; }
    api('GET', '/v1/auth/session').then(applySession).catch(() => signOutLocally()).finally(() => { booted.value = true; });
  }, []);
  const toastView = toast.value && <div class={`toast glass ${toast.value.tone ?? ''}`} role="status" key={toast.value.id}>{toast.value.text}</div>;
  if (!booted.value) return <div class="app"><div style={{ paddingTop: 300 }}><Spinner /></div></div>;
  if (!user.value) return <div class="app"><AuthFlow />{toastView}<Sheets /></div>;
  if (!activeProfile.value) return <div class="app"><CreateProfile />{toastView}<Sheets /></div>;
  return <MainApp />;
}

export { Icon };
