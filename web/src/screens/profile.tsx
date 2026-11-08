// My Profile and public profiles; portfolio, collections, reviews; edit; settings & profile switching; reviews flow.
import { useRef, useState } from 'preact/hooks';
import { Card, del, errorText, get, Job, Media, patch, post, posterFrom, ProfilePage, Review, uploadFile } from '../api';
import { activeProfile, back, openSheet, profiles, push, refresh, refreshTick, reloadSession, setActiveProfile, showToast, signOut, user } from '../state';
import { Avatar, confirmSheet, DemoTag, Empty, fmtCount, gradientFor, Icon, initials, MediaTile, openViewer, ProBadge, SheetFrame, Spinner, Stars,
  timeAgo, TopBar, useLoad } from '../ui';
import { JobCard } from './jobs';
import { CreateProfile, Legal } from './auth';

type PTab = 'portfolio' | 'collections' | 'reviews' | 'jobs' | 'about';

export function ProfileScreen({ id, tab: initialTab }: { id?: string; tab?: PTab }) {
  const profileId = id ?? activeProfile.value?.id;
  const { data: p, error, reload } = useLoad<ProfilePage>((s) => get(`/v1/profiles/${profileId}`, s), [profileId, refreshTick.value]);
  const own = !id || p?.isOwner;
  const [tab, setTab] = useState<PTab>(initialTab ?? 'portfolio');
  const viewed = useRef(false);
  if (p && !own && !viewed.current) { viewed.current = true; post(`/v1/profiles/${p.id}/view`).catch(() => {}); }
  if (error) return <><TopBar title="Profile" onBack={id ? undefined : false} /><div class="below-topbar"><Empty title="Profile not available" text={errorText(error)} /></div></>;
  if (!p) return <><TopBar title="" onBack={id ? undefined : false} /><div class="below-topbar"><Spinner /></div></>;
  const business = p.type === 'business';
  const tabs: [PTab, string][] = business ? [['jobs', 'Job posts'], ['about', 'About'], ['reviews', 'Reviews']] : [['portfolio', 'Portfolio'], ['collections', 'Collections'], ['reviews', 'Reviews']];
  const current = tabs.some(([t]) => t === tab) ? tab : tabs[0][0];
  return (
    <>
      <header class="topbar">
        {id && !own ? <button class="glass-btn" aria-label="Back" onClick={back}><Icon name="IconArrowLeft" /></button>
          : id ? <button class="glass-btn" aria-label="Back" onClick={back}><Icon name="IconArrowLeft" /></button> : <span class="topbar__spacer" />}
        <span class="grow" />
        {own ? (
          <>
            <button class="glass-btn" aria-label="Request a review" onClick={() => openRequestReview()}><Icon name="IconStarRating" /></button>
            <button class="glass-btn" aria-label="Settings" onClick={() => push('settings')}><Icon name="IconGear" /></button>
          </>
        ) : <button class="glass-btn" aria-label="More" onClick={() => profileMenu(p)}><Icon name="IconDotsThree" /></button>}
      </header>
      <div class="scroll">
        <div class="profile-hero">
          <div class="monogram" style={{ background: gradientFor(p.displayName) }}>{initials(p.displayName)}</div>
          {p.avatarUrl && <img src={p.avatarUrl} alt="" style={{ position: 'relative' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
        </div>
        <div class={`glow ${business ? 'is-business' : ''}`} />
        <div class="profile-info">
          <div class="profile-name">{p.displayName} <ProBadge card={p} /><DemoTag card={p} /></div>
          <div class="profile-meta">
            <span>@{p.username}</span>
            {p.location && <span>{p.flag} {p.location}</span>}
            {p.category && <span>{p.category}</span>}
          </div>
          <div class="row" style={{ marginTop: 10, gap: 8 }}>
            {p.ratings?.count ? <><Stars value={p.ratings.rating!} size={15} /><b>{p.ratings.rating!.toFixed(1)}</b><span class="muted">· {p.ratings.count} reviews</span></>
              : <span class="muted" style={{ fontSize: 13 }}>No reviews yet</span>}
          </div>
          <div class="figures">
            {business ? <div class="figure"><b>{p.counts?.jobs ?? 0}</b><span>Jobs</span></div> : <div class="figure"><b>{p.counts?.portfolio ?? 0}</b><span>Portfolio</span></div>}
            <div class="figure"><b>{p.counts?.contacts ?? 0}</b><span>Contacts</span></div>
            <div class="figure"><b>{fmtCount(p.counts?.likes ?? 0)}</b><span>Likes</span></div>
            {p.socialAccounts[0] && <div class="figure"><b>{fmtCount(p.socialAccounts.reduce((s, a) => s + a.followers, 0))}</b><span>Followers</span></div>}
          </div>
          {p.bio && <div class="profile-bio selectable">{p.bio}</div>}
          {p.links.length > 0 && (
            <div class="links">{p.links.map((l) => (
              <a class="link-chip" href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                <img src={`${import.meta.env.BASE_URL}icons/${{ instagram: 'IconInstagram', tiktok: 'IconTikTok', youtube: 'IconYouTube', telegram: 'IconTelegram', whatsapp: 'IconWhatsApp', email: 'ContactEmail' }[l.kind] ?? 'IconGlobe'}.svg`} alt="" />
                {l.kind === 'website' ? new URL(l.url).hostname : l.kind}
              </a>
            ))}</div>
          )}
          {own ? (
            <div class="profile-actions">
              <button class="btn secondary" onClick={() => push('profile-edit')}>Edit profile</button>
              {!business && <UploadButton purpose="portfolio" label="Upload" onDone={reload} />}
              {business && <button class="btn accent" onClick={() => push('job-editor', {}, 'jobs')}>New job</button>}
            </div>
          ) : <VisitorActions profile={p} onChange={reload} />}
        </div>
        {p.introVideo && (
          <div class="pad" style={{ margin: '4px 0 16px' }}>
            <div class="section-title" style={{ margin: '0 0 8px' }}>Intro video</div>
            <video src={p.introVideo.url ?? undefined} poster={p.introVideo.posterUrl ?? undefined} controls playsInline preload="none"
              style={{ width: '100%', borderRadius: 18, maxHeight: 420, background: '#000' }} />
          </div>
        )}
        <nav class="seg sticky">
          {tabs.map(([t, label]) => <button class={`seg__tab ${current === t ? 'is-active' : ''}`} onClick={() => setTab(t)}>{label}{t === 'reviews' && p.ratings?.count ? <span class="seg__count">{p.ratings.count}</span> : null}</button>)}
        </nav>
        <div style={{ paddingTop: 12 }}>
          {current === 'portfolio' && <Portfolio profile={p} own={!!own} />}
          {current === 'collections' && <Collections profile={p} own={!!own} />}
          {current === 'reviews' && <Reviews profile={p} own={!!own} />}
          {current === 'jobs' && <ProfileJobs profile={p} own={!!own} />}
          {current === 'about' && (
            <div class="pad">
              <p class="profile-bio selectable">{p.bio || 'No description yet.'}</p>
              {p.website && <p><a class="link-chip" href={p.website} target="_blank" rel="noopener noreferrer nofollow">🌐 {new URL(p.website).hostname}</a></p>}
              {p.languages.length > 0 && <div class="chips">{p.languages.map((l) => <span class="chip">{l.toUpperCase()}</span>)}</div>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function profileMenu(p: ProfilePage) {
  openSheet((close) => (
    <SheetFrame title={p.displayName} close={close}>
      <button class="menu-item is-danger" onClick={async () => {
        close();
        try { await post('/v1/reports', { targetType: 'profile', targetId: p.id, reason: 'inappropriate' }); showToast('Reported — our team will review it', 'ok'); }
        catch (e) { showToast(errorText(e), 'error'); }
      }}><img src={`${import.meta.env.BASE_URL}icons/IconShieldWarning.svg`} alt="" />Report profile</button>
    </SheetFrame>
  ));
}

function VisitorActions({ profile, onChange }: { profile: ProfilePage; onChange: () => void }) {
  const { data: rel, reload } = useLoad<{ relation: string; requestId: string | null }>((s) => get(`/v1/contacts/relation/${profile.id}`, s), [profile.id, activeProfile.value?.id]);
  const contact = async () => {
    try {
      if (rel?.relation === 'none') await post('/v1/contacts/requests', { profileId: profile.id });
      else if (rel?.relation === 'incoming') await post(`/v1/contacts/requests/${rel.requestId}/accept`);
      else if (rel?.relation === 'requested') await post(`/v1/contacts/requests/${rel.requestId}/cancel`);
      else if (rel?.relation === 'connected') return confirmSheet('Remove contact?', `${profile.displayName} will no longer be in your contacts.`, 'Remove', async () => {
        await del(`/v1/contacts/${profile.id}`); reload(); onChange(); refresh();
      }, true);
      reload(); onChange(); refresh();
    } catch (e) { showToast(errorText(e), 'error'); }
  };
  const message = async () => {
    try { const { id } = await post('/v1/conversations', { profileId: profile.id }); push('conversation', { id }); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const label = { none: 'Add contact', requested: 'Requested', incoming: 'Accept', connected: 'Connected ✓', unavailable: 'Your profile' }[rel?.relation ?? 'none'];
  return (
    <div class="profile-actions">
      <button class={`btn ${rel?.relation === 'none' || rel?.relation === 'incoming' ? 'accent' : 'secondary'}`} disabled={!rel || rel.relation === 'unavailable'} onClick={contact}>{label}</button>
      <button class="btn secondary" disabled={rel?.relation === 'unavailable'} onClick={message}>Message</button>
      {rel?.relation === 'connected' && <button class="btn secondary" onClick={() => push('review-form', { recipient: profile })}>Review</button>}
    </div>
  );
}

function UploadButton({ purpose, label, onDone, accept = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime' }: { purpose: string; label: string; onDone: () => void; accept?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const upload = async (file: File) => {
    setProgress(0);
    try {
      let posterMediaId: string | undefined;
      if (file.type.startsWith('video/')) {
        const poster = await posterFrom(file);
        if (poster) posterMediaId = (await uploadFile(poster, 'poster')).id;
      }
      await uploadFile(file, purpose, posterMediaId ? { posterMediaId } : {}, (f) => setProgress(f));
      showToast('Uploaded', 'ok'); onDone(); refresh();
    } catch (e) { showToast(errorText(e), 'error'); } finally { setProgress(null); }
  };
  return (
    <>
      <button class="btn accent" disabled={progress !== null} onClick={() => input.current?.click()}>{progress !== null ? `${Math.round(progress * 100)}%` : label}</button>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void upload(f); e.currentTarget.value = ''; }} />
    </>
  );
}

function Portfolio({ profile, own }: { profile: ProfilePage; own: boolean }) {
  const { data, reload } = useLoad<{ items: Media[] }>((s) => get(`/v1/profiles/${profile.id}/media?purpose=portfolio`, s), [profile.id, refreshTick.value]);
  if (!data) return <Spinner />;
  if (!data.items.length) return <Empty title={own ? 'Your portfolio is empty' : 'No portfolio yet'} text={own ? 'Upload photos and videos of your best work.' : undefined} iconName="IconImages" />;
  const openOwn = (m: Media) => openSheet((close) => (
    <div class="viewer">
      {m.kind === 'video' ? <video src={m.url ?? undefined} poster={m.posterUrl ?? undefined} controls autoPlay playsInline /> : <img src={m.url ?? ''} alt="" />}
      <button class="glass-btn" aria-label="Close" onClick={close}><Icon name="IconSheetClose" size={16} /></button>
      <button class="glass-btn" style={{ left: 'auto', right: 'var(--gutter)' }} aria-label="Delete" onClick={() => confirmSheet('Delete this?', 'It disappears from your profile and collections.', 'Delete', async () => {
        try { await del(`/v1/media/${m.id}`); close(); reload(); refresh(); showToast('Deleted', 'ok'); } catch (e) { showToast(errorText(e), 'error'); }
      }, true)}><Icon name="IconTrash" /></button>
    </div>
  ));
  return <div class="media-grid">{data.items.map((m) => <MediaTile media={m} key={m.id} onOpen={own ? () => openOwn(m) : undefined} />)}</div>;
}

function Collections({ profile, own }: { profile: ProfilePage; own: boolean }) {
  const { data, reload } = useLoad<{ items: { id: string; title: string; itemsCount: number; cover: Media | null }[] }>(
    (s) => get(`/v1/profiles/${profile.id}/collections`, s), [profile.id, refreshTick.value]);
  const locked = own && profile.entitlements?.collections === 'locked';
  const create = () => openSheet((close) => <NewCollection close={close} onDone={() => { close(); reload(); }} />);
  if (!data) return <Spinner />;
  return (
    <>
      {locked && <div class="locked-card"><b>Collections are part of creator.pro</b>
        <div class="soft" style={{ fontSize: 13, marginTop: 4 }}>Group your work into folders for brands. Test environment: PRO is a test entitlement — no payments.</div></div>}
      {!data.items.length && !own ? <Empty title="No collections yet" iconName="IconFolderSimpleDashed" /> : (
        <div class="folders">
          {own && !locked && (
            <button class="folder" onClick={create}><div class="folder__cover tile-add" style={{ display: 'grid' }}><Icon name="IconPlus" /></div>
              <div class="folder__title">New folder</div></button>
          )}
          {data.items.map((col) => (
            <button class="folder" key={col.id} onClick={() => push('collection', { id: col.id, own })}>
              <div class="folder__cover">{col.cover ? <img src={(col.cover.kind === 'video' ? col.cover.posterUrl : col.cover.url) ?? ''} alt="" loading="lazy" /> : null}</div>
              <div class="folder__title ellipsis">{col.title}</div>
              <div class="folder__count">{col.itemsCount} {col.itemsCount === 1 ? 'item' : 'items'}</div>
            </button>
          ))}
        </div>
      )}
      {!data.items.length && own && !locked && <Empty title="No collections yet" text="Create a folder and add your portfolio to it." iconName="IconFolderSimpleDashed" />}
    </>
  );
}

function NewCollection({ close, onDone }: { close: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const save = async () => {
    try { await post('/v1/media/collections', { title }); showToast('Folder created', 'ok'); onDone(); } catch (e) { showToast(errorText(e), 'error'); }
  };
  return (
    <SheetFrame title="New folder" close={close}>
      <input class="input" maxLength={40} placeholder="Folder name" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
      <button class="btn accent" style={{ marginTop: 14 }} disabled={!title.trim()} onClick={save}>Create</button>
    </SheetFrame>
  );
}

export function CollectionScreen({ id, own }: { id: string; own: boolean }) {
  const { data, reload } = useLoad<{ collection: any; items: Media[] }>((s) => get(`/v1/media/collections/${id}/items`, s), [id, refreshTick.value]);
  const edit = () => openSheet((close) => <PickMedia close={close} selected={data!.items.map((m) => m.id)} onSave={async (ids) => {
    try { await fetchPut(`/v1/media/collections/${id}/items`, { mediaIds: ids }); close(); reload(); refresh(); } catch (e) { showToast(errorText(e), 'error'); }
  }} />, true);
  const remove = () => confirmSheet('Delete folder?', 'Its photos and videos stay in your portfolio.', 'Delete folder', async () => {
    try { await del(`/v1/media/collections/${id}`); refresh(); back(); } catch (e) { showToast(errorText(e), 'error'); }
  }, true);
  return (
    <>
      <TopBar title={data?.collection.title ?? ''}>
        {own ? <button class="glass-btn" aria-label="Edit" onClick={() => openSheet((close) => (
          <SheetFrame title="Folder" close={close}>
            <button class="menu-item" onClick={() => { close(); edit(); }}>Choose items</button>
            <button class="menu-item is-danger" onClick={() => { close(); remove(); }}>Delete folder</button>
          </SheetFrame>))}><Icon name="IconDotsThree" /></button> : <span class="topbar__spacer" />}
      </TopBar>
      <div class="scroll">
        <div class="below-topbar" />
        {!data ? <Spinner /> : !data.items.length ? <Empty title="This folder is empty" text={own ? 'Add photos and videos from your portfolio.' : undefined}>
          {own && <button class="btn small accent" onClick={edit}>Add items</button>}</Empty> :
          <div class="media-grid">{data.items.map((m) => <MediaTile media={m} key={m.id} />)}</div>}
      </div>
    </>
  );
}

const fetchPut = (path: string, body: unknown) => import('../api').then((a) => a.put(path, body));

function PickMedia({ close, selected, onSave }: { close: () => void; selected: string[]; onSave: (ids: string[]) => void }) {
  const [ids, setIds] = useState<string[]>(selected);
  const { data } = useLoad<{ items: Media[] }>((s) => get(`/v1/profiles/${activeProfile.value!.id}/media?purpose=portfolio`, s), []);
  return (
    <SheetFrame title="Choose items" close={close}>
      {!data ? <Spinner /> : (
        <div class="media-grid">{data.items.map((m) => (
          <button class="media-tile" style={{ outline: ids.includes(m.id) ? '3px solid var(--accent)' : 'none', outlineOffset: -3 }}
            onClick={() => setIds((x) => (x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id]))}>
            <img src={(m.kind === 'video' ? m.posterUrl : m.url) ?? ''} alt="" loading="lazy" />
          </button>
        ))}</div>
      )}
      <button class="btn accent" style={{ marginTop: 16 }} onClick={() => onSave(ids)}>Save ({ids.length})</button>
    </SheetFrame>
  );
}

function ProfileJobs({ profile, own }: { profile: ProfilePage; own: boolean }) {
  const { data } = useLoad<{ items: Job[] }>((s) => get(`/v1/profiles/${profile.id}/jobs`, s), [profile.id, refreshTick.value]);
  if (!data) return <Spinner />;
  if (profile.hideJobPosts && !own) return <Empty title="Job posts are hidden" iconName="IconBriefcase" />;
  if (!data.items.length) return <Empty title="No job posts" iconName="IconBriefcase" />;
  return <>{data.items.map((j) => <JobCard job={j} key={j.id} />)}</>;
}

function Reviews({ profile, own }: { profile: ProfilePage; own: boolean }) {
  const [sort, setSort] = useState('newest');
  const { data } = useLoad<{ summary: any; items: Review[] }>((s) => get(`/v1/reviews?profileId=${profile.id}&sort=${sort}`, s), [profile.id, sort, refreshTick.value]);
  if (!data) return <Spinner />;
  const s = data.summary;
  return (
    <>
      {s?.count ? (
        <div class="rating-summary">
          <div class="center"><div class="rating-big">{s.rating.toFixed(1)}</div><Stars value={s.rating} /><div class="muted" style={{ fontSize: 12, marginTop: 4 }}>{s.count} reviews</div></div>
          <div class="bars">{(['quality', 'speed', 'contact'] as const).map((k) => (
            <div class="bar-row"><span style={{ textTransform: 'capitalize' }}>{k}</span><div class="bar"><i style={{ width: `${(s[k] / 5) * 100}%` }} /></div><b>{s[k].toFixed(1)}</b></div>
          ))}</div>
        </div>
      ) : null}
      {own && <div class="pad" style={{ marginBottom: 12 }}><button class="btn secondary" onClick={() => openRequestReview()}>Request a review</button></div>}
      {data.items.length > 1 && (
        <div class="pad chips" style={{ marginBottom: 12 }}>
          {[['newest', 'Newest'], ['oldest', 'Oldest'], ['highest', 'Highest'], ['lowest', 'Lowest']].map(([v, l]) => (
            <button class={`chip ${sort === v ? 'is-on' : ''}`} onClick={() => setSort(v)}>{l}</button>
          ))}
        </div>
      )}
      {!data.items.length ? <Empty title="No reviews yet" text={own ? 'Ask your contacts for a review.' : 'Reviews come from confirmed contacts.'} iconName="IconStarRating" /> :
        data.items.map((r) => (
          <div class="review" key={r.id}>
            <button class="row" style={{ textAlign: 'left', width: '100%' }} onClick={() => r.author && push('profile-view', { id: r.author.id })}>
              <Avatar card={r.author} size={38} />
              <div class="grow"><div style={{ fontWeight: 600, fontSize: 14 }}>{r.author?.displayName}</div><div class="muted" style={{ fontSize: 12 }}>{timeAgo(r.createdAt)}</div></div>
              <Stars value={r.rating} /><b style={{ fontSize: 13 }}>{r.rating.toFixed(1)}</b>
            </button>
            <div class="review__text selectable">{r.comment}</div>
          </div>
        ))}
    </>
  );
}

// ─── Request a Review sheet ───

export function openRequestReview() {
  openSheet((close) => <RequestReview close={close} />, true);
}

function RequestReview({ close }: { close: () => void }) {
  const [query, setQuery] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const { data, setData } = useLoad<{ items: { profile: Card; state: string; requestId: string | null }[] }>((s) => get('/v1/reviews/requests/sheet', s), []);
  const request = async (card: Card) => {
    setData({ items: data!.items.map((i) => (i.profile.id === card.id ? { ...i, state: 'requested' } : i)) });
    try { await post('/v1/reviews/requests', { contactProfileId: card.id }); setSent(card.displayName); }
    catch (e) { setData({ items: data!.items.map((i) => (i.profile.id === card.id ? { ...i, state: 'available' } : i)) }); showToast(errorText(e), 'error'); }
  };
  const invite = async () => {
    try {
      const { url } = await post('/v1/reviews/invites');
      openSheet((c2) => <InviteLink url={url} close={c2} />);
    } catch (e) { showToast(errorText(e), 'error'); }
  };
  const items = (data?.items ?? []).filter((i) => !query || i.profile.displayName.toLowerCase().includes(query.toLowerCase()));
  return (
    <SheetFrame title="Request a review" close={close}>
      {sent && <div class="notice" style={{ marginTop: 0, marginBottom: 12, color: '#fff' }}>✓ Request sent to {sent}. They'll see it in their notifications.</div>}
      <label class="search" style={{ marginBottom: 12 }}><img src={`${import.meta.env.BASE_URL}icons/IconMagnifyingGlass.svg`} alt="" />
        <input placeholder="Search contacts" value={query} onInput={(e) => setQuery(e.currentTarget.value)} /></label>
      {!data ? <Spinner /> : !items.length ? <Empty title="No contacts yet" text="Reviews come from confirmed contacts. Invite someone new below." iconName="IconUserPlus" /> :
        items.map((i) => (
          <div class="list-row" style={{ padding: '10px 0' }} key={i.profile.id}>
            <Avatar card={i.profile} size={42} />
            <div class="grow"><div class="list-row__title ellipsis">{i.profile.displayName}</div><div class="list-row__sub">{i.profile.location}</div></div>
            {i.state === 'available' ? <button class="btn small accent" onClick={() => request(i.profile)}>Request</button>
              : <span class="btn small secondary" aria-disabled="true">{i.state === 'requested' ? 'Requested' : 'Reviewed'}</span>}
          </div>
        ))}
      <button class="btn secondary" style={{ marginTop: 16 }} onClick={invite}>Invite someone new</button>
    </SheetFrame>
  );
}

function InviteLink({ url, close }: { url: string; close: () => void }) {
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Review me on kolaba.', url });
      else { await navigator.clipboard.writeText(url); showToast('Link copied', 'ok'); }
    } catch { /* cancelled */ }
  };
  return (
    <SheetFrame title="Invite link" close={close}>
      <p class="soft" style={{ fontSize: 14, lineHeight: 1.45, marginTop: 0 }}>Send this one-time link to someone outside kolaba. They sign up, become your contact and can leave one review. It expires in 14 days.</p>
      <div class="input selectable" style={{ display: 'flex', alignItems: 'center', fontSize: 13, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{url}</div>
      <button class="btn accent" style={{ marginTop: 14 }} onClick={share}>Send link</button>
    </SheetFrame>
  );
}

export function ReviewForm({ recipient, requestId, inviteId }: { recipient: Card; requestId?: string; inviteId?: string }) {
  const [scores, setScores] = useState({ quality: 0, speed: 0, contact: 0 });
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const complete = scores.quality && scores.speed && scores.contact && comment.trim();
  const overall = complete ? (scores.quality + scores.speed + scores.contact) / 3 : null;
  const submit = async () => {
    setBusy(true);
    try {
      await post('/v1/reviews', { recipientProfileId: recipient.id, ...scores, comment, requestId, inviteId });
      showToast('Review published', 'ok'); refresh(); back();
    } catch (e) { showToast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <TopBar title="Write a review" />
      <div class="scroll no-tabbar">
        <div class="below-topbar" />
        <div class="pad">
          <div class="row" style={{ marginBottom: 18 }}><Avatar card={recipient} size={48} /><div><div style={{ fontWeight: 700 }}>{recipient.displayName}</div><div class="muted" style={{ fontSize: 13 }}>{recipient.location}</div></div></div>
          {(['quality', 'speed', 'contact'] as const).map((k) => (
            <div style={{ marginBottom: 16 }}>
              <div class="field__label" style={{ textTransform: 'capitalize' }}>{k}</div>
              <div class="score-picker">{[1, 2, 3, 4, 5].map((n) => <button class={scores[k] === n ? 'is-on' : ''} onClick={() => setScores({ ...scores, [k]: n })}>{n}</button>)}</div>
            </div>
          ))}
          <textarea class="textarea" maxLength={2000} placeholder="How was it to work together?" value={comment} onInput={(e) => setComment(e.currentTarget.value)} />
          {overall && <div class="muted" style={{ margin: '10px 4px' }}>Overall: <b style={{ color: '#fff' }}>{overall.toFixed(1)}</b></div>}
          <button class="btn accent" style={{ marginTop: 14 }} disabled={busy || !complete} onClick={submit}>Publish review</button>
        </div>
      </div>
    </>
  );
}

// ─── Edit profile ───

export function EditProfileScreen() {
  const { data: p } = useLoad<ProfilePage>((s) => get(`/v1/profiles/${activeProfile.value!.id}`, s), [activeProfile.value?.id]);
  if (!p) return <><TopBar title="Edit profile" /><div class="below-topbar"><Spinner /></div></>;
  return <EditForm p={p} />;
}

function EditForm({ p }: { p: ProfilePage }) {
  const [form, setForm] = useState({ displayName: p.displayName, username: p.username, bio: p.bio, city: p.city ?? '', country: p.country ?? '',
    category: p.category ?? '', website: p.website ?? '', instagram: p.links.find((l) => l.kind === 'instagram')?.url ?? '',
    tiktok: p.links.find((l) => l.kind === 'tiktok')?.url ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: any) => setForm({ ...form, [k]: e.currentTarget.value });
  const avatarInput = useRef<HTMLInputElement>(null);
  const introInput = useRef<HTMLInputElement>(null);
  const save = async () => {
    setBusy(true);
    try {
      const links: Record<string, string> = {};
      if (form.website) links.website = form.website;
      if (form.instagram) links.instagram = form.instagram;
      if (form.tiktok) links.tiktok = form.tiktok;
      await patch(`/v1/profiles/${p.id}`, { displayName: form.displayName, username: form.username, bio: form.bio, city: form.city || null,
        country: form.country || null, category: form.category || null, website: form.website || null, links });
      await reloadSession(); refresh(); showToast('Saved', 'ok'); back();
    } catch (e) { showToast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const uploadAvatar = async (file: File) => {
    try { const m = await uploadFile(file, 'avatar'); await patch(`/v1/profiles/${p.id}`, { avatarMediaId: m.id }); await reloadSession(); refresh(); showToast('Photo updated', 'ok'); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const uploadIntro = async (file: File) => {
    try {
      const poster = await posterFrom(file);
      const posterId = poster ? (await uploadFile(poster, 'poster')).id : undefined;
      const m = await uploadFile(file, 'intro', posterId ? { posterMediaId: posterId } : {});
      await patch(`/v1/profiles/${p.id}`, { introVideoMediaId: m.id }); refresh(); showToast('Intro video added', 'ok');
    } catch (e) { showToast(errorText(e), 'error'); }
  };
  return (
    <>
      <TopBar title="Edit profile" />
      <div class="scroll no-tabbar">
        <div class="below-topbar" />
        <div class="pad">
          <div class="row" style={{ marginBottom: 18 }}>
            <Avatar card={p} size={72} />
            <button class="btn small secondary" onClick={() => avatarInput.current?.click()}>Change photo</button>
            <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void uploadAvatar(f); }} />
          </div>
          <label class="field"><span class="field__label">{p.type === 'business' ? 'Business name' : 'Name'}</span><input class="input" maxLength={80} value={form.displayName} onInput={set('displayName')} /></label>
          <label class="field"><span class="field__label">Username</span><input class="input" value={form.username} onInput={(e) => setForm({ ...form, username: e.currentTarget.value.toLowerCase().replace(/[^a-z0-9._]/g, '') })} /></label>
          <label class="field"><span class="field__label">{p.type === 'business' ? 'Description' : 'Bio'}</span><textarea class="textarea" maxLength={1000} value={form.bio} onInput={set('bio')} /></label>
          <div class="row">
            <label class="field grow"><span class="field__label">City</span><input class="input" value={form.city} onInput={set('city')} /></label>
            <label class="field grow"><span class="field__label">Country</span><input class="input" value={form.country} onInput={set('country')} /></label>
          </div>
          <label class="field"><span class="field__label">{p.type === 'business' ? 'Category' : 'Niche'}</span><input class="input" value={form.category} onInput={set('category')} /></label>
          <label class="field"><span class="field__label">Website</span><input class="input" value={form.website} onInput={set('website')} placeholder="example.com" /></label>
          <label class="field"><span class="field__label">Instagram link</span><input class="input" value={form.instagram} onInput={set('instagram')} /></label>
          <label class="field"><span class="field__label">TikTok link</span><input class="input" value={form.tiktok} onInput={set('tiktok')} /></label>
          {p.type === 'creator' && (
            <div class="field">
              <span class="field__label">Intro video {p.entitlements?.introVideo === 'locked' ? '· creator.pro' : ''}</span>
              <button class="btn secondary" disabled={p.entitlements?.introVideo !== 'available'} onClick={() => introInput.current?.click()}>
                {p.introVideo ? 'Replace intro video' : 'Add intro video'}</button>
              <input ref={introInput} type="file" accept="video/mp4,video/quicktime" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void uploadIntro(f); }} />
            </div>
          )}
          <button class="btn accent" style={{ margin: '10px 0 30px' }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </>
  );
}

// ─── Settings: profiles (switch / add), privacy, legal, log out ───

export function SettingsScreen() {
  const [adding, setAdding] = useState<null | 'creator' | 'business'>(null);
  const [legal, setLegal] = useState(false);
  const { data: page, reload } = useLoad<ProfilePage>((s) => get(`/v1/profiles/${activeProfile.value!.id}`, s), [activeProfile.value?.id]);
  if (adding) return <CreateProfile allowed={[adding]} onCancel={() => setAdding(null)} onDone={() => setAdding(null)} />;
  if (legal) return <Legal onBack={() => setLegal(false)} />;
  const hasCreator = profiles.value.some((p) => p.type === 'creator');
  const businessCount = profiles.value.filter((p) => p.type === 'business').length;
  const setting = async (key: string, value: unknown) => {
    try { await patch(`/v1/profiles/${activeProfile.value!.id}`, { settings: { [key]: value } }); reload(); } catch (e) { showToast(errorText(e), 'error'); }
  };
  return (
    <>
      <TopBar title="Settings" />
      <div class="scroll no-tabbar">
        <div class="below-topbar" />
        <div class="section-title">Profiles</div>
        {profiles.value.map((p) => (
          <button class="list-row" onClick={() => p.id !== activeProfile.value?.id && setActiveProfile(p.id)}>
            <Avatar card={p} size={42} />
            <div class="grow"><div class="list-row__title">{p.displayName} <ProBadge card={p} /></div><div class="list-row__sub">{p.type === 'business' ? 'Business' : 'Creator'} · @{p.username}</div></div>
            {p.id === activeProfile.value?.id && <Icon name="IconCheckActive" />}
          </button>
        ))}
        <div class="pad" style={{ display: 'grid', gap: 8, marginTop: 6 }}>
          {!hasCreator && <button class="btn secondary" onClick={() => setAdding('creator')}>Add creator profile</button>}
          {businessCount < 5 && <button class="btn secondary" onClick={() => setAdding('business')}>Add business profile ({businessCount}/5, free)</button>}
        </div>
        <div class="section-title">Privacy</div>
        {page?.settings && (
          <>
            <button class="list-row" onClick={() => setting('showLocation', !page.settings!.showLocation)}><div class="grow">Show location</div><span class={`toggle ${page.settings.showLocation ? 'is-on' : ''}`} /></button>
            <button class="list-row" onClick={() => setting('showLinks', !page.settings!.showLinks)}><div class="grow">Show social links</div><span class={`toggle ${page.settings.showLinks ? 'is-on' : ''}`} /></button>
            <div class="list-row"><div class="grow">Who can message me</div>
              <select class="select" style={{ width: 'auto', height: 36 }} value={page.settings.whoCanMessage} onChange={(e) => setting('whoCanMessage', e.currentTarget.value)}>
                <option value="everyone">Everyone</option><option value="contacts">Contacts</option><option value="nobody">Nobody</option>
              </select></div>
            {page.type === 'business' && <button class="list-row" onClick={() => setting('hideJobPosts', !page.settings!.hideJobPosts)}><div class="grow">Hide my job posts</div><span class={`toggle ${page.settings.hideJobPosts ? 'is-on' : ''}`} /></button>}
          </>
        )}
        <div class="section-title">Account</div>
        <div class="list-row"><div class="grow"><div>{user.value?.email}</div><div class="list-row__sub">{user.value?.isDemo ? 'Demo account (shared for testing)' : 'Test environment account'}</div></div></div>
        <button class="list-row" onClick={() => setLegal(true)}><div class="grow">Terms & Privacy</div><Icon name="IconCaretRight" size={16} /></button>
        {profiles.value.length > 1 && (
          <button class="list-row" style={{ color: '#FF5A5A' }} onClick={() => confirmSheet('Deactivate this profile?', 'It disappears for others; its open jobs close.', 'Deactivate', async () => {
            try { await del(`/v1/profiles/${activeProfile.value!.id}`); await reloadSession(); setActiveProfile(profiles.value[0]?.id ?? null); } catch (e) { showToast(errorText(e), 'error'); }
          }, true)}>Deactivate this profile</button>
        )}
        <div class="pad" style={{ marginTop: 18 }}><button class="btn danger" onClick={() => confirmSheet('Log out?', 'You can log in again any time.', 'Log out', () => void signOut())}>Log out</button></div>
        <div class="center muted" style={{ fontSize: 11, margin: '18px 0' }}>kolaba. web · WEB MVP 01 · test environment</div>
      </div>
    </>
  );
}

// ─── Invite link landing: #/invite/<token> ───

export function InviteScreen({ token }: { token: string }) {
  const { data, error } = useLoad<{ inviteId: string; recipient: Card }>((s) => get(`/v1/reviews/invites/${token}`, s), [token]);
  const accept = async () => {
    try {
      const res = await post(`/v1/reviews/invites/${token}/accept`);
      try { localStorage.removeItem('kolaba.invite'); } catch { /* */ }
      refresh();
      push('review-form', { recipient: res.recipient, inviteId: res.inviteId });
    } catch (e) { showToast(errorText(e), 'error'); }
  };
  return (
    <>
      <TopBar title="Review invite" />
      <div class="scroll no-tabbar"><div class="below-topbar" />
        {error ? <Empty title="Invite not available" text={errorText(error)} /> : !data ? <Spinner /> : (
          <div class="pad center">
            <div style={{ display: 'grid', placeItems: 'center', margin: '20px 0' }}><Avatar card={data.recipient} size={88} /></div>
            <h2 style={{ margin: '0 0 6px' }}>{data.recipient.displayName}</h2>
            <p class="soft">asks you for a review. Accepting adds you to each other's contacts; then you can leave one review.</p>
            <button class="btn accent" onClick={accept}>Accept and write a review</button>
          </div>
        )}
      </div>
    </>
  );
}
