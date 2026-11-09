// Media (Figma: Screen / Media) — public library media (portfolio, intro, collections, job attachments, avatars).
// Chat and application attachments are private and never listed. Hide keeps the file in R2; Restore brings it back.
import { api, query, type MediaRow, type Paged } from '../api';
import { PageHeader } from '../app';
import { href, navigate, useRemembered } from '../router';
import {
  ConfirmModal, Empty, ErrorState, ExternalGlyph, Icon, Loading, Pagination, RowMenu, SearchField, Select, Status, fmtBytes, fmtDate,
  fmtDuration, toast, useDebounced, useLoad, useModal,
} from '../ui';
import mediaIcon from '../assets/icons/nav-media.svg';

const PURPOSES = ['portfolio', 'intro', 'collection', 'job', 'avatar'];

export function MediaPage({ owner }: { owner: string | null }) {
  const [search, setSearch] = useRemembered('media.q', '');
  const [kind, setKind] = useRemembered('media.kind', '');
  const [purpose, setPurpose] = useRemembered('media.purpose', '');
  const [status, setStatus] = useRemembered('media.status', '');
  const [sort, setSort] = useRemembered('media.sort', 'newest');
  const [page, setPage] = useRemembered('media.page', 1);
  const [limit, setLimit] = useRemembered('media.limit', 20);
  const q = useDebounced(search);
  const list = useLoad<Paged<MediaRow>>((s) => api('GET', `/media${query({ q, kind, purpose, status, owner, sort, page, limit })}`, undefined, s),
                                        [q, kind, purpose, status, owner, sort, page, limit]);
  const { modal, open } = useModal();
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const moderate = (m: MediaRow, action: 'hide' | 'restore') => open((close) => (
    <ConfirmModal title={action === 'hide' ? 'Hide media' : 'Restore media'} danger={action === 'hide'} reason={action === 'hide'}
      confirmLabel={action === 'hide' ? 'Hide media' : 'Restore'} onClose={close}
      onConfirm={async (reason) => {
        await api('PATCH', `/media/${m.id}/status`, { action, reason: reason || undefined });
        toast.ok(action === 'hide' ? 'Media hidden' : 'Media restored', 'Recorded in Activity Logs.');
        list.reload();
      }}
      text={action === 'hide'
        ? <>Hide this {m.kind} of <b>@{m.owner?.username}</b> from KOLABA? The file stays in storage and its links to profiles and jobs are kept.</>
        : <>Make this {m.kind} of <b>@{m.owner?.username}</b> visible in KOLABA again?</>} />
  ));
  return (
    <>
      <PageHeader title="Media" subtitle="Photos and videos published on KOLABA profiles and jobs" />
      <div className="content">
        {owner && <div className="filter-banner">Showing media of one account · <a href={href(`/users/${owner}`)}>Open account</a> · <a href={href('/media')}>Show all media</a></div>}
        <div className="toolbar">
          <SearchField value={search} onChange={filter(setSearch)} placeholder="Search title, media ID or owner" />
          <Select label="Type" value={kind} onChange={filter(setKind)} options={[{ value: '', label: 'All' }, { value: 'video', label: 'Videos' }, { value: 'photo', label: 'Photos' }]} />
          <Select label="Used in" value={purpose} onChange={filter(setPurpose)} options={[{ value: '', label: 'All' }, ...PURPOSES.map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) }))]} />
          <Select label="Status" value={status} onChange={filter(setStatus)} options={[{ value: '', label: 'All' }, { value: 'visible', label: 'Visible' }, { value: 'hidden', label: 'Hidden' }]} />
          <Select label="Uploaded" value={sort} onChange={filter(setSort)} options={[{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }]} />
        </div>
        {list.error ? <ErrorState error={list.error} retry={list.reload} /> : !list.data ? <Loading /> :
          list.data.items.length === 0 ? <div className="table"><Empty title="No media found" text="Try another search or clear the filters." /></div> : (
          <>
            <div className={`media-grid ${list.loading ? 'is-refreshing' : ''}`}>
              {list.data.items.map((m) => {
                const preview = m.kind === 'video' ? m.posterUrl : m.url;
                return (
                  <article key={m.id} className={`media-card ${m.status === 'hidden' ? 'is-hidden' : ''}`}>
                    <a className="media-card__preview" href={m.url ?? undefined} target="_blank" rel="noopener noreferrer" aria-label="Open media">
                      {preview ? <img src={preview} alt="" loading="lazy" />
                        : m.kind === 'video' && m.url ? <video src={m.url} muted preload="metadata" />
                        : <span className="media-card__none"><Icon src={mediaIcon} size={20} />{m.status === 'hidden' ? 'Hidden — not served' : 'No preview'}</span>}
                      {m.kind === 'video' && preview && <span className="media-card__play">▶</span>}
                      {fmtDuration(m.duration) && <span className="duration">{fmtDuration(m.duration)}</span>}
                    </a>
                    <div className="media-card__body">
                      <div className="media-card__title">
                        <b className="ellipsis">{m.title || `${m.kind === 'video' ? 'Video' : 'Photo'} · ${m.purpose}`}</b>
                        <RowMenu actions={[
                          { label: 'Open media', href: m.url, icon: <ExternalGlyph /> },
                          { label: 'Go to owner', onClick: () => m.owner?.userId && navigate(`/users/${m.owner.userId}`), hidden: !m.owner?.userId },
                          { label: 'Open job', onClick: () => navigate(`/jobs/${m.jobId}`), hidden: !m.jobId },
                          { label: m.jobId ? 'View live post' : 'View public profile', href: m.publicUrl, icon: <ExternalGlyph /> },
                          { label: 'Hide', onClick: () => moderate(m, 'hide'), danger: true, hidden: m.status === 'hidden' },
                          { label: 'Restore', onClick: () => moderate(m, 'restore'), hidden: m.status !== 'hidden' },
                        ]} />
                      </div>
                      <span className="cell-muted ellipsis">{m.owner?.displayName} · @{m.owner?.username}</span>
                      <div className="media-card__meta">
                        <span className="cell-muted">{fmtDate(m.createdAt)} · {m.purpose}{m.bytes ? ` · ${fmtBytes(m.bytes)}` : ''}</span>
                        <Status value={m.status} />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="table table--bare">
              <Pagination page={page} limit={limit} total={list.data.total} noun="files" onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
            </div>
          </>
        )}
      </div>
      {modal}
    </>
  );
}
