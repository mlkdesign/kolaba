// Users (Figma: Screen / Users) — accounts from D1 with their creator / business profiles.
import { useState } from 'react';
import { api, errorText, query, type AdminProfile, type Dashboard, type Paged, type UserDetail, type UserRow } from '../api';
import { PageHeader } from '../app';
import { href, navigate, useRemembered } from '../router';
import {
  Avatar, Button, ConfirmModal, Empty, ErrorState, ExternalGlyph, Field, Icon, KPI, Loading, Modal, Pagination, RowMenu, SearchField,
  Select, Status, fmtDate, fmtDateTime, fmtNum, toast, useDebounced, useLoad, useModal,
} from '../ui';
import usersIcon from '../assets/icons/users.svg';
import userRound from '../assets/icons/user-round.svg';
import crown from '../assets/icons/crown.svg';
import shieldCheck from '../assets/icons/shield-check.svg';

const typeLabel = { creator: 'Creator', business: 'Business', both: 'Creator + Business', none: 'No profile' } as const;

function planLabel(u: { isPro: boolean; profiles: AdminProfile[] }) {
  const pro = u.profiles.filter((p) => p.isPro);
  if (!pro.length) return null;
  return pro.length > 1 ? 'Creator + Business PRO' : pro[0]!.type === 'creator' ? 'Creator PRO' : 'Business PRO';
}

/** Account-level actions shared by the table menu and the account page. */
function useAccountActions(reload: () => void) {
  const { modal, open } = useModal();
  const act = (u: { id: string; email: string }, action: 'block' | 'unblock' | 'delete' | 'restore') => open((close) => {
    const run = async (reason: string) => {
      await api('PATCH', `/users/${u.id}/status`, { action, reason: reason || undefined });
      toast.ok({ block: 'Account blocked', unblock: 'Account unblocked', delete: 'Account deleted', restore: 'Account restored' }[action],
               `${u.email} · recorded in Activity Logs.`);
      reload();
    };
    if (action === 'block') return <ConfirmModal title="Block account" danger reason confirmLabel="Block account" onClose={close} onConfirm={run}
      text={<>Block <b>{u.email}</b>? The user is signed out on every device at once and can’t sign in or use the app until unblocked.</>} />;
    if (action === 'unblock') return <ConfirmModal title="Unblock account" confirmLabel="Unblock" onClose={close} onConfirm={run}
      text={<>Unblock <b>{u.email}</b>? They can sign in and use the app again.</>} />;
    if (action === 'delete') return <ConfirmModal title="Delete account" danger reason typeToConfirm="DELETE" confirmLabel="Delete account" onClose={close} onConfirm={run}
      text={<>Soft-delete <b>{u.email}</b>: sign-in stops and the profiles disappear from KOLABA. <b>Nothing is erased</b> — jobs, media and
        messages stay in the database, and the account can be restored.</>} />;
    return <ConfirmModal title="Restore account" confirmLabel="Restore account" onClose={close} onConfirm={run}
      text={<>Restore <b>{u.email}</b>? The account becomes active and the profiles hidden by the deletion become public again.</>} />;
  });
  return { modal, act };
}

export function UsersPage() {
  const [search, setSearch] = useRemembered('users.q', '');
  const [type, setType] = useRemembered('users.type', '');
  const [plan, setPlan] = useRemembered('users.plan', '');
  const [status, setStatus] = useRemembered('users.status', '');
  const [sort, setSort] = useRemembered('users.sort', 'newest');
  const [page, setPage] = useRemembered('users.page', 1);
  const [limit, setLimit] = useRemembered('users.limit', 20);
  const q = useDebounced(search);
  const list = useLoad<Paged<UserRow>>((s) => api('GET', `/users${query({ q, type, plan, status, sort, page, limit })}`, undefined, s),
                                       [q, type, plan, status, sort, page, limit]);
  const stats = useLoad<Dashboard>((s) => api('GET', '/dashboard', undefined, s), []);
  const { modal, act } = useAccountActions(list.reload);
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const st = stats.data?.stats;
  return (
    <>
      <PageHeader title="Users" subtitle="Manage creator and business accounts" />
      <div className="content">
        {st && (
          <div className="kpis">
            <KPI label="Total Users" icon={usersIcon} value={fmtNum(st.totalUsers)} note={st.blockedUsers ? `${fmtNum(st.blockedUsers)} blocked` : 'Registered accounts'} />
            <KPI label="Creators" icon={usersIcon} value={fmtNum(st.creatorProfiles)} note="Creator profiles" />
            <KPI label="Businesses" icon={usersIcon} value={fmtNum(st.businessProfiles)} note="Business profiles" />
            <KPI label="PRO Accounts" icon={crown} value={fmtNum(st.proAccounts)} note="With at least one PRO profile" />
          </div>
        )}
        <div className="tabs" role="tablist">
          {[['', 'All'], ['creator', 'Creator'], ['business', 'Business'], ['both', 'Creator + Business']].map(([v, l]) => (
            <button key={v} role="tab" aria-selected={type === v} className={`tab ${type === v ? 'is-on' : ''}`} onClick={() => filter(setType)(v!)}>
              {l}{type === v && list.data ? ` · ${fmtNum(list.data.total)}` : ''}
            </button>
          ))}
        </div>
        <div className="toolbar">
          <SearchField value={search} onChange={filter(setSearch)} placeholder="Search name, username, email or ID" />
          <Select label="Plan" value={plan} onChange={filter(setPlan)} options={[{ value: '', label: 'All' }, { value: 'pro', label: 'PRO' }, { value: 'free', label: 'Free' }]} />
          <Select label="Status" value={status} onChange={filter(setStatus)}
                  options={[{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'blocked', label: 'Blocked' }, { value: 'deleted', label: 'Deleted' }]} />
          <Select label="Joined" value={sort} onChange={filter(setSort)} options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }]} />
        </div>
        <div className="table">
          <div className="table__head table__row users-grid">
            <span>User</span><span>Email</span><span>Account type</span><span>Plan</span><span>Joined date</span><span>Status</span><span>Actions</span>
          </div>
          {list.error ? <ErrorState error={list.error} retry={list.reload} /> : !list.data ? <Loading /> :
            list.data.items.length === 0 ? <Empty title="No users found" text={q || type || plan || status ? 'Try another search or clear the filters.' : 'No accounts yet.'} /> : (
            <div className={list.loading ? 'is-refreshing' : ''}>
              {list.data.items.map((u) => {
                const main = u.profiles[0];
                const pro = planLabel(u);
                return (
                  <div key={u.id} className="table__row users-grid is-link" onClick={() => navigate(`/users/${u.id}`)} role="link" tabIndex={0}
                       onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/users/${u.id}`); }}>
                    <span className="cell-user">
                      <Avatar url={main?.avatarUrl} name={main?.displayName ?? u.email} />
                      <span className="cell-user__text">
                        <b>{main?.displayName ?? '—'}{u.profiles.length > 1 && <em className="chip">+{u.profiles.length - 1}</em>}{u.isDemo && <em className="chip">Demo</em>}</b>
                        <span>{u.profiles.map((p) => `@${p.username}`).join(' · ') || u.id}</span>
                      </span>
                    </span>
                    <span className="cell-muted ellipsis">{u.email}</span>
                    <span className="cell-muted cell-icon"><Icon src={userRound} size={14} />{typeLabel[u.accountType]}</span>
                    <span className="cell-icon">{pro ? <><Icon src={crown} size={13} />{pro}</> : 'Free'}</span>
                    <span className="cell-muted">{fmtDate(u.createdAt)}</span>
                    <span><Status value={u.status} /></span>
                    <span className="cell-actions">
                      <RowMenu actions={[
                        { label: 'View account', onClick: () => navigate(`/users/${u.id}`) },
                        { label: 'Open public profile', href: main?.publicUrl ?? null, icon: <ExternalGlyph /> },
                        { label: 'Block account', onClick: () => act(u, 'block'), danger: true, hidden: u.status !== 'active' },
                        { label: 'Unblock account', onClick: () => act(u, 'unblock'), hidden: u.status !== 'blocked' },
                        { label: 'Restore account', onClick: () => act(u, 'restore'), hidden: u.status !== 'deleted' },
                        { label: 'Delete account', onClick: () => act(u, 'delete'), danger: true, hidden: u.status === 'deleted' },
                      ]} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {list.data && list.data.total > 0 && (
            <Pagination page={page} limit={limit} total={list.data.total} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          )}
        </div>
        <p className="safeguard"><Icon src={shieldCheck} size={14} />Blocks, deletions and PRO changes require confirmation and are recorded in Activity Logs.</p>
      </div>
      {modal}
    </>
  );
}

// ─── account page ───

export function UserPage({ id }: { id: string }) {
  const { data: u, error, reload } = useLoad<UserDetail>((s) => api('GET', `/users/${id}`, undefined, s), [id]);
  const { modal, act } = useAccountActions(reload);
  const extra = useModal();
  const pro = (p: AdminProfile, enabled: boolean) => extra.open((close) => (
    <ConfirmModal title={enabled ? 'Grant PRO' : 'Remove PRO'} confirmLabel={enabled ? 'Grant PRO' : 'Remove PRO'} danger={!enabled} reason reasonOptional
      onClose={close}
      onConfirm={async (reason) => {
        await api('PATCH', `/profiles/${p.id}/pro`, { enabled, reason: reason || undefined });
        toast.ok(enabled ? 'PRO access granted' : 'PRO access removed', `@${p.username} · recorded in Activity Logs.`);
        reload();
      }}
      text={enabled
        ? <>Give <b>@{p.username}</b> {p.type === 'creator' ? 'Creator' : 'Business'} PRO. It is marked as granted by an administrator — no payment is created.</>
        : <>Remove PRO from <b>@{p.username}</b>? Any active PRO entitlement of this profile is cancelled now.</>} />
  ));
  const edit = (p: AdminProfile) => extra.open((close) => <EditProfile profile={p} onClose={close} onSaved={reload} />);
  return (
    <>
      <PageHeader title={u ? (u.profiles[0]?.displayName ?? u.email) : 'Account'} subtitle={u?.email} back={{ to: '/users', label: 'Users' }}
        actions={u && (
          <>
            {u.status === 'active' && <Button variant="danger" onClick={() => act(u, 'block')}>Block</Button>}
            {u.status === 'blocked' && <Button onClick={() => act(u, 'unblock')}>Unblock</Button>}
            {u.status === 'deleted'
              ? <Button onClick={() => act(u, 'restore')}>Restore account</Button>
              : <Button variant="ghost" onClick={() => act(u, 'delete')}>Delete account</Button>}
          </>
        )} />
      <div className="content">
        {error ? <ErrorState error={error} retry={reload} /> : !u ? <Loading /> : (
          <>
            <section className="panel">
              <div className="panel__head"><div><h2>Account</h2><p>One sign-in; profiles belong to it</p></div><Status value={u.status} /></div>
              <dl className="facts">
                <div><dt>User ID</dt><dd className="mono">{u.id}</dd></div>
                <div><dt>Email</dt><dd>{u.email}</dd></div>
                <div><dt>Joined</dt><dd>{fmtDateTime(u.createdAt)}</dd></div>
                <div><dt>Email verified</dt><dd>{u.emailVerifiedAt ? `${fmtDate(u.emailVerifiedAt)}${u.emailVerification === 'test_inbox' ? ' (closed-test inbox)' : ''}` : 'No'}</dd></div>
                <div><dt>Account type</dt><dd>{typeLabel[u.accountType]}{u.isDemo ? ' · Demo account' : ''}</dd></div>
                <div><dt>Plan</dt><dd>{planLabel(u) ?? 'Free'}</dd></div>
                <div><dt>Published jobs</dt><dd>{fmtNum(u.counts.jobs)}{u.counts.jobs > 0 && <> · <a href={href(`/jobs?owner=${u.id}`)}>View</a></>}</dd></div>
                <div><dt>Uploaded media</dt><dd>{fmtNum(u.counts.media)}{u.counts.media > 0 && <> · <a href={href(`/media?owner=${u.id}`)}>View</a></>}</dd></div>
                <div><dt>Active app sessions</dt><dd>{fmtNum(u.counts.sessions)}</dd></div>
                {u.status === 'blocked' && <div className="facts__wide"><dt>Blocked</dt><dd>{fmtDateTime(u.blockedAt)} — {u.blockedReason}</dd></div>}
                {u.status === 'deleted' && <div className="facts__wide"><dt>Deleted</dt><dd>{fmtDateTime(u.deletedAt)} — {u.deletedReason}</dd></div>}
              </dl>
            </section>
            <div className="profiles">
              {u.profiles.length === 0 && <section className="panel"><Empty title="No profiles" text="This account hasn’t created a profile yet." /></section>}
              {u.profiles.map((p) => (
                <section key={p.id} className="panel profile-card">
                  <div className="profile-card__head">
                    <Avatar url={p.avatarUrl} name={p.displayName} size={56} />
                    <div className="profile-card__id">
                      <b>{p.displayName}</b>
                      <span>@{p.username} · {p.type === 'creator' ? 'Creator' : 'Business'}{p.category ? ` · ${p.category}` : ''}</span>
                    </div>
                    <Status value={p.status} />
                  </div>
                  {p.bio && <p className="profile-card__bio">{p.bio}</p>}
                  <dl className="facts facts--compact">
                    <div><dt>Profile ID</dt><dd className="mono">{p.id}</dd></div>
                    <div><dt>Location</dt><dd>{p.location ?? '—'}</dd></div>
                    <div><dt>Website</dt><dd className="ellipsis">{p.website ?? '—'}</dd></div>
                    <div><dt>Plan</dt><dd className="cell-icon">{p.isPro ? <><Icon src={crown} size={13} />PRO{p.subscription && ` · ${p.subscription.source === 'admin' ? 'granted by admin' : p.subscription.source}`}</> : 'Free'}</dd></div>
                  </dl>
                  <div className="profile-card__actions">
                    <Button small onClick={() => edit(p)}>Edit profile</Button>
                    {p.isPro ? <Button small variant="ghost" onClick={() => pro(p, false)}>Remove PRO</Button> : <Button small onClick={() => pro(p, true)}>Grant PRO</Button>}
                    <Button small variant="ghost" href={p.publicUrl} title={p.publicUrl ? undefined : 'Not public while the profile is hidden'}>
                      Open public profile <ExternalGlyph />
                    </Button>
                    {!p.publicUrl && <span className="cell-muted small">Not public ({p.status})</span>}
                  </div>
                </section>
              ))}
            </div>
            <section className="panel">
              <div className="panel__head"><div><h2>Admin history</h2><p>Last 10 administrative actions on this account</p></div></div>
              {u.logs.length === 0 ? <div className="state"><span>No administrative actions yet.</span></div> : (
                <ul className="history">
                  {u.logs.map((l) => (
                    <li key={l.id}><span className="mono">{fmtDateTime(l.created_at)}</span><b>{l.action}</b><span>{l.admin_email}</span>
                      <Status value={l.result} /><span className="cell-muted">{l.reason}</span></li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
      {modal}{extra.modal}
    </>
  );
}

function EditProfile({ profile, onClose, onSaved }: { profile: AdminProfile; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    displayName: profile.displayName, username: profile.username, bio: profile.bio ?? '', category: profile.category ?? '',
    website: profile.website ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const body = { displayName: form.displayName.trim(), username: form.username.trim().toLowerCase(), bio: form.bio,
                     category: form.category.trim() || null, website: form.website.trim() || null };
      const res = await api<{ changed: string[] }>('PATCH', `/profiles/${profile.id}`, body);
      toast.ok(res.changed.length ? 'Profile updated' : 'No changes', res.changed.length ? `Changed: ${res.changed.join(', ')}` : undefined);
      onSaved(); onClose();
    } catch (e) { setError(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title={`Edit @${profile.username}`} onClose={busy ? () => {} : onClose} width={560}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="form-grid">
          <Field label="Display name"><input className="input" maxLength={80} required value={form.displayName} onChange={set('displayName')} /></Field>
          <Field label="Username" hint="3–30: a–z, 0–9, dot, underscore. Must be unique.">
            <input className="input" maxLength={30} pattern="[A-Za-z0-9._]{3,30}" required value={form.username} onChange={set('username')} />
          </Field>
          <Field label="Category"><input className="input" maxLength={60} value={form.category} onChange={set('category')} /></Field>
          <Field label="Website"><input className="input" maxLength={300} value={form.website} onChange={set('website')} placeholder="https://" /></Field>
        </div>
        <Field label={`Bio (${form.bio.length}/1000)`}><textarea className="input" rows={5} maxLength={1000} value={form.bio} onChange={set('bio')} /></Field>
        <p className="field__hint">Location is chosen by the user from a country/city list in the app and isn’t edited here. IDs and sign-in are never changed.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal__actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}
