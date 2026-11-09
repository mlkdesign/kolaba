import { useEffect, useState, type ReactNode } from 'react';
import { api, errorText, onSessionLost, setSession } from './api';
import { href, navigate, useRoute } from './router';
import { Button, Field, Icon, Modal, Toasts, initials, toast } from './ui';
import navDashboard from './assets/icons/nav-dashboard.svg';
import navUsers from './assets/icons/nav-users.svg';
import navJobs from './assets/icons/nav-jobs.svg';
import navMedia from './assets/icons/nav-media.svg';
import navLogs from './assets/icons/nav-logs.svg';
import logoutIcon from './assets/icons/logout.svg';
import mailIcon from './assets/icons/mail.svg';
import keyIcon from './assets/icons/key-round.svg';
import eyeIcon from './assets/icons/eye.svg';
import lockIcon from './assets/icons/lock-keyhole.svg';
import shieldLogin from './assets/icons/shield-login.svg';
import { DashboardPage } from './pages/dashboard';
import { UserPage, UsersPage } from './pages/users';
import { JobPage, JobsPage } from './pages/jobs';
import { MediaPage } from './pages/media';
import { LogsPage } from './pages/logs';

interface Admin { email: string; mustChangePassword: boolean }

export function App() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    onSessionLost(() => { setSession(null); setAdmin(null); setNotice('Your session has expired. Sign in again.'); },
                  () => setAdmin((a) => (a ? { ...a, mustChangePassword: true } : a)));
  }, []);
  const signedIn = (token: string, a: Admin) => { setSession(token); setNotice(null); setAdmin(a); };
  const signOut = async () => {
    try { await api('POST', '/logout'); } catch { /* the session ends locally either way */ }
    setSession(null); setAdmin(null); setNotice('You have been signed out.');
  };
  return (
    <>
      {!admin ? <Login onSignedIn={signedIn} notice={notice} />
        : admin.mustChangePassword ? <AuthShell><ChangePasswordForm forced onDone={() => setAdmin({ ...admin, mustChangePassword: false })} onSignOut={signOut} /></AuthShell>
        : <Shell admin={admin} onSignOut={signOut} />}
      <Toasts />
    </>
  );
}

// ─── sign-in (Figma: Screen / Login, Loading, Invalid Credentials) ───

const Logo = ({ size }: { size: number }) => <span className="logo" style={{ fontSize: size }}>kolaba<span className="logo__dot">.</span></span>;

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth__glow" aria-hidden="true" />
      <div className="auth__label"><Icon src={shieldLogin} size={16} />KOLABA / Admin Panel</div>
      <div className="auth__box"><Logo size={38} />{children}</div>
      <div className="auth__footer"><i />Secure workspace · Authorized personnel only</div>
    </main>
  );
}

function Login({ onSignedIn, notice }: { onSignedIn: (token: string, admin: Admin) => void; notice: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await api<{ token: string; admin: Admin }>('POST', '/login', { email: email.trim(), password });
      setPassword('');
      onSignedIn(res.token, res.admin);
    } catch (e) { setError(errorText(e)); setBusy(false); }
  };
  return (
    <AuthShell>
      <div className="auth__welcome"><h1>Welcome back</h1><p>Sign in to KOLABA Admin</p></div>
      <form className="auth__form" onSubmit={(e) => { e.preventDefault(); if (email && password) submit(); }}>
        {notice && !error && <p className="auth__notice" role="status">{notice}</p>}
        <Field label="Email">
          <span className={`auth-input ${error ? 'is-error' : ''}`}>
            <Icon src={mailIcon} size={17} />
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" required autoFocus />
          </span>
        </Field>
        <Field label="Password">
          <span className={`auth-input ${error ? 'is-error' : ''}`}>
            <Icon src={keyIcon} size={17} />
            <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                   placeholder="Enter your password" required />
            <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
              <Icon src={eyeIcon} size={16} />
            </button>
          </span>
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} disabled={!email || !password}>{busy ? 'Signing in…' : 'Sign In'}</Button>
      </form>
      <p className="auth__note"><Icon src={lockIcon} size={14} />Staff access only. Credentials are provided by the platform owner.</p>
    </AuthShell>
  );
}

function ChangePasswordForm({ forced, onDone, onSignOut }: { forced?: boolean; onDone: () => void; onSignOut?: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = repeat.length > 0 && next !== repeat;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api('POST', '/password', { currentPassword: current, newPassword: next });
      toast.ok('Password changed', 'Other sessions were signed out. The change is recorded in Activity Logs.');
      onDone();
    } catch (e) { setError(errorText(e)); setBusy(false); }
  };
  return (
    <>
      {forced && <div className="auth__welcome"><h1>Set a new password</h1><p>The initial password must be replaced before you continue.</p></div>}
      <form className="auth__form" onSubmit={(e) => { e.preventDefault(); if (!mismatch && next.length >= 12) submit(); }}>
        <Field label="Current password">
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
        </Field>
        <Field label="New password" hint="At least 12 characters. Use a passphrase or a password manager.">
          <input className="input" type="password" autoComplete="new-password" minLength={12} value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Repeat new password">
          <input className={`input ${mismatch ? 'is-error' : ''}`} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </Field>
        {mismatch && <p className="form-error">The passwords don’t match.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} disabled={!current || next.length < 12 || next !== repeat}>Change password</Button>
        {forced && onSignOut && <Button variant="ghost" onClick={onSignOut}>Sign out</Button>}
      </form>
    </>
  );
}

// ─── layout (Figma: Sidebar 240 px + header + scrolling content) ───

const NAV = [
  { group: 'Overview', items: [{ key: '', label: 'Dashboard', icon: navDashboard }] },
  { group: 'Management', items: [{ key: 'users', label: 'Users', icon: navUsers }, { key: 'jobs', label: 'Jobs', icon: navJobs },
                                 { key: 'media', label: 'Media', icon: navMedia }] },
  { group: 'System', items: [{ key: 'logs', label: 'Activity Logs', icon: navLogs }] },
];

function Shell({ admin, onSignOut }: { admin: Admin; onSignOut: () => void }) {
  const route = useRoute();
  const [section, id] = route.path;
  const [passwordOpen, setPasswordOpen] = useState(false);
  useEffect(() => { document.querySelector('.content')?.scrollTo(0, 0); }, [section, id]);
  let page: ReactNode;
  if (!section) page = <DashboardPage />;
  else if (section === 'users') page = id ? <UserPage id={id} /> : <UsersPage />;
  else if (section === 'jobs') page = id ? <JobPage id={id} /> : <JobsPage owner={route.params.get('owner')} />;
  else if (section === 'media') page = <MediaPage owner={route.params.get('owner')} />;
  else if (section === 'logs') page = <LogsPage />;
  else page = <NotFound />;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><Logo size={29} /><span>Admin Panel</span></div>
        <nav className="nav" aria-label="Sections">
          {NAV.map((g) => (
            <div key={g.group} className="nav__group">
              <div className="nav__label">{g.group.toUpperCase()}</div>
              {g.items.map((item) => {
                const active = (section ?? '') === item.key;
                return (
                  <a key={item.key} href={href(`/${item.key}`)} className={`nav__item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                    <Icon src={item.icon} size={17} />{item.label}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar__admin">
          <button className="admin-id" onClick={() => setPasswordOpen(true)} title="Change password">
            <span className="avatar avatar--text">{initials(admin.email)}</span>
            <span className="admin-id__text"><b>{admin.email}</b><span>Administrator · Change password</span></span>
          </button>
          <button className="icon-btn" aria-label="Log out" title="Log out" onClick={onSignOut}><Icon src={logoutIcon} size={14} /></button>
        </div>
      </aside>
      <div className="main">{page}</div>
      {passwordOpen && (
        <Modal title="Change password" onClose={() => setPasswordOpen(false)}>
          <ChangePasswordForm onDone={() => setPasswordOpen(false)} />
        </Modal>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, back, actions }: { title: string; subtitle?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode }) {
  return (
    <header className="header">
      <div className="header__identity">
        {back && <a className="header__back" href={href(back.to)}>‹ {back.label}</a>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="header__actions">{actions}</div>}
    </header>
  );
}

function NotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <div className="content"><div className="state"><b>This page doesn’t exist.</b><Button small onClick={() => navigate('/')}>Go to Dashboard</Button></div></div>
    </>
  );
}
