// job. — ProjectsView: the feed (Job posts · Applied · Saved / Job posts · My jobs, swiped sideways), the post card
// (Figma 654:13119), job details (400 pt media, content 38 pt over it, the glass Apply bar), Apply, applicants, editor.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Application, del, errorText, get, Job, Page, patch, post, put } from '../api';
import { activeProfile, back, isBusiness, openSheet, profiles, push, refresh, refreshTick, showToast } from '../state';
import { offerRoleSwitch } from '../roles';
import {
  SortButton, pickSheet, Avatar, BackButton, confirmSheet, Empty, Gallery, GlassButton, Header, HeaderTitle, Icon, icon, Logo, MediaTile, openViewer, PageTabs, postDate, price,
  priceCaption, ProBadge, RatingInline, SheetFrame, Spinner, SwipePages, timeAgo, useDebounced, useLoad, usePullToRefresh, useCollapsingHeader, TopBlur, PinnedTabs,
} from '../ui';

type JobsTab = 'all' | 'applied' | 'saved' | 'mine';

export function JobsScreen() {
  const business = isBusiness.value;
  const tabs: [JobsTab, string][] = business ? [['all', 'Job posts'], ['mine', 'My jobs']] : [['all', 'Job posts'], ['applied', 'Applied'], ['saved', 'Saved']];
  const [index, setIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 350);
  useEffect(() => { setIndex(0); }, [business]);
  const reloads = useRef<Record<string, () => Promise<unknown>>>({});
  const { scroller, Indicator } = usePullToRefresh(() => reloads.current[tabs[index][0]]?.());
  const { root, changeTab } = useCollapsingHeader({}, scroller);
  const pick = (i: number) => changeTab(index, i, () => setIndex(i));
  const create = () => {
    if (activeProfile.value?.entitlements.canCreateJobs) push('job-editor', {});
    else offerRoleSwitch('createJob', () => push('job-editor', {}, 'jobs'));
  };
  return (
    <div class="collapsing" ref={root}>
      <div class="scroll" ref={scroller}>
        <TopBlur sticky />
        <PinnedTabs class="tabs-pin"><PageTabs tabs={tabs.map(([, l]) => l)} index={index} onChange={pick} /></PinnedTabs>
        <SwipePages index={index} onChange={pick}>
          {tabs.map(([t]) => <JobList key={t} tab={t} q={q} register={(fn) => { reloads.current[t] = fn; }} />)}
        </SwipePages>
        <div style={{ height: 'var(--tabbar-clear)' }} />
      </div>
      <Indicator />
      <Header blur={false}
        left={searching ? null : <GlassButton name="IconPlus" label="Create job" onClick={create} />}
        collapsingTitle center={searching ? null : <Logo word="job" />}
        right={searching ? (
          <div class="row" style={{ width: 370, gap: 8 }}>
            <label class="glass search"><img src={icon('IconMagnifyingGlass')} alt="" />
              <input autoFocus placeholder="Search jobs" value={query} onInput={(e) => setQuery(e.currentTarget.value)} /></label>
            <GlassButton name="IconSheetClose" label="Close search" onClick={() => { setSearching(false); setQuery(''); }} />
          </div>
        ) : <GlassButton name="IconMagnifyingGlass" label="Search" onClick={() => setSearching(true)} />}
      />
    </div>
  );
}

function JobList({ tab, q, register }: { tab: JobsTab; q: string; register: (fn: () => Promise<unknown>) => void }) {
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
      setCursor(page.nextCursor); setError('');
    } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  };
  register(() => load(true));
  useEffect(() => { void load(true); }, [tab, q, refreshTick.value, activeProfile.value?.id]);
  useEffect(() => {
    if (!sentinel.current) return;
    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting && cursor && !loading) void load(false); }, { rootMargin: '600px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [cursor, loading]);
  if (error && !items.length) return <Empty title="Couldn't load jobs" text={error}><button class="btn is-small is-milky" onClick={() => load(true)}>Try again</button></Empty>;
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
    <div class="feed">
      {!items.length && loading && <div class="skeleton" style={{ height: 420 }} />}
      {items.map((job, i) => (
        <div key={job.id}>
          {i > 0 && <div style={{ height: 1, background: 'var(--separator)', margin: '20px 0' }} />}
          <JobCard job={job} onChange={(j) => setItems((all) => all.map((x) => (x.id === j.id ? j : x)))} />
        </div>
      ))}
      <div ref={sentinel} />
      {loading && items.length > 0 && <Spinner />}
    </div>
  );
}

/** ProjectPostView: author row, media, headline + price, place + languages, description, applicants · bookmark · View project. */
export function JobCard({ job, onChange }: { job: Job; onChange?: (job: Job) => void }) {
  const amount = price(job);
  const open = () => push('job', { id: job.id });
  const toggleSave = async (e: Event) => {
    e.stopPropagation();
    const next = !job.isSaved;
    onChange?.({ ...job, isSaved: next });
    try { next ? await put(`/v1/jobs/${job.id}/save`) : await del(`/v1/jobs/${job.id}/save`); }
    catch (err) { onChange?.({ ...job, isSaved: !next }); showToast(errorText(err), 'error'); }
  };
  const mine = activeProfile.value?.id === job.ownerProfileId;
  const applied = !!job.myApplicationId;
  return (
    <article class="post">
      <div class="row" style={{ gap: 10 }}>
        <button class="post__head" onClick={() => job.owner && push('profile-view', { id: job.owner.id })}>
          <Avatar card={job.owner} size={48} ring />
          <div class="grow">
            <div class="post__author"><span class="ellipsis">{job.owner?.displayName}</span><ProBadge card={job.owner} compact /></div>
            <div class="post__date">{postDate(job.publishedAt ?? job.createdAt)}</div>
          </div>
        </button>
        {job.status !== 'published' && <span class={`status-pill ${job.status}`}>{job.status}</span>}
        <button class="post__more" aria-label="More" onClick={() => jobMenu(job)}><img src={icon('IconDotsThree')} alt="" /></button>
      </div>
      {job.media.length > 0 && <Gallery media={job.media} onOpen={(m) => (m.kind === 'video' ? openViewer(m) : open())} />}
      <div class="post__info" onClick={open} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open()}>
        <div class="post__headline">
          <div class="post__title">{job.title}</div>
          {amount && <div class="post__price">{amount}<small>{priceCaption(job.compensationType)}</small></div>}
        </div>
        <div class="post__req">
          <span>{job.flag && <span class="flag">{job.flag}</span>}{job.location}</span>
          {job.languages.length > 0 && <span><img src={icon('IconTranslate')} alt="" />{job.languages.map(langName).join(', ')}</span>}
        </div>
        <div class="post__desc lines-4">{job.description}</div>
      </div>
      <div class="post__actions" style={{ padding: '0 8px' }}>
        <div class="post__applicants"><img src={icon('IconUser')} alt="" />{job.applicationsCount} {job.applicationsCount === 1 ? 'applicant' : 'applicants'}</div>
        {!isBusiness.value && !mine && job.status !== 'draft' && (
          <button class="bookmark" aria-label={job.isSaved ? 'Remove from saved' : 'Save'} aria-pressed={job.isSaved} onClick={toggleSave}>
            <img src={icon(job.isSaved ? 'IconBookmarkFilled' : 'IconBookmarkSimple')} alt="" />
          </button>
        )}
        <button class={`view-btn ${applied || job.status === 'closed' ? 'is-dim' : ''}`} onClick={open}>
          {applied ? 'Applied' : job.status === 'closed' ? 'Closed' : 'View project'}<img src={icon('IconCaretRight')} alt="" />
        </button>
      </div>
    </article>
  );
}

const LANGS: Record<string, string> = { en: 'English', tr: 'Turkish', ru: 'Russian', uk: 'Ukrainian', id: 'Indonesian', es: 'Spanish', de: 'German', fr: 'French',
  it: 'Italian', pl: 'Polish', th: 'Thai', ar: 'Arabic', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', vi: 'Vietnamese', kk: 'Kazakh' };
const langName = (code: string) => LANGS[code.toLowerCase()] ?? code.toUpperCase();

function jobMenu(job: Job, actions: { onStatus?: (a: 'publish' | 'close') => void; onWithdraw?: () => void; onMessage?: () => void } = {}) {
  const mine = activeProfile.value?.id === job.ownerProfileId;
  openSheet((close) => (
    <SheetFrame title={job.title} close={close}>
      <button class="menu-item" onClick={async () => {
        close();
        const text = `${job.title} — ${job.owner?.displayName ?? ''} on kolaba.`;
        try { if (navigator.share) await navigator.share({ title: text, url: location.href }); else { await navigator.clipboard.writeText(text); showToast('Copied', 'ok'); } } catch { /* */ }
      }}><img src={icon('IconJobShare')} alt="" />Share</button>
      {mine && <button class="menu-item" onClick={() => { close(); push('job-editor', { job }); }}><img src={icon('IconJobEdit')} alt="" />Edit</button>}
      {mine && actions.onStatus && (job.status === 'published'
        ? <button class="menu-item" onClick={() => { close(); actions.onStatus!('close'); }}><img src={icon('IconLockKey')} alt="" />Close applications</button>
        : <button class="menu-item" onClick={() => { close(); actions.onStatus!('publish'); }}><img src={icon('IconLockKeyOpen')} alt="" />{job.status === 'draft' ? 'Publish' : 'Re-open'}</button>)}
      {!mine && actions.onMessage && <button class="menu-item" onClick={() => { close(); actions.onMessage!(); }}><img src={icon('IconChatText')} alt="" />Message {job.owner?.displayName}</button>}
      {!mine && actions.onWithdraw && <button class="menu-item is-danger" onClick={() => { close(); actions.onWithdraw!(); }}><img src={icon('IconXCircle')} alt="" />Withdraw application</button>}
      {!mine && <button class="menu-item is-danger" onClick={async () => {
        close();
        try { await post('/v1/reports', { targetType: 'job', targetId: job.id, reason: 'inappropriate' }); showToast('Reported — thank you', 'ok'); } catch (e) { showToast(errorText(e), 'error'); }
      }}><img src={icon('IconShieldWarning')} alt="" />Report</button>}
    </SheetFrame>
  ));
}

/** ProjectDetailsView: the 400 pt gallery (sideways only — never a full-screen viewer for its photos), the author row
 *  with the bookmark, title + price, Location · Languages, the description, Applicants for everyone (FIX 31), and
 *  the Apply bar (ProjectApplyBar): a 48 pt pink capsule, 22 pt in, 26 pt above the bottom — not for the owner or an
 *  applied creator (their actions are in •••); a business sees Switch account. */
export function JobScreen({ id }: { id: string }) {
  const { data: job, error, setData, reload } = useLoad<Job>((s) => get(`/v1/jobs/${id}`, s), [id, refreshTick.value]);
  const [scrolled, setScrolled] = useState(0);
  if (error) return <><Header left={<BackButton />} /><div class="section-top"><Empty title="Job not available" text={errorText(error)} /></div></>;
  if (!job) return <><Header left={<BackButton />} /><div class="jhero skeleton" style={{ borderRadius: 0 }} /><Spinner /></>;
  const me = activeProfile.value;
  const isOwner = me?.id === job.ownerProfileId;
  const ownBusiness = !isOwner && profiles.value.some((p) => p.id === job.ownerProfileId);
  const amount = price(job);
  const apply = () => openSheet((close) => <ApplySheet job={job} close={close} onDone={() => { close(); reload(); refresh(); }} />, true);
  const withdraw = () => confirmSheet('Withdraw application?', 'The business will no longer see it. You can apply again later.', 'Withdraw', async () => {
    try { await post(`/v1/jobs/applications/${job.myApplicationId}/withdraw`); showToast('Application withdrawn', 'ok'); reload(); refresh(); }
    catch (e) { showToast(errorText(e), 'error'); }
  }, true);
  const message = async () => {
    try { const { id: conversationId } = await post('/v1/conversations', { profileId: job.ownerProfileId, jobId: job.id }); push('conversation', { id: conversationId }); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const setStatus = async (action: 'publish' | 'close') => {
    try { setData(await post(`/v1/jobs/${job.id}/${action}`)); showToast(action === 'publish' ? 'Published' : 'Closed — no more applications', 'ok'); refresh(); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const save = async () => {
    const next = !job.isSaved;
    setData({ ...job, isSaved: next });
    try { next ? await put(`/v1/jobs/${job.id}/save`) : await del(`/v1/jobs/${job.id}/save`); refresh(); }
    catch (e) { setData({ ...job, isSaved: !next }); showToast(errorText(e), 'error'); }
  };
  const menu = () => jobMenu(job, { onStatus: isOwner ? setStatus : undefined, onWithdraw: job.myApplicationId ? withdraw : undefined, onMessage: !isOwner ? message : undefined });
  const bar = isOwner || (job.myApplicationId && !isBusiness.value) ? null
    : ownBusiness ? <button class="apply-btn is-white" onClick={() => offerRoleSwitch('manageJob')}>Switch account</button>
    : isBusiness.value ? <button class="apply-btn is-white" onClick={() => offerRoleSwitch('apply')}>Switch account</button>
    : <button class="apply-btn" disabled={!job.acceptsApplications} onClick={apply}>{job.acceptsApplications ? 'Apply now' : 'Applications closed'}
        {job.acceptsApplications && <img src={icon('IconCaretRight')} alt="" />}</button>;
  return (
    <>
      <div class="scroll" onScroll={(e) => setScrolled(e.currentTarget.scrollTop)}>
        <div class="jhero">
          {job.media.length ? <Gallery media={job.media} onOpen={(m) => { if (m.kind === 'video') openViewer(m); }} />
            : <div class="jhero__empty"><img src={icon('IconBriefcase')} alt="" /></div>}
          <div class="phero__shade" />
        </div>
        <div class="jbody" style={{ paddingBottom: bar ? 110 : 48 }}>
          <div class="row" style={{ gap: 10 }}>
            <button class="post__head" style={{ flex: 1 }} onClick={() => job.owner && push('profile-view', { id: job.owner.id })}>
              <Avatar card={job.owner} size={48} ring />
              <div class="grow">
                <div class="post__author"><span class="ellipsis">{job.owner?.displayName}</span><ProBadge card={job.owner} compact /></div>
                <div class="post__date">{postDate(job.publishedAt ?? job.createdAt)}</div>
              </div>
            </button>
            {job.status !== 'published' && <span class={`status-pill ${job.status}`}>{job.status}</span>}
            {!isOwner && !isBusiness.value && (
              <button class="bookmark" aria-label={job.isSaved ? 'Remove from saved' : 'Save'} aria-pressed={job.isSaved} onClick={save}>
                <img src={icon(job.isSaved ? 'IconBookmarkFilled' : 'IconBookmarkSimple')} alt="" /></button>
            )}
          </div>
          <div class="post__headline">
            <h1 class="post__title" style={{ margin: 0 }}>{job.title}</h1>
            {amount && <div class="post__price">{amount}<small>{priceCaption(job.compensationType)}</small></div>}
          </div>
          <div class="post__req" style={{ flexWrap: 'wrap', rowGap: 8 }}>
            <span>{job.flag && <span class="flag">{job.flag}</span>}{job.location}</span>
            {job.languages.length > 0 && <span><img src={icon('IconTranslate')} alt="" />{job.languages.map(langName).join(', ')}</span>}
          </div>
          <div class="post__desc selectable" style={{ whiteSpace: 'pre-line' }}>{job.description}</div>
          <div class="rdivider" />
          <Applicants job={job} isOwner={isOwner} />
        </div>
      </div>
      <Header left={<BackButton />} blurOpacity={Math.min(Math.max((scrolled - 260) / 120, 0), 1)}
        right={<GlassButton name="IconDotsThree" label="More" onClick={menu} />} />
      {bar && <div class="apply-bar">{bar}</div>}
    </>
  );
}

/** The applicants (Figma 706:2366): everyone sees them; the owner also shortlists and messages. */
function Applicants({ job, isOwner }: { job: Job; isOwner: boolean }) {
  const [sort, setSort] = useState<'newest' | 'oldest' | 'rating'>('newest');
  const { data, setData } = useLoad<{ items: Application[] }>((s) => get(`/v1/jobs/${job.id}/applications?sort=${sort}`, s), [job.id, sort, refreshTick.value]);
  return (
    <>
      <div class="rlist__head"><img src={icon('IconUser')} alt="" style={{ width: 16, height: 16, opacity: .5 }} /><span>Applicants</span>
        <span class="ptabs__count">{data ? data.items.length : job.applicationsCount}</span><span class="grow" />
        <SortButton onClick={() => pickSheet('Sort applicants', [['newest', 'Newest'], ['oldest', 'Oldest'], ['rating', 'Top rated']], sort, setSort)} /></div>
      {!data ? <Spinner /> : !data.items.length ? <Empty title="No applications yet." text="Applications appear here as creators apply." /> :
        data.items.map((a) => <ApplicantCard a={a} job={job} isOwner={isOwner} key={a.id} onShortlist={(v) => setData({ items: data.items.map((x) => (x.id === a.id ? { ...x, isShortlisted: v } : x)) })} />)}
    </>
  );
}

function ApplicantCard({ a, job, isOwner, onShortlist }: { a: Application; job: Job; isOwner: boolean; onShortlist: (v: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const toggle = async () => {
    const next = !a.isShortlisted;
    onShortlist(next);
    try { await put(`/v1/jobs/applications/${a.id}/shortlist`, { shortlisted: next }); } catch (e) { onShortlist(!next); showToast(errorText(e), 'error'); }
  };
  const message = async () => {
    try { const { id } = await post('/v1/conversations', { profileId: a.applicant!.id, jobId: job.id }); push('conversation', { id }); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  return (
    <div class="applicant">
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <Avatar card={a.applicant} size={48} ring />
        <div class="grow" style={{ minWidth: 0 }}>
          <div class="row" style={{ gap: 8 }}><span class="rcard__name ellipsis">{a.applicant?.displayName}</span><ProBadge card={a.applicant} compact />
            <span class="muted" style={{ fontSize: 12 }}>{timeAgo(a.createdAt)} ago</span></div>
          <div class="post__date" style={{ fontSize: 14 }}>{a.applicant?.location ? `${a.applicant.flag ?? ''} ${a.applicant.location}` : `@${a.applicant?.username}`}</div>
        </div>
        {isOwner && <button class="bookmark" style={{ marginTop: -10, marginRight: -10 }} aria-label={a.isShortlisted ? 'Remove from shortlist' : 'Shortlist'} aria-pressed={a.isShortlisted} onClick={toggle}>
          <img src={icon(a.isShortlisted ? 'IconBookmarkFilled' : 'IconBookmarkSimple')} alt="" /></button>}
      </div>
      <div class={`post__desc selectable ${open ? '' : 'lines-4'}`}>{a.message}</div>
      {a.message.length > 160 && <button class="show-more" style={{ alignSelf: 'flex-start', marginTop: -8 }} onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</button>}
      {a.media.length > 0 && <div class="applicant__media" data-hscroll>{a.media.map((m) => <MediaTile media={m} />)}</div>}
      <div class="row" style={{ gap: 8 }}>
        {isOwner && <button class="btn is-small" style={{ flex: 1 }} onClick={message}><img class="btn__icon" src={icon('IconChatTeardropText')} alt="" />Message</button>}
        <button class="btn is-small is-outline" style={{ flex: 1 }} onClick={() => a.applicant && push('profile-view', { id: a.applicant.id })}>View profile<img src={icon('IconCaretRight')} alt="" style={{ width: 14, height: 14 }} /></button>
      </div>
    </div>
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
      <div class="muted" style={{ fontSize: 14, margin: '0 8px 12px' }}>{job.title} · {job.owner?.displayName}</div>
      <textarea class="textarea" maxLength={2000} placeholder="Message to the business: why you, ideas, dates…" value={message} onInput={(e) => setMessage(e.currentTarget.value)} />
      <span class="label" style={{ marginTop: 18 }}>Attach from portfolio {ent?.canAttachMediaToApplications ? `· ${selected.length}/10` : '· creator.pro'}</span>
      {ent?.canAttachMediaToApplications ? (
        <div class="mgrid" style={{ padding: 0, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {(portfolio.data?.items ?? []).slice(0, 12).map((m: any) => (
            <MediaTile media={m} picked={selected.includes(m.id)} onOpen={() => setSelected((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id].slice(0, 10)))} />
          ))}
        </div>
      ) : <div class="locked" style={{ margin: 0 }}><b>Attach media with creator.pro</b>Free applications are text-only.</div>}
      <button class="btn is-accent" style={{ marginTop: 18 }} disabled={busy || !message.trim()} onClick={send}>{busy ? 'Sending…' : 'Send application'}</button>
    </SheetFrame>
  );
}

export function ApplicantsScreen({ job }: { job: Job }) {
  const [sort, setSort] = useState('newest');
  const [shortlisted, setShortlisted] = useState(false);
  const { data, setData } = useLoad<{ items: Application[] }>((s) => get(`/v1/jobs/${job.id}/applications?sort=${sort}&shortlisted=${shortlisted ? 1 : 0}`, s),
    [job.id, sort, shortlisted, refreshTick.value]);
  const toggle = async (a: Application) => {
    try { await put(`/v1/jobs/applications/${a.id}/shortlist`, { shortlisted: !a.isShortlisted }); setData({ items: data!.items.map((x) => (x.id === a.id ? { ...x, isShortlisted: !x.isShortlisted } : x)) }); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const message = async (a: Application) => {
    try { const { id } = await post('/v1/conversations', { profileId: a.applicant!.id, jobId: job.id }); push('conversation', { id }); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  return (
    <>
      <div class="scroll">
        <div class="section-top" />
        <div class="mfilter" style={{ paddingTop: 0 }}>
          {[['newest', 'Newest'], ['oldest', 'Oldest'], ['rating', 'Top rated']].map(([v, l]) => <button class={`mchip ${sort === v ? 'is-on' : ''}`} onClick={() => setSort(v)}>{l}</button>)}
          <span class="grow" />
          <button class={`mchip ${shortlisted ? 'is-on' : ''}`} onClick={() => setShortlisted(!shortlisted)}>♥</button>
        </div>
        <div class="pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!data ? <Spinner /> : !data.items.length ? <Empty title="No applicants yet" text="Applications appear here as creators apply." iconName="IconUser" /> :
            data.items.map((a) => (
              <div class="applicant" key={a.id}>
                <div class="row">
                  <button class="row grow" style={{ gap: 16 }} onClick={() => a.applicant && push('profile-view', { id: a.applicant.id })}>
                    <Avatar card={a.applicant} size={48} />
                    <div class="grow"><div class="row" style={{ gap: 8, fontWeight: 600 }}><span class="ellipsis">{a.applicant?.displayName}</span><ProBadge card={a.applicant} compact /></div>
                      <RatingInline rating={a.applicant?.rating ?? null} count={a.applicant?.reviewsCount ?? 0} /></div>
                  </button>
                  <span class="muted" style={{ fontSize: 12 }}>{timeAgo(a.createdAt)}</span>
                </div>
                <div class="post__desc selectable lines-4">{a.message}</div>
                {a.media.length > 0 && <div class="applicant__media" data-hscroll>{a.media.map((m) => <button onClick={() => openViewer(m)}><img src={(m.kind === 'video' ? m.posterUrl : m.url) ?? ''} alt="" /></button>)}</div>}
                <div class="row" style={{ gap: 8 }}>
                  <button class="btn is-small is-milky" style={{ flex: 1 }} onClick={() => toggle(a)}>{a.isShortlisted ? '♥ Shortlisted' : '♡ Shortlist'}</button>
                  <button class="btn is-small" style={{ flex: 1 }} onClick={() => message(a)}>Message</button>
                </div>
              </div>
            ))}
        </div>
        <div style={{ height: 40 }} />
      </div>
      <Header left={<BackButton />} center={<HeaderTitle title="Applicants" sub={job.title} />} />
    </>
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
      showToast(publish ? 'Job published' : 'Saved', 'ok'); refresh(); back();
    } catch (e) { showToast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const remove = () => confirmSheet('Delete job?', 'It disappears with its applications. This can\'t be undone.', 'Delete', async () => {
    try { await del(`/v1/jobs/${job!.id}`); refresh(); back(false); back(false); } catch (e) { showToast(errorText(e), 'error'); }
  }, true);
  const chip = (on: boolean, label: string, onClick: () => void) => <button class={`mchip ${on ? 'is-on' : ''}`} style={{ background: on ? '#fff' : 'var(--input)' }} onClick={onClick}>{label}</button>;
  const input = (label: string, value: string, set: (v: string) => void, extra: any = {}) => (
    <div class="grow"><span class="label">{label}</span><label class="field"><input value={value} onInput={(e) => set(e.currentTarget.value)} {...extra} /></label></div>
  );
  return (
    <>
      <div class="scroll">
        <div class="section-top pad" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 140 }}>
          {input('Title', title, setTitle, { maxLength: 100 })}
          <div><span class="label">Details</span><textarea class="textarea" maxLength={2000} value={description} onInput={(e) => setDescription(e.currentTarget.value)} /></div>
          <div><span class="label">Location</span><div class="row" style={{ gap: 8 }}>{chip(worldwide, 'Worldwide', () => setWorldwide(true))}{chip(!worldwide, 'Specific place', () => setWorldwide(false))}</div></div>
          {!worldwide && <div class="row">{input('City', city, setCity)}{input('Shown as', location, setLocation, { placeholder: 'Bali, Indonesia' })}</div>}
          <div><span class="label">Compensation</span><div class="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {(['fixed', 'range', 'barter', 'not_selected'] as const).map((c) => chip(comp === c, { fixed: 'Fixed price', range: 'Budget range', barter: 'Barter', not_selected: 'Not set' }[c], () => setComp(c)))}
          </div></div>
          {['fixed', 'range'].includes(comp) && (
            <div class="row">
              {input(comp === 'range' ? 'From' : 'Amount', min, (v) => setMin(v.replace(/[^\d.]/g, '')), { inputMode: 'decimal' })}
              {comp === 'range' && input('To', max, (v) => setMax(v.replace(/[^\d.]/g, '')), { inputMode: 'decimal' })}
              <div style={{ width: 100 }}><span class="label">Currency</span>
                <button class="field" style={{ width: '100%', justifyContent: 'space-between', paddingRight: 16 }}
                  onClick={() => pickSheet('Currency', ['USD', 'EUR', 'GBP', 'UAH', 'PLN', 'AED', 'THB', 'KZT', 'IDR', 'TRY'].map((c) => [c, c] as [string, string]), currency, setCurrency)}>
                  {currency}<Icon name="IconCaretDown" size={14} /></button></div>
            </div>
          )}
          {job && <button class="btn is-danger" onClick={remove}><img class="btn__icon" src={icon('IconTrash')} alt="" />Delete job</button>}
        </div>
      </div>
      <Header left={<BackButton />} center={<HeaderTitle title={job ? 'Edit job' : 'New job'} />} />
      <div class="apply-bar glass">
        {(!job || job.status === 'draft') && <button class="btn is-milky" disabled={busy || !title.trim()} onClick={() => save(false)}>Save draft</button>}
        <button class="btn is-accent" disabled={busy || !title.trim()} onClick={() => save(!job || job.status !== 'closed')}>{job && job.status === 'published' ? 'Save' : 'Publish'}</button>
      </div>
    </>
  );
}

export { Icon };
