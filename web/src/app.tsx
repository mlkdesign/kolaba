// The app: auth gate, five tabs with their own stacks (kept mounted → scroll positions survive), sheets, toast.
import { useEffect } from 'preact/hooks';
import { api, session } from './api';
import { CreatorsScreen, ContactsScreen } from './screens/creators';
import { ChatListScreen, ConversationScreen } from './screens/chat';
import { JobEditor, JobScreen, JobsScreen } from './screens/jobs';
import { NotificationsScreen, ReelsScreen } from './screens/reels';
import { CollectionScreen, EditProfileScreen, InviteScreen, ProfileScreen, ReviewForm, SettingsScreen } from './screens/profile';
import { AuthFlow, CreateProfile } from './screens/auth';
import { activeProfile, applySession, badges, booted, isBusiness, push, Route, selectTab, signOutLocally, stacks, startPolling, Tab, tab, toast, user } from './state';
import { Avatar, Icon, Sheets, Spinner } from './ui';

function renderRoute(route: Route) {
  const p = route.params ?? {};
  switch (route.screen) {
    case 'jobs': return <JobsScreen />;
    case 'job': return <JobScreen id={p.id} />;
    case 'job-editor': return <JobEditor job={p.job} />;
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
    default: return null;
  }
}

const TABS: { id: Tab; icon: string; selected: string; label: string }[] = [
  { id: 'jobs', icon: 'TabProjects', selected: 'TabProjectsSelected', label: 'job.' },
  { id: 'chat', icon: 'TabMessages', selected: 'TabMessagesSelected', label: 'chat.' },
  { id: 'kolaba', icon: 'TabReels', selected: 'TabReelsSelected', label: 'kolaba.' },
  { id: 'creators', icon: 'TabCreators', selected: 'TabCreatorsSelected', label: 'creators.' },
];

function TabBar() {
  const current = tab.value;
  return (
    <nav class="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <button class={`tabbar__item ${current === t.id ? 'is-active' : ''}`} aria-current={current === t.id ? 'page' : undefined} onClick={() => selectTab(t.id)}>
          <img src={`${import.meta.env.BASE_URL}icons/${current === t.id ? t.selected : t.icon}.svg`} alt="" />
          <span class="tabbar__label">{t.label}</span>
          {t.id === 'chat' && badges.value.conversations > 0 && <span class="badge">{badges.value.conversations}</span>}
          {t.id === 'kolaba' && badges.value.notifications > 0 && <span class="badge">{badges.value.notifications > 99 ? '99+' : badges.value.notifications}</span>}
        </button>
      ))}
      <button class={`tabbar__item ${current === 'profile' ? 'is-active' : ''}`} aria-label="My profile" onClick={() => selectTab('profile')}>
        <Avatar card={activeProfile.value} size={30} />
      </button>
    </nav>
  );
}

function MainApp() {
  useEffect(() => {
    startPolling();
    // An invite link opened before signing in continues here.
    let token: string | null = null;
    try { token = localStorage.getItem('kolaba.invite'); } catch { /* */ }
    if (token) push('invite', { token }, 'profile');
  }, []);
  const all = stacks.value;
  // Hide the tab bar on screens that have their own bottom controls.
  const top = all[tab.value][all[tab.value].length - 1];
  const fullScreen = ['conversation', 'job', 'job-editor', 'review-form', 'profile-edit', 'settings', 'invite'].includes(top.screen);
  return (
    <div class={`app ${isBusiness.value ? 'is-business' : ''}`}>
      {(Object.keys(all) as Tab[]).map((t) => (
        <div class="tab-layer" hidden={t !== tab.value} key={t}>
          {all[t].map((route, i) => (
            <div class={`stack-layer ${i === 0 ? 'is-root' : ''}`} hidden={i !== all[t].length - 1} key={route.key}>{renderRoute(route)}</div>
          ))}
        </div>
      ))}
      {!fullScreen && <TabBar />}
      <Sheets />
      {toast.value && <div class={`toast ${toast.value.tone ?? ''}`} role="status" key={toast.value.id}>{toast.value.text}</div>}
    </div>
  );
}

export function App() {
  useEffect(() => {
    // #/invite/<token> → kept until signed in.
    const match = /^#\/invite\/([A-Za-z0-9_-]{32,64})$/.exec(location.hash);
    if (match) { try { localStorage.setItem('kolaba.invite', match[1]); } catch { /* */ } history.replaceState(null, '', location.pathname); }
    if (!session.token) { booted.value = true; return; }
    api('GET', '/v1/auth/session').then(applySession).catch(() => signOutLocally()).finally(() => { booted.value = true; });
  }, []);
  if (!booted.value) return <div class="app"><div style={{ paddingTop: 300 }}><Spinner /></div></div>;
  if (!user.value) return <div class="app"><AuthFlow />{toast.value && <div class={`toast ${toast.value.tone ?? ''}`}>{toast.value.text}</div>}<Sheets /></div>;
  if (!activeProfile.value) return <div class="app"><CreateProfile />{toast.value && <div class={`toast ${toast.value.tone ?? ''}`}>{toast.value.text}</div>}</div>;
  return <MainApp />;
}

export { Icon };
