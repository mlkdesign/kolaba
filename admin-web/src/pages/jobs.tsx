// Jobs (Figma: Screen / Jobs) — every job in D1, moderation (hide / restore / soft delete) and the live post link.
import { useState } from 'react';
import { api, errorText, query, type Dashboard, type JobDetail, type JobRow, type Paged } from '../api';
import { PageHeader } from '../app';
import { href, navigate, useRemembered } from '../router';
import {
  Avatar, Button, ConfirmModal, Empty, ErrorState, ExternalGlyph, Field, Icon, KPI, Loading, Modal, Pagination, RowMenu, SearchField,
  Select, Status, fmtDate, fmtDateTime, fmtDuration, fmtNum, toast, useDebounced, useLoad, useModal,
} from '../ui';
import jobsIcon from '../assets/icons/nav-jobs.svg';

type Action = 'hide' | 'restore' | 'delete';

function useJobActions(reload: () => void) {
  const { modal, open } = useModal();
  const moderate = (j: { id: string; title: string }, action: Action) => open((close) => {
    const run = async (reason: string) => {
      await api('PATCH', `/jobs/${j.id}/status`, { action, reason: reason || undefined });
      toast.ok({ hide: 'Job hidden', restore: 'Job restored', delete: 'Job deleted' }[action], `“${j.title}” · recorded in Activity Logs.`);
      reload();
    };
    if (action === 'hide') return <ConfirmModal title="Hide job" danger reason confirmLabel="Hide job" onClose={close} onConfirm={run}
      text={<>Hide <b>“{j.title}”</b> from the public feed, search and its live link? Applications and files stay untouched; you can restore it.</>} />;
    if (action === 'delete') return <ConfirmModal title="Delete job" danger reason typeToConfirm="DELETE" confirmLabel="Delete job" onClose={close} onConfirm={run}
      text={<>Soft-delete <b>“{j.title}”</b>? It disappears from KOLABA. Nothing is erased — applications and media stay in the database, and an admin can restore it.</>} />;
    return <ConfirmModal title="Restore job" confirmLabel="Restore job" onClose={close} onConfirm={run}
      text={<>Restore <b>“{j.title}”</b> to the status it had before moderation?</>} />;
  });
  const edit = (id: string) => open((close) => <EditJob id={id} onClose={close} onSaved={reload} />);
  return { modal, moderate, edit };
}

const RANGES = [{ value: '', label: 'Any time' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }];

export function JobsPage({ owner }: { owner: string | null }) {
  const [search, setSearch] = useRemembered('jobs.q', '');
  const [status, setStatus] = useRemembered('jobs.status', '');
  const [category, setCategory] = useRemembered('jobs.category', '');
  const [range, setRange] = useRemembered('jobs.range', '');
  const [sort, setSort] = useRemembered('jobs.sort', 'newest');
  const [page, setPage] = useRemembered('jobs.page', 1);
  const [limit, setLimit] = useRemembered('jobs.limit', 20);
  const q = useDebounced(search);
  const from = range ? Date.now() - Number(range) * 86_400_000 : undefined;
  const list = useLoad<Paged<JobRow>>((s) => api('GET', `/jobs${query({ q, status, category, owner, from: from && Math.floor(from / 60_000) * 60_000, sort, page: owner ? 1 : page, limit: owner ? 100 : limit })}`, undefined, s),
                                      [q, status, category, range, sort, page, limit, owner]);
  const stats = useLoad<Dashboard>((s) => api('GET', '/dashboard', undefined, s), []);
  const cats = useLoad<{ items: string[] }>((s) => api('GET', '/jobs/categories', undefined, s), []);
  const { modal, moderate, edit } = useJobActions(() => { list.reload(); stats.reload(); });
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const st = stats.data?.stats;
  return (
    <>
      <PageHeader title="Jobs" subtitle="Monitor opportunities and collaboration activity" />
      <div className="content">
        {st && (
          <div className="kpis kpis--3">
            <KPI label="Total Jobs" icon={jobsIcon} value={fmtNum(st.totalJobs)} note="Published on KOLABA" />
            <KPI label="Active" icon={jobsIcon} value={fmtNum(st.activeJobs)} note="Open for creator applications" />
            <KPI label="Hidden" icon={jobsIcon} value={fmtNum(st.hiddenJobs)} note="Hidden by moderation" />
          </div>
        )}
        {owner && (
          <div className="filter-banner">Showing jobs of one account · <a href={href(`/users/${owner}`)}>Open account</a> · <a href={href('/jobs')}>Show all jobs</a></div>
        )}
        <div className="toolbar">
          <SearchField value={search} onChange={filter(setSearch)} placeholder="Search job title, job ID or author" />
          <Select label="Status" value={status} onChange={filter(setStatus)} options={[
            { value: '', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'closed', label: 'Closed' },
            { value: 'draft', label: 'Draft' }, { value: 'hidden', label: 'Hidden' }, { value: 'deleted', label: 'Deleted' }]} />
          {(cats.data?.items.length ?? 0) > 0 && (
            <Select label="Category" value={category} onChange={filter(setCategory)}
                    options={[{ value: '', label: 'All' }, ...cats.data!.items.map((c) => ({ value: c, label: c }))]} />
          )}
          <Select label="Published" value={range} onChange={filter(setRange)} options={RANGES} />
          <Select label="Sort" value={sort} onChange={filter(setSort)} options={[{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }]} />
        </div>
        <div className="table">
          <div className="table__head table__row jobs-grid">
            <span>Job title</span><span>Author</span><span>Category</span><span>Applications</span><span>Published</span><span>Status</span><span>Actions</span>
          </div>
          {list.error ? <ErrorState error={list.error} retry={list.reload} /> : !list.data ? <Loading /> :
            list.data.items.length === 0 ? <Empty title="No jobs found" text={q || status || category || range ? 'Try another search or clear the filters.' : 'No jobs have been created yet.'} /> : (
            <div className={list.loading ? 'is-refreshing' : ''}>
              {list.data.items.map((j) => (
                <div key={j.id} className="table__row jobs-grid is-link" role="link" tabIndex={0} onClick={() => navigate(`/jobs/${j.id}`)}
                     onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/jobs/${j.id}`); }}>
                  <span className="cell-user">
                    {j.thumbnailUrl ? <img className="thumb" src={j.thumbnailUrl} alt="" loading="lazy" /> : <span className="thumb thumb--empty"><Icon src={jobsIcon} size={15} /></span>}
                    <span className="cell-user__text"><b>{j.title}</b><span className="mono">{j.id}</span></span>
                  </span>
                  <span className="cell-user">
                    {j.author && <Avatar url={j.author.avatarUrl} name={j.author.displayName} size={24} />}
                    <span className="cell-user__text"><b className="regular">{j.author?.displayName ?? '—'}</b><span>@{j.author?.username}</span></span>
                  </span>
                  <span className="cell-muted ellipsis">{j.category ?? '—'}</span>
                  <span className="cell-muted">{fmtNum(j.applicationsCount)}</span>
                  <span className="cell-muted">{fmtDate(j.publishedAt ?? j.createdAt)}</span>
                  <span><Status value={j.status} /></span>
                  <span className="cell-actions">
                    <RowMenu actions={[
                      { label: 'View details', onClick: () => navigate(`/jobs/${j.id}`) },
                      { label: 'View live post', href: j.status === 'published' || j.status === 'closed' ? liveLink(j.id) : null, icon: <ExternalGlyph /> },
                      { label: 'Edit', onClick: () => edit(j.id) },
                      { label: 'Open author', onClick: () => j.author?.userId && navigate(`/users/${j.author.userId}`), hidden: !j.author?.userId },
                      { label: 'Hide', onClick: () => moderate(j, 'hide'), danger: true, hidden: j.status === 'hidden' || j.status === 'deleted' },
                      { label: 'Restore', onClick: () => moderate(j, 'restore'), hidden: j.status !== 'hidden' && j.status !== 'deleted' },
                      { label: 'Delete', onClick: () => moderate(j, 'delete'), danger: true, hidden: j.status === 'deleted' },
                    ]} />
                  </span>
                </div>
              ))}
            </div>
          )}
          {list.data && list.data.total > 0 && !owner && (
            <Pagination page={page} limit={limit} total={list.data.total} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          )}
        </div>
        <p className="safeguard"><Icon src={jobsIcon} size={14} />Hidden and deleted jobs disappear from KOLABA immediately and remain restorable here.</p>
      </div>
      {modal}
    </>
  );
}

const liveLink = (id: string) => `${import.meta.env.VITE_APP_URL.replace(/\/?$/, '/')}#/job/${encodeURIComponent(id)}`;

const money = (j: JobDetail) => {
  const f = (n: number | null) => (n == null ? '' : n.toLocaleString('en-US'));
  if (j.compensationType === 'barter') return 'Barter';
  if (j.compensationType === 'fixed') return `${f(j.budgetMin)} ${j.currency ?? ''}`.trim();
  if (j.compensationType === 'range') return `${f(j.budgetMin)}–${f(j.budgetMax)} ${j.currency ?? ''}`.trim();
  return 'Not specified';
};

export function JobPage({ id }: { id: string }) {
  const { data: j, error, reload } = useLoad<JobDetail>((s) => api('GET', `/jobs/${id}`, undefined, s), [id]);
  const { modal, moderate, edit } = useJobActions(reload);
  const moderated = j?.status === 'hidden' || j?.status === 'deleted';
  return (
    <>
      <PageHeader title={j?.title ?? 'Job'} subtitle={j && <span className="mono">{j.id}</span>} back={{ to: '/jobs', label: 'Jobs' }}
        actions={j && (
          <>
            <Button variant="primary" href={j.liveUrl} title={j.liveUrl ? 'Opens this job in the KOLABA web app' : undefined}>View Live Post <ExternalGlyph /></Button>
            <Button onClick={() => edit(j.id)}>Edit</Button>
            {moderated ? <Button onClick={() => moderate(j, 'restore')}>Restore</Button> : <Button variant="danger" onClick={() => moderate(j, 'hide')}>Hide</Button>}
            {j.status !== 'deleted' && <Button variant="ghost" onClick={() => moderate(j, 'delete')}>Delete</Button>}
          </>
        )} />
      <div className="content">
        {error ? <ErrorState error={error} retry={reload} /> : !j ? <Loading /> : (
          <div className="detail">
            <div className="detail__main">
              {!j.liveUrl && <div className="filter-banner">Not publicly visible ({j.status}) — the live link opens only for published and closed jobs.</div>}
              <section className="panel">
                <div className="panel__head"><div><h2>Description</h2></div><Status value={j.status} /></div>
                <p className="prose">{j.description || <span className="cell-muted">No description.</span>}</p>
                {j.tags.length > 0 && <div className="chips">{j.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>}
              </section>
              <section className="panel">
                <div className="panel__head"><div><h2>Attached media</h2><p>{j.media.length} file{j.media.length === 1 ? '' : 's'}</p></div></div>
                {j.media.length === 0 ? <div className="state"><span>No photos or videos attached.</span></div> : (
                  <div className="media-strip">
                    {j.media.map((m) => (
                      <a key={m.id} className="media-strip__item" href={m.url ?? undefined} target="_blank" rel="noopener noreferrer">
                        {m.kind === 'video'
                          ? (m.posterUrl ? <img src={m.posterUrl} alt="" /> : <video src={m.url ?? undefined} muted preload="metadata" />)
                          : <img src={m.url ?? undefined} alt="" loading="lazy" />}
                        {m.kind === 'video' && <span className="duration">▶ {fmtDuration(m.duration) ?? 'Video'}</span>}
                      </a>
                    ))}
                  </div>
                )}
              </section>
              <section className="panel">
                <div className="panel__head"><div><h2>Admin history</h2></div></div>
                {j.logs.length === 0 ? <div className="state"><span>No administrative actions yet.</span></div> : (
                  <ul className="history">
                    {j.logs.map((l) => <li key={l.id}><span className="mono">{fmtDateTime(l.created_at)}</span><b>{l.action}</b><span>{l.admin_email}</span><Status value={l.result} /><span className="cell-muted">{l.reason}</span></li>)}
                  </ul>
                )}
              </section>
            </div>
            <aside className="detail__side">
              <section className="panel">
                <div className="panel__head"><div><h2>Author</h2></div></div>
                {j.owner && (
                  <div className="author">
                    <Avatar url={j.owner.avatarUrl} name={j.owner.displayName} size={44} />
                    <div className="cell-user__text"><b>{j.owner.displayName}</b><span>@{j.owner.username} · {j.owner.type}</span></div>
                  </div>
                )}
                <div className="profile-card__actions">
                  <Button small onClick={() => navigate(`/users/${j.ownerUserId}`)}>Open author</Button>
                </div>
              </section>
              <section className="panel">
                <dl className="facts facts--stack">
                  <div><dt>Published</dt><dd>{fmtDateTime(j.publishedAt)}</dd></div>
                  <div><dt>Created</dt><dd>{fmtDateTime(j.createdAt)}</dd></div>
                  <div><dt>Category</dt><dd>{j.category ?? '—'}</dd></div>
                  <div><dt>Budget</dt><dd>{money(j)}</dd></div>
                  <div><dt>Location</dt><dd>{j.flag ? `${j.flag} ` : ''}{j.location}</dd></div>
                  <div><dt>Deadline</dt><dd>{fmtDate(j.deadline)}</dd></div>
                  <div><dt>Deliverables</dt><dd>{j.deliverables.length ? j.deliverables.map((d) => `${d.count} ${d.kind}`).join(', ') : '—'}</dd></div>
                  <div><dt>Applications</dt><dd>{fmtNum(j.applicationsTotal)} active{j.applicationsWithdrawn ? ` · ${j.applicationsWithdrawn} withdrawn` : ''}</dd></div>
                  <div><dt>Views</dt><dd>{fmtNum(j.viewsCount)}</dd></div>
                  {moderated && <div><dt>Moderation</dt><dd>{fmtDateTime(j.moderatedAt)} — {j.moderationReason}</dd></div>}
                </dl>
              </section>
            </aside>
          </div>
        )}
      </div>
      {modal}
    </>
  );
}

function EditJob({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const { data: j, error: loadError } = useLoad<JobDetail>((s) => api('GET', `/jobs/${id}`, undefined, s), [id]);
  const [form, setForm] = useState<{ title: string; description: string; category: string; location: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = form ?? (j ? { title: j.title, description: j.description, category: j.category ?? '', location: j.location } : null);
  const set = (k: 'title' | 'description' | 'category' | 'location') => (e: { target: { value: string } }) => setForm({ ...value!, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const res = await api<{ changed: string[] }>('PATCH', `/jobs/${id}`, { title: value!.title.trim(), description: value!.description,
        category: value!.category.trim() || null, location: value!.location.trim() || 'Worldwide' });
      toast.ok(res.changed.length ? 'Job updated' : 'No changes', res.changed.length ? `Changed: ${res.changed.join(', ')}` : undefined);
      onSaved(); onClose();
    } catch (e) { setError(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title="Edit job" onClose={busy ? () => {} : onClose} width={600}>
      {loadError ? <ErrorState error={loadError} /> : !value ? <Loading /> : (
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label="Title"><input className="input" required maxLength={100} value={value.title} onChange={set('title')} /></Field>
          <Field label={`Description (${value.description.length}/2000)`}><textarea className="input" rows={8} maxLength={2000} value={value.description} onChange={set('description')} /></Field>
          <div className="form-grid">
            <Field label="Category"><input className="input" maxLength={60} value={value.category} onChange={set('category')} /></Field>
            <Field label="Location"><input className="input" maxLength={120} value={value.location} onChange={set('location')} /></Field>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal__actions">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>Save changes</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
