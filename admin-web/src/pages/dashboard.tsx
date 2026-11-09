// Dashboard (Figma: Screen / Dashboard) — only numbers counted from D1; no charts, no growth percentages.
import { api, type Dashboard } from '../api';
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
