// Activity Logs (Figma: Screen / Activity Logs) — read-only history of admin sign-ins and changes.
import { api, query, type LogRow, type Paged } from '../api';
import { PageHeader } from '../app';
import { href, useRemembered } from '../router';
import { Empty, ErrorState, Icon, Loading, Pagination, SearchField, Select, Status, fmtUTC, useDebounced, useLoad } from '../ui';
import logsIcon from '../assets/icons/nav-logs.svg';

const ACTIONS: Record<string, string> = {
  login: 'Admin login', logout: 'Admin logout', 'admin.bootstrap': 'Admin created', 'password.change': 'Password changed',
  'profile.edit': 'Profile edited', 'user.block': 'User blocked', 'user.unblock': 'User unblocked', 'user.delete': 'User deleted',
  'user.restore': 'User restored', 'pro.grant': 'PRO granted', 'pro.revoke': 'PRO removed', 'job.edit': 'Job edited',
  'job.hide': 'Job hidden', 'job.restore': 'Job restored', 'job.delete': 'Job deleted', 'media.hide': 'Media hidden', 'media.restore': 'Media restored',
};

function objectLink(l: LogRow) {
  if (!l.entityId) return '—';
  const to = l.entityType === 'user' ? `/users/${l.entityId}` : l.entityType === 'job' ? `/jobs/${l.entityId}` : null;
  return to ? <a href={href(to)} className="mono">{l.entityId}</a> : <span className="mono">{l.entityId}</span>;
}

function describe(l: LogRow) {
  const parts: string[] = [];
  if (l.reason) parts.push(l.reason);
  const changes = l.detail?.changes as Record<string, { from: unknown; to: unknown }> | undefined;
  if (changes) parts.push(Object.entries(changes).map(([k, v]) => `${k}: ${String(v.from ?? '—')} → ${String(v.to ?? '—')}`).join('; '));
  if (l.detail?.plan) parts.push(String(l.detail.plan));
  return parts.join(' · ') || '—';
}

export function LogsPage() {
  const [search, setSearch] = useRemembered('logs.q', '');
  const [action, setAction] = useRemembered('logs.action', '');
  const [result, setResult] = useRemembered('logs.result', '');
  const [page, setPage] = useRemembered('logs.page', 1);
  const [limit, setLimit] = useRemembered('logs.limit', 20);
  const q = useDebounced(search);
  const list = useLoad<Paged<LogRow>>((s) => api('GET', `/logs${query({ q, action, result, page, limit })}`, undefined, s), [q, action, result, page, limit]);
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  return (
    <>
      <PageHeader title="Activity Logs" subtitle="Auditable history of administrative actions and access" />
      <div className="content">
        <div className="toolbar">
          <SearchField value={search} onChange={filter(setSearch)} placeholder="Search action, object, reason or administrator" />
          <Select label="Action" value={action} onChange={filter(setAction)} options={[
            { value: '', label: 'All' }, { value: 'login', label: 'Sign-ins' }, { value: 'user.', label: 'Accounts' }, { value: 'profile.', label: 'Profiles' },
            { value: 'pro.', label: 'PRO' }, { value: 'job.', label: 'Jobs' }, { value: 'media.', label: 'Media' }, { value: 'password.', label: 'Password' }]} />
          <Select label="Result" value={result} onChange={filter(setResult)} options={[{ value: '', label: 'All' }, { value: 'success', label: 'Success' }, { value: 'failure', label: 'Failure' }]} />
        </div>
        <div className="table">
          <div className="table__head table__row logs-grid">
            <span>Timestamp (UTC)</span><span>Administrator</span><span>Action</span><span>Object</span><span>Result</span><span>Description</span>
          </div>
          {list.error ? <ErrorState error={list.error} retry={list.reload} /> : !list.data ? <Loading /> :
            list.data.items.length === 0 ? <Empty title="No events" text={q || action || result ? 'Nothing matches these filters.' : 'Administrative actions will appear here.'} /> : (
            <div className={list.loading ? 'is-refreshing' : ''}>
              {list.data.items.map((l) => (
                <div key={l.id} className="table__row logs-grid">
                  <span className="cell-muted">{fmtUTC(l.createdAt)}</span>
                  <span className="cell-muted ellipsis">{l.adminEmail ?? '—'}</span>
                  <span>{ACTIONS[l.action] ?? l.action}</span>
                  <span className="ellipsis">{objectLink(l)}</span>
                  <span><Status value={l.result} /></span>
                  <span className="cell-muted ellipsis" title={describe(l)}>{describe(l)}</span>
                </div>
              ))}
            </div>
          )}
          {list.data && list.data.total > 0 && (
            <Pagination page={page} limit={limit} total={list.data.total} noun="events" onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          )}
        </div>
        <p className="safeguard"><Icon src={logsIcon} size={14} />Audit records are read-only. Passwords and tokens are never logged.</p>
      </div>
    </>
  );
}
