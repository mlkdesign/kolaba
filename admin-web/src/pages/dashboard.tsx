// Dashboard (Figma: Screen / Dashboard) — only numbers counted from D1; no charts, no growth percentages.
import { api, type Dashboard, type StorageUsage } from '../api';
import { PageHeader } from '../app';
import { href } from '../router';
import { ErrorState, Icon, KPI, Loading, fmtDateTime, fmtNum, useLoad } from '../ui';
import usersIcon from '../assets/icons/users.svg';
import userRound from '../assets/icons/user-round.svg';
import jobsIcon from '../assets/icons/nav-jobs.svg';
import crown from '../assets/icons/crown.svg';

export function DashboardPage() {
  const { data, error, loading, reload } = useLoad<Dashboard>((s) => api('GET', '/dashboard', undefined, s), []);
  const s = data?.stats;
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Platform overview and activity" />
      <div className="content">
        {error ? <ErrorState error={error} retry={reload} /> : !s ? <Loading /> : (
          <>
            <div className="kpis kpis--3">
              <KPI label="Total Users" icon={usersIcon} value={fmtNum(s.totalUsers)}
                   note={s.blockedUsers ? `${fmtNum(s.blockedUsers)} blocked` : 'Registered accounts'} />
              <KPI label="Creator Profiles" icon={userRound} value={fmtNum(s.creatorProfiles)} note="Creator profiles across all accounts" />
              <KPI label="Business Profiles" icon={userRound} value={fmtNum(s.businessProfiles)} note="Business profiles across all accounts" />
              <KPI label="Total Jobs" icon={jobsIcon} value={fmtNum(s.totalJobs)}
                   note={s.hiddenJobs ? `Published jobs · ${fmtNum(s.hiddenJobs)} hidden by moderation` : 'Published jobs'} />
              <KPI label="Active Jobs" icon={jobsIcon} value={fmtNum(s.activeJobs)} note="Open for creator applications" />
              <KPI label="PRO Accounts" icon={crown} value={fmtNum(s.proAccounts)} note="Accounts with at least one active PRO profile" />
            </div>
            <StoragePanel />
            <section className="panel">
              <div className="panel__head">
                <div><h2>Recent activity</h2><p>Latest registered accounts and published jobs</p></div>
                {loading && <span className="spinner" />}
              </div>
              {data!.recent.length === 0 ? <div className="state"><b>No activity yet</b></div> : (
                <ul className="activity">
                  {data!.recent.map((r) => (
                    <li key={`${r.type}:${r.id}`}>
                      <a href={href(r.type === 'job.published' ? `/jobs/${r.id}` : `/users/${r.id}`)} className="activity__row">
                        <span className="activity__icon"><Icon src={r.type === 'job.published' ? jobsIcon : userRound} size={15} /></span>
                        <span className="activity__kind">{r.type === 'job.published' ? 'Job published' : 'New account'}</span>
                        <span className="activity__title"><b>{r.title}</b>{r.subtitle && <span>{r.type === 'job.published' ? `by ${r.subtitle}` : r.subtitle}</span>}</span>
                        <span className="activity__time">{fmtDateTime(r.at)}</span>
                        <span className="activity__go">Open ›</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

const STORAGE_GROUPS: Record<StorageUsage['files']['groups'][number]['key'], { label: string; color: string }> = {
  portfolio: { label: 'Portfolio videos & photos', color: 'var(--accent)' },
  profile: { label: 'Profile photos', color: '#8f7cf7' },
  jobs: { label: 'Job media', color: '#08a9f5' },
  applications: { label: 'Application media', color: 'var(--amber)' },
  chat: { label: 'Chat files & voice', color: 'var(--green)' },
  other: { label: 'Other files', color: 'var(--text-3)' },
};

/** 1 536 → "1.5 KB" (binary units, as storage plans count them). */
export function fmtBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes; let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Storage: everything the project keeps — the files in R2 by kind and the D1 database — as one bar against the plan. */
function StoragePanel() {
  const { data, error, loading, reload } = useLoad<StorageUsage>((s) => api('GET', '/storage', undefined, s), []);
  const total = data ? data.files.bytes + data.database.bytes : 0;
  const share = (bytes: number) => (data && data.limitBytes > 0 ? (bytes / data.limitBytes) * 100 : 0);
  const percent = share(total);
  return (
    <section className="panel storage">
      <div className="panel__head">
        <div><h2>Storage</h2><p>Files in R2 and the D1 database, measured now</p></div>
        {loading ? <span className="spinner" /> : data && (
          <button type="button" className="btn btn--ghost btn--small" onClick={reload}>Refresh</button>
        )}
      </div>
      {error ? <ErrorState error={error} retry={reload} /> : !data ? <Loading /> : (
        <>
          <div className="storage__total">
            <b>{fmtBytes(total)}</b>
            <span>of {fmtBytes(data.limitBytes)} · {percent < 0.1 && total > 0 ? '<0.1' : percent.toFixed(1)}% used</span>
          </div>
          <div className="storage__bar" role="img" aria-label={`${fmtBytes(total)} of ${fmtBytes(data.limitBytes)} used`}>
            {data.files.groups.map((g) => (
              <span key={g.key} style={{ width: `${share(g.bytes)}%`, minWidth: g.bytes > 0 ? 4 : 0, background: STORAGE_GROUPS[g.key].color }}
                    title={`${STORAGE_GROUPS[g.key].label}: ${fmtBytes(g.bytes)}`} />
            ))}
            <span style={{ width: `${share(data.database.bytes)}%`, minWidth: data.database.bytes > 0 ? 4 : 0, background: 'var(--text-2)' }}
                  title={`Database: ${fmtBytes(data.database.bytes)}`} />
          </div>
          <ul className="storage__legend">
            {data.files.groups.map((g) => (
              <li key={g.key}>
                <i style={{ background: STORAGE_GROUPS[g.key].color }} />
                <span>{STORAGE_GROUPS[g.key].label}</span>
                <b>{fmtBytes(g.bytes)}</b>
                <em>{fmtNum(g.files)} {g.files === 1 ? 'file' : 'files'}</em>
              </li>
            ))}
            <li>
              <i style={{ background: 'var(--text-2)' }} />
              <span>Database (D1)</span>
              <b>{fmtBytes(data.database.bytes)}</b>
              <em>Accounts, jobs, messages</em>
            </li>
          </ul>
          <p className="storage__note">
            {data.files.available ? `${fmtNum(data.files.count)} files in total` : 'File storage (R2) is not connected'}
            {data.truncated && ' · counted up to the first 100 000 files'}
            {` · measured ${fmtDateTime(data.measuredAt)}`}
          </p>
        </>
      )}
    </section>
  );
}
