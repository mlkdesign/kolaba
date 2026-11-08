// job. — the Jobs feed (Job posts · Applied · Saved / Job posts · My jobs), job details, Apply, editor, applicants.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Application, del, errorText, get, Job, Page, patch, post, put } from '../api';
import { activeProfile, isBusiness, openSheet, push, refresh, refreshTick, showToast } from '../state';
import { Avatar, confirmSheet, DemoTag, Empty, Icon, openViewer, price, ProBadge, RatingInline, SheetFrame, Spinner, timeAgo, TopBar, useDebounced, useLoad } from '../ui';

type JobsTab = 'all' | 'applied' | 'saved' | 'mine';

export function JobsScreen() {
  const business = isBusiness.value;
  const tabs: [JobsTab, string][] = business ? [['all', 'Job posts'], ['mine', 'My jobs']] : [['all', 'Job posts'], ['applied', 'Applied'], ['saved', 'Saved']];
  const [current, setCurrent] = useState<JobsTab>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 350);
  useEffect(() => { if (!tabs.some(([t]) => t === current)) setCurrent('all'); }, [business]);
  return (
    <>
      <header class="topbar">
        {searching ? (
          <>
            <label class="search"><img src={`${import.meta.env.BASE_URL}icons/IconMagnifyingGlass.svg`} alt="" />
              <input autoFocus placeholder="Search jobs" value={query} onInput={(e) => setQuery(e.currentTarget.value)} /></label>
            <button class="glass-btn" aria-label="Close search" onClick={() => { setSearching(false); setQuery(''); }}><Icon name="IconSheetClose" size={14} /></button>
          </>
        ) : (
          <>
            <div class="logo-word">job<i>.</i></div>
            <button class="glass-btn" aria-label="Search" onClick={() => setSearching(true)}><Icon name="IconMagnifyingGlass" /></button>
            {business && <button class="glass-btn" aria-label="Create job" onClick={() => push('job-editor', {})}><Icon name="IconPlus" /></button>}
          </>
        )}
      </header>
      <div class="scroll">
        <div class="below-topbar" />
        <nav class="seg sticky" aria-label="Jobs tabs">
          {tabs.map(([t, label]) => (
            <button class={`seg__tab ${current === t ? 'is-active' : ''}`} onClick={() => setCurrent(t)}>{label}</button>
          ))}
        </nav>
        <div style={{ height: 14 }} />
        {/* Each tab keeps its own list (and position) while mounted. */}
        {tabs.map(([t]) => (
          <div hidden={t !== current} key={t}><JobList tab={t} q={q} /></div>
        ))}
      </div>
    </>
  );
}

function JobList({ tab, q }: { tab: JobsTab; q: string }) {
  const [items, setItems] = useState<Job[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sentinel = useRef<HTMLDivElement>(null);
  const load = async (reset: boolean) => {
    setLoading(true);
    try {
      const page = await get<Page<Job>>(`/v1/jobs?tab=${tab}&q=${encodeURIComponent(q)}${!reset && cursor ? `&cursor=${cursor}` : ''}`);
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
      setError('');
    } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(true); }, [tab, q, refreshTick.value, activeProfile.value?.id]);
  useEffect(() => {
    if (!sentinel.current) return;
    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting && cursor && !loading) void load(false); }, { rootMargin: '400px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [cursor, loading]);
  if (error && !items.length) return <Empty title="Couldn't load jobs" text={error}><button class="btn small secondary" onClick={() => load(true)}>Try again</button></Empty>;
  if (!loading && !items.length) {
    const texts: Record<JobsTab, [string, string]> = {
      all: ['No jobs found', q ? 'Try another search.' : 'New jobs appear here.'],
      applied: ['No applications yet', 'Jobs you apply to appear here.'],
      saved: ['Nothing saved', 'Tap the bookmark on a job to keep it here.'],
      mine: ['No jobs yet', 'Create your first job with the + button.'],
    };
    return <Empty title={texts[tab][0]} text={texts[tab][1]} iconName="IconBriefcase" />;
  }
  return (
    <>
      {items.map((job) => <JobCard job={job} key={job.id} onChange={(j) => setItems((all) => all.map((x) => (x.id === j.id ? j : x)))} />)}
      <div ref={sentinel} />
      {loading && <Spinner />}
    </>
  );
}

export function JobCard({ job, onChange }: { job: Job; onChange?: (job: Job) => void }) {
  const amount = price(job);
  const toggleSave = async (e: Event) => {
    e.stopPropagation();
    try {
      job.isSaved ? await del(`/v1/jobs/${job.id}/save`) : await put(`/v1/jobs/${job.id}/save`);
      onChange?.({ ...job, isSaved: !job.isSaved });
    } catch (err) { showToast(errorText(err), 'error'); }
  };
  return (
    <div class="job-card" role="button" tabIndex={0} onClick={() => push('job', { id: job.id })} onKeyDown={(e) => e.key === 'Enter' && push('job', { id: job.id })}>
      <div class="job-card__head">
        <Avatar card={job.owner} size={40} />
        <div class="grow">
          <div class="job-card__author ellipsis">{job.owner?.displayName} <ProBadge card={job.owner ?? { isPro: false, type: 'business' }} /></div>
          <div class="job-card__meta">{job.flag} {job.location} · {timeAgo(job.publishedAt ?? job.createdAt)}</div>
        </div>
        {job.status !== 'published' && <span class={`status-pill ${job.status}`}>{job.status}</span>}
        {!isBusiness.value && job.status !== 'draft' && (
          <button class="bookmark" aria-label={job.isSaved ? 'Remove from saved' : 'Save'} onClick={toggleSave}>
            <Icon name={job.isSaved ? 'IconBookmarkFilled' : 'IconBookmarkSimple'} size={18} />
          </button>
        )}
      </div>
      {job.media.length > 0 && (
        <div class="job-card__media">
          {job.media.slice(0, 6).map((m) => <img src={(m.kind === 'video' ? m.posterUrl : m.url) ?? ''} alt="" loading="lazy" />)}
        </div>
      )}
      <div class="job-card__body">
        <div class="job-card__title">{job.title}</div>
        <div class="job-card__desc">{job.description}</div>
      </div>
      <div class="job-card__foot">
        {amount && <span class="price">{amount}</span>}
        {job.deliverables.slice(0, 2).map((d) => <span class="tag">{d.count} {d.kind}</span>)}
        <span class="grow" />
        <span class="muted" style={{ fontSize: 12 }}>{job.applicationsCount} applied</span>
        {job.myApplicationId && <span class="tag" style={{ color: 'var(--success)' }}>Applied</span>}
      </div>
    </div>
  );
}

export function JobScreen({ id }: { id: string }) {
  const { data: job, error, setData, reload } = useLoad<Job>((s) => get(`/v1/jobs/${id}`, s), [id, refreshTick.value]);
  if (error) return <><TopBar title="Job" /><div class="below-topbar"><Empty title="Job not available" text={errorText(error)} /></div></>;
  if (!job) return <><TopBar title="Job" /><div class="below-topbar"><Spinner /></div></>;
  const me = activeProfile.value;
  const isOwner = me?.id === job.ownerProfileId;
  const amount = price(job);
  const apply = () => openSheet((close) => <ApplySheet job={job} close={close} onDone={() => { close(); reload(); refresh(); }} />, true);
  const withdraw = () => confirmSheet('Withdraw application?', 'The business will no longer see it. You can apply again later.', 'Withdraw', async () => {
    try { await post(`/v1/jobs/applications/${job.myApplicationId}/withdraw`); showToast('Application withdrawn', 'ok'); reload(); refresh(); }
    catch (e) { showToast(errorText(e), 'error'); }
  }, true);
  const message = async () => {
    try {
      const { id: conversationId } = await post('/v1/conversations', { profileId: job.ownerProfileId, jobId: job.id });
      push('conversation', { id: conversationId });
    } catch (e) { showToast(errorText(e), 'error'); }
  };
  const setStatus = async (action: 'publish' | 'close') => {
    try { setData(await post(`/v1/jobs/${job.id}/${action}`)); showToast(action === 'publish' ? 'Published' : 'Closed — no more applications', 'ok'); refresh(); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  return (
    <>
      <TopBar title={job.title}>
        {!isOwner && !isBusiness.value && (
          <button class="glass-btn" aria-label="Save" onClick={async () => {
            try { job.isSaved ? await del(`/v1/jobs/${job.id}/save`) : await put(`/v1/jobs/${job.id}/save`); setData({ ...job, isSaved: !job.isSaved }); refresh(); }
            catch (e) { showToast(errorText(e), 'error'); }
          }}><Icon name={job.isSaved ? 'IconBookmarkFilled' : 'IconBookmarkSimple'} /></button>
        )}
        {isOwner && <button class="glass-btn" aria-label="Edit" onClick={() => push('job-editor', { job })}><Icon name="IconPencilSimple" /></button>}
      </TopBar>
      <div class="scroll no-tabbar" style={{ paddingBottom: 120 }}>
        <div class="below-topbar" />
        {job.media.length > 0 && (
          <div class="job-card__media" style={{ padding: '0 var(--gutter)', marginBottom: 14 }}>
            {job.media.map((m) => (
              <button onClick={() => openViewer(m)} style={{ position: 'relative' }}>
                <img src={(m.kind === 'video' ? m.posterUrl : m.url) ?? ''} alt="" style={{ width: 150, height: 210 }} />
                {m.kind === 'video' && <span class="media-tile__badge"><Icon name="IconPlay" size={11} /></span>}
              </button>
            ))}
          </div>
        )}
        <div class="pad">
          <button class="row" style={{ textAlign: 'left', width: '100%' }} onClick={() => job.owner && push('profile-view', { id: job.owner.id })}>
            <Avatar card={job.owner} size={44} />
            <div class="grow">
              <div style={{ fontWeight: 600 }}>{job.owner?.displayName} <ProBadge card={job.owner ?? { isPro: false, type: 'business' }} />{job.owner && <DemoTag card={job.owner} />}</div>
              <RatingInline rating={job.owner?.rating ?? null} count={job.owner?.reviewsCount ?? 0} />
            </div>
            {job.status !== 'published' && <span class={`status-pill ${job.status}`}>{job.status}</span>}
          </button>
          <h1 style={{ fontSize: 22, margin: '18px 0 6px', lineHeight: 1.25 }}>{job.title}</h1>
          <div class="muted" style={{ fontSize: 13 }}>{job.flag} {job.location} · Published {timeAgo(job.publishedAt ?? job.createdAt)} ago · {job.viewsCount} views</div>
          <div class="figures">
            <div class="figure"><b>{amount ?? '—'}</b><span>{job.compensationType === 'range' ? 'Budget range' : job.compensationType === 'fixed' ? 'Fixed price' : 'Compensation'}</span></div>
            <div class="figure"><b>{job.applicationsCount}</b><span>Applied</span></div>
            <div class="figure"><b>{job.deadline ? new Date(job.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</b><span>Deadline</span></div>
          </div>
          <p class="profile-bio selectable">{job.description}</p>
          {job.deliverables.length > 0 && (<><div class="section-title" style={{ margin: '18px 0 8px' }}>Deliverables</div>
            <div class="chips">{job.deliverables.map((d) => <span class="chip">{d.count} {d.kind}</span>)}</div></>)}
          {job.languages.length > 0 && (<><div class="section-title" style={{ margin: '18px 0 8px' }}>Languages</div>
            <div class="chips">{job.languages.map((l) => <span class="chip">{l.toUpperCase()}</span>)}</div></>)}
          {job.tags.length > 0 && (<><div class="section-title" style={{ margin: '18px 0 8px' }}>Tags</div>
            <div class="chips">{job.tags.map((t) => <span class="chip">{t}</span>)}</div></>)}
        </div>
        {isOwner && <Applicants job={job} />}
      </div>
      <div class="bottom-bar">
        {isOwner ? (
          <>
            {job.status === 'published'
              ? <button class="btn secondary" onClick={() => setStatus('close')}>Close applications</button>
              : <button class="btn accent" onClick={() => setStatus('publish')}>{job.status === 'draft' ? 'Publish' : 'Re-open'}</button>}
          </>
        ) : isBusiness.value ? (
          <div class="muted" style={{ fontSize: 13, flex: 1, textAlign: 'center' }}>Switch to a creator profile to apply.</div>
        ) : job.myApplicationId ? (
          <>
            <button class="btn secondary" onClick={withdraw}>Withdraw</button>
            <button class="btn" onClick={message}>Message</button>
          </>
        ) : (
          <button class="btn accent" disabled={!job.acceptsApplications} onClick={apply}>{job.acceptsApplications ? 'Apply' : 'Applications closed'}</button>
        )}
      </div>
    </>
  );
}

function ApplySheet({ job, close, onDone }: { job: Job; close: () => void; onDone: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const ent = activeProfile.value?.entitlements;
  const portfolio = useLoad((s) => get(`/v1/profiles/${activeProfile.value!.id}/media?purpose=portfolio`, s), []);
  const send = async () => {
    setBusy(true);
    try { await post(`/v1/jobs/${job.id}/apply`, { message, mediaIds: selected }); showToast('Application sent', 'ok'); onDone(); }
    catch (e) { showToast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <SheetFrame title="Apply" close={close}>
      <div class="muted" style={{ fontSize: 13, marginBottom: 10 }}>{job.title} · {job.owner?.displayName}</div>
      <textarea class="textarea" maxLength={2000} placeholder="Message to the business: why you, ideas, dates…" value={message}
        onInput={(e) => setMessage(e.currentTarget.value)} />
      <div class="section-title" style={{ margin: '18px 0 8px' }}>Attach from portfolio {ent?.canAttachMediaToApplications ? '' : '· creator.pro'}</div>
      {ent?.canAttachMediaToApplications ? (
        <div class="media-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {(portfolio.data?.items ?? []).slice(0, 12).map((m: any) => (
            <button class="media-tile" style={{ outline: selected.includes(m.id) ? '3px solid var(--accent)' : 'none', outlineOffset: -3 }}
              onClick={() => setSelected((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id].slice(0, 10)))}>
              <img src={(m.kind === 'video' ? m.posterUrl : m.url) ?? ''} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : (
        <div class="locked-card"><b>Attach media with creator.pro</b><div class="soft" style={{ fontSize: 13, marginTop: 4 }}>
          Free applications are text-only. (Test environment: PRO is granted to demo accounts.)</div></div>
      )}
      <button class="btn accent" style={{ marginTop: 18 }} disabled={busy || !message.trim()} onClick={send}>{busy ? 'Sending…' : 'Send application'}</button>
    </SheetFrame>
  );
}

function Applicants({ job }: { job: Job }) {
  const [sort, setSort] = useState('newest');
  const [shortlisted, setShortlisted] = useState(false);
  const { data, setData } = useLoad<{ items: Application[] }>((s) => get(`/v1/jobs/${job.id}/applications?sort=${sort}&shortlisted=${shortlisted ? 1 : 0}`, s),
    [job.id, sort, shortlisted, refreshTick.value]);
  const toggle = async (a: Application) => {
    try {
      await put(`/v1/jobs/applications/${a.id}/shortlist`, { shortlisted: !a.isShortlisted });
      setData({ items: data!.items.map((x) => (x.id === a.id ? { ...x, isShortlisted: !x.isShortlisted } : x)) });
    } catch (e) { showToast(errorText(e), 'error'); }
  };
  const message = async (a: Application) => {
    try { const { id } = await post('/v1/conversations', { profileId: a.applicant!.id, jobId: job.id }); push('conversation', { id }); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  return (
    <div style={{ marginTop: 22 }}>
      <div class="row pad" style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }} class="grow">Applicants <span class="muted">{data?.items.length ?? ''}</span></div>
        <select class="select" style={{ width: 'auto', height: 34, padding: '0 12px', fontSize: 13 }} value={sort} onChange={(e) => setSort(e.currentTarget.value)} aria-label="Sort">
          <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="rating">Highest rated</option>
        </select>
        <button class={`chip ${shortlisted ? 'is-on' : ''}`} onClick={() => setShortlisted(!shortlisted)}>♥ Shortlist</button>
      </div>
      {!data ? <Spinner /> : !data.items.length ? <Empty title="No applicants yet" text="Applications appear here as creators apply." iconName="IconUser" /> :
        data.items.map((a) => (
          <div class="review" key={a.id}>
            <div class="row">
              <button class="row grow" style={{ textAlign: 'left' }} onClick={() => a.applicant && push('profile-view', { id: a.applicant.id })}>
                <Avatar card={a.applicant} size={42} />
                <div class="grow"><div style={{ fontWeight: 600 }}>{a.applicant?.displayName} {a.applicant && <ProBadge card={a.applicant} />}</div>
                  <RatingInline rating={a.applicant?.rating ?? null} count={a.applicant?.reviewsCount ?? 0} /></div>
              </button>
              <span class="muted" style={{ fontSize: 12 }}>{timeAgo(a.createdAt)}</span>
            </div>
            <div class="review__text selectable">{a.message}</div>
            {a.media.length > 0 && (
              <div class="job-card__media" style={{ padding: 0, marginTop: 10 }}>
                {a.media.map((m) => <button onClick={() => openViewer(m)}><img src={(m.kind === 'video' ? m.posterUrl : m.url) ?? ''} alt="" style={{ width: 80, height: 110 }} /></button>)}
              </div>
            )}
            <div class="row" style={{ marginTop: 12 }}>
              <button class="btn small secondary" onClick={() => toggle(a)}>{a.isShortlisted ? '♥ Shortlisted' : '♡ Shortlist'}</button>
              <button class="btn small" onClick={() => message(a)}>Message</button>
            </div>
          </div>
        ))}
    </div>
  );
}

export function JobEditor({ job }: { job?: Job }) {
  const [title, setTitle] = useState(job?.title ?? '');
  const [description, setDescription] = useState(job?.description ?? '');
  const [worldwide, setWorldwide] = useState(job?.isWorldwide ?? false);
  const [city, setCity] = useState(job?.city ?? '');
  const [location, setLocation] = useState(job && !job.isWorldwide ? job.location : '');
  const [comp, setComp] = useState<Job['compensationType']>(job?.compensationType ?? 'fixed');
  const [min, setMin] = useState(job?.budgetMin != null ? String(job.budgetMin) : '');
  const [max, setMax] = useState(job?.budgetMax != null ? String(job.budgetMax) : '');
  const [currency, setCurrency] = useState(job?.currency ?? 'USD');
  const [tags, setTags] = useState((job?.tags ?? []).join(', '));
  const [reels, setReels] = useState(String(job?.deliverables.find((d) => d.kind === 'reels')?.count ?? ''));
  const [photos, setPhotos] = useState(String(job?.deliverables.find((d) => d.kind === 'photos')?.count ?? ''));
  const [busy, setBusy] = useState(false);
  const save = async (publish: boolean) => {
    setBusy(true);
    const body = {
      title, description, isWorldwide: worldwide, location: worldwide ? 'Worldwide' : (location || city || 'Worldwide'), city: worldwide ? null : city || null,
      compensationType: comp, budgetMin: ['fixed', 'range'].includes(comp) ? Number(min) : null, budgetMax: comp === 'range' ? Number(max) : null,
      currency: ['fixed', 'range'].includes(comp) ? currency : null, tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12),
      deliverables: [['reels', reels], ['photos', photos]].filter(([, n]) => Number(n) > 0).map(([kind, n]) => ({ kind, count: Number(n) })),
      mediaIds: job?.media.map((m) => m.id),
    };
    try {
      const saved: Job = job ? await patch(`/v1/jobs/${job.id}`, body) : await post('/v1/jobs', { ...body, publish });
      if (job && publish && saved.status !== 'published') await post(`/v1/jobs/${job.id}/publish`);
      showToast(publish ? 'Job published' : 'Saved', 'ok');
      refresh();
      (await import('../state')).back();
    } catch (e) { showToast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const remove = () => confirmSheet('Delete job?', 'It disappears with its applications. This can\'t be undone.', 'Delete', async () => {
    try { await del(`/v1/jobs/${job!.id}`); refresh(); const s = await import('../state'); s.back(); s.back(); } catch (e) { showToast(errorText(e), 'error'); }
  }, true);
  return (
    <>
      <TopBar title={job ? 'Edit job' : 'New job'} />
      <div class="scroll no-tabbar" style={{ paddingBottom: 120 }}>
        <div class="below-topbar" />
        <div class="pad">
          <label class="field"><span class="field__label">Title</span><input class="input" maxLength={100} value={title} onInput={(e) => setTitle(e.currentTarget.value)} /></label>
          <label class="field"><span class="field__label">Details</span><textarea class="textarea" maxLength={2000} value={description} onInput={(e) => setDescription(e.currentTarget.value)} /></label>
          <div class="field__label">Location</div>
          <div class="chips" style={{ marginBottom: 10 }}>
            <button class={`chip ${worldwide ? 'is-on' : ''}`} onClick={() => setWorldwide(true)}>🌍 Worldwide</button>
            <button class={`chip ${!worldwide ? 'is-on' : ''}`} onClick={() => setWorldwide(false)}>📍 Specific place</button>
          </div>
          {!worldwide && (
            <div class="row">
              <label class="field grow"><span class="field__label">City</span><input class="input" value={city} onInput={(e) => setCity(e.currentTarget.value)} /></label>
              <label class="field grow"><span class="field__label">Shown as</span><input class="input" placeholder="Bali, Indonesia" value={location} onInput={(e) => setLocation(e.currentTarget.value)} /></label>
            </div>
          )}
          <div class="field__label">Compensation</div>
          <div class="chips" style={{ marginBottom: 10 }}>
            {(['fixed', 'range', 'barter', 'not_selected'] as const).map((c) => (
              <button class={`chip ${comp === c ? 'is-on' : ''}`} onClick={() => setComp(c)}>{{ fixed: 'Fixed price', range: 'Budget range', barter: 'Barter', not_selected: 'Not set' }[c]}</button>
            ))}
          </div>
          {['fixed', 'range'].includes(comp) && (
            <div class="row">
              <label class="field grow"><span class="field__label">{comp === 'range' ? 'From' : 'Amount'}</span><input class="input" inputMode="decimal" value={min} onInput={(e) => setMin(e.currentTarget.value.replace(/[^\d.]/g, ''))} /></label>
              {comp === 'range' && <label class="field grow"><span class="field__label">To</span><input class="input" inputMode="decimal" value={max} onInput={(e) => setMax(e.currentTarget.value.replace(/[^\d.]/g, ''))} /></label>}
              <label class="field" style={{ width: 96 }}><span class="field__label">Currency</span>
                <select class="select" value={currency} onChange={(e) => setCurrency(e.currentTarget.value)}>
                  {['USD', 'EUR', 'GBP', 'UAH', 'PLN', 'AED', 'THB', 'KZT', 'IDR', 'TRY'].map((c) => <option>{c}</option>)}
                </select></label>
            </div>
          )}
          <div class="row">
            <label class="field grow"><span class="field__label">Reels</span><input class="input" inputMode="numeric" value={reels} onInput={(e) => setReels(e.currentTarget.value.replace(/\D/g, ''))} /></label>
            <label class="field grow"><span class="field__label">Photos</span><input class="input" inputMode="numeric" value={photos} onInput={(e) => setPhotos(e.currentTarget.value.replace(/\D/g, ''))} /></label>
          </div>
          <label class="field"><span class="field__label">Tags (comma separated)</span><input class="input" value={tags} onInput={(e) => setTags(e.currentTarget.value)} /></label>
          {job && <button class="btn danger" style={{ marginTop: 10 }} onClick={remove}>Delete job</button>}
        </div>
      </div>
      <div class="bottom-bar">
        {(!job || job.status === 'draft') && <button class="btn secondary" disabled={busy || !title.trim()} onClick={() => save(false)}>Save draft</button>}
        <button class="btn accent" disabled={busy || !title.trim()} onClick={() => save(!job || job.status !== 'closed')}>{job && job.status === 'published' ? 'Save' : 'Publish'}</button>
      </div>
    </>
  );
}
