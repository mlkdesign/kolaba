// My Profile and public profiles (MyProfileView / VisitorProfileView): the 400 pt photo under the status bar with the
// animated glow, name + PRO, figures, actions, social circles, Portfolio / Reviews; edit, settings, collections, the
// review request sheet, the review form and the invite landing.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Card, del, errorText, get, Job, Media, patch, post, posterFrom, ProfilePage, put, Review, uploadFile } from '../api';
import { activeProfile, back, isBusiness, openSheet, profiles, push, refresh, refreshTick, reloadSession, setActiveProfile, showToast, signOut, user } from '../state';
import { ProfileGlow } from '../fx';
import {
  Avatar, BackButton, confirmSheet, Empty, fmtCount, GlassButton, gradientFor, Header, HeaderTitle, Icon, icon, initials, MediaTile,
  openViewer, PageTabs, ProBadge, SheetFrame, Spinner, StarIcon, Stars, SwipePages, timeAgo, useLoad, usePullToRefresh, alertDialog, pickSheet,
} from '../ui';
import { JobCard } from './jobs';
import { CreateProfile, Legal } from './auth';

const SOCIAL_ICON: Record<string, string> = { instagram: 'SocialInstagramColor', tiktok: 'SocialTikTokColor', youtube: 'SocialYouTubeColor', pinterest: 'SocialPinterestColor' };
const LINK_ICON: Record<string, string> = { instagram: 'ContactInstagram', tiktok: 'ContactTikTokGlyph', youtube: 'ContactYouTubeGlyph', telegram: 'ContactTelegram',
  whatsapp: 'ContactWhatsApp', email: 'ContactEmail', pinterest: 'ContactPinterest', website: 'ContactLink' };

export function ProfileScreen({ id, tab: initialTab }: { id?: string; tab?: 'reviews' }) {
  const profileId = id ?? activeProfile.value?.id;
  const { data: p, error, reload } = useLoad<ProfilePage>((s) => get(`/v1/profiles/${profileId}`, s), [profileId, refreshTick.value]);
  const own = !id || !!p?.isOwner;
  const [tabIndex, setTabIndex] = useState(initialTab === 'reviews' ? 1 : 0);
  const [scrolled, setScrolled] = useState(0);
  const viewed = useRef(false);
  const { scroller, Indicator } = usePullToRefresh(() => reload());
  useEffect(() => {
    if (p && !own && !viewed.current) { viewed.current = true; post(`/v1/profiles/${p.id}/view`).catch(() => {}); }
  }, [p?.id]);

  const left = id ? <BackButton /> : null;
  if (error) return <><Header left={left} /><div class="section-top"><Empty title="Profile not available" text={errorText(error)} /></div></>;
  if (!p) return <><Header left={left} /><div class="phero skeleton" style={{ borderRadius: 0 }} /><Spinner /></>;

  const business = p.type === 'business';
  const right = own
    ? <GlassButton name="IconGear" label="Settings" onClick={() => push('settings', {}, 'profile')} />
    : <GlassButton name="IconDotsThree" label="More" onClick={() => profileMenu(p, reload)} />;
  const tabs = business ? ['Job posts', 'Reviews'] : ['Portfolio', 'Reviews'];
  return (
    <>
      <div class="scroll" ref={scroller} onScroll={(e) => setScrolled(e.currentTarget.scrollTop)}>
        <Hero p={p} own={own} />
        <div class="pinfo">
          <div class="pinfo__block">
            <div class="pname"><span>{p.displayName}</span><ProBadge card={p} /></div>
            <div class="pmeta">
              {p.location && <span>{p.flag} {p.location}</span>}
              {p.category && <span>{p.category}</span>}
              {!p.location && !p.category && <span>@{p.username}</span>}
            </div>
            {p.bio && <Bio text={p.bio} />}
          </div>
          <Figures p={p} />
          {own ? <OwnerActions p={p} /> : <VisitorActions profile={p} />}
          <Socials p={p} />
        </div>
        <div class="ptab-bar" style={{ marginTop: 22 }}>
          <PageTabs tabs={tabs} index={tabIndex} onChange={setTabIndex} profile counts={[undefined, p.ratings?.count || undefined]} />
        </div>
        <SwipePages index={tabIndex} onChange={setTabIndex}>
          {business ? <ProfileJobs profile={p} own={own} /> : <Portfolio profile={p} own={own} onChange={reload} />}
          <Reviews profile={p} own={own} />
        </SwipePages>
        <div style={{ height: own ? 'var(--tabbar-clear)' : 40 }} />
      </div>
      <ProfileGlow business={business} />
      <Indicator />
      <Header left={left} right={right} blurOpacity={Math.min(Math.max((scrolled - 200) / 120, 0), 1)} />
    </>
  );
}

function Hero({ p, own }: { p: ProfilePage; own: boolean }) {
  const [broken, setBroken] = useState(false);
  const introInput = useRef<HTMLInputElement>(null);
  const canIntro = own && p.type === 'creator' && p.entitlements?.introVideo === 'available';
  const intro = p.introVideo;
  return (
    <div class="phero">
      <div class="phero__track">
        {p.avatarUrl && !broken ? <img src={p.avatarUrl} alt="" draggable={false} onError={() => setBroken(true)} />
          : <div class="phero__mono" style={{ background: gradientFor(p.displayName) }}>{initials(p.displayName)}</div>}
      </div>
      <div class="phero__shade" />
      {intro ? (
        <button class="glass intro-pill is-tinted" onClick={() => openViewer(intro)}><span class="play"><img src={icon('IconPlay')} alt="" /></span>Intro Video</button>
      ) : canIntro ? (
        <>
          <button class="glass intro-pill" onClick={() => introInput.current?.click()}><span class="play"><img src={icon('IconPlay')} alt="" /></span>Add Intro Video</button>
          <input ref={introInput} type="file" accept="video/mp4,video/quicktime" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void uploadIntro(p, f); e.currentTarget.value = ''; }} />
        </>
      ) : null}
    </div>
  );
}

async function uploadIntro(p: ProfilePage, file: File) {
  try {
    showToast('Uploading intro video…');
    const poster = await posterFrom(file);
    const posterId = poster ? (await uploadFile(poster, 'poster')).id : undefined;
    const m = await uploadFile(file, 'intro', posterId ? { posterMediaId: posterId } : {});
    await patch(`/v1/profiles/${p.id}`, { introVideoMediaId: m.id }); refresh(); showToast('Intro video added', 'ok');
  } catch (e) { showToast(errorText(e), 'error'); }
}

function Bio({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 120 || text.split('\n').length > 3;
  return (
    <div class="pbio-wrap">
      <div class={`pbio selectable ${!open && long ? 'is-clamped' : ''}`}>{text}</div>
      {long && !open && <button class="show-more pbio__more" onClick={() => setOpen(true)}>Show more</button>}
    </div>
  );
}

/** Collabs | Rating | Contacts (iOS). The web has no collaboration count yet, so the first figure is Reviews. */
function Figures({ p }: { p: ProfilePage }) {
  const rating = p.ratings?.count ? p.ratings.rating! : null;
  return (
    <div class="stats">
      <div class="stats__cell"><b>{p.ratings?.count ?? 0}</b><span>Reviews</span></div>
      <div class="stats__cell"><b>{rating ? rating.toFixed(1) : '—'}{rating && <StarIcon size={16} />}</b><span>Rating</span></div>
      <div class="stats__cell"><b>{fmtCount(p.counts?.contacts ?? 0)}</b><span>Contacts</span></div>
    </div>
  );
}

function OwnerActions({ p }: { p: ProfilePage }) {
  const share = async () => {
    const url = (import.meta as any).env?.VITE_APP_URL ?? location.origin + location.pathname;
    const text = `${p.displayName} (@${p.username}) on kolaba.`;
    try {
      if (navigator.share) await navigator.share({ title: text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); showToast('Profile link copied', 'ok'); }
    } catch { /* cancelled */ }
  };
  return (
    <div class="pactions">
      <button class="pbtn" onClick={() => push('profile-edit', {}, 'profile')}><img src={icon('IconPencilLine')} alt="" />Edit Profile</button>
      <button class="pbtn" onClick={share}><img src={icon('IconShareFat')} alt="" />Share Profile</button>
    </div>
  );
}

function VisitorActions({ profile }: { profile: ProfilePage }) {
  const { data: follow, setData } = useLoad<{ following: boolean }>((s) => get(`/v1/profiles/${profile.id}/follow`, s), [profile.id, activeProfile.value?.id]);
  const same = profiles.value.some((x) => x.id === profile.id);
  const message = async () => {
    try { const { id } = await post('/v1/conversations', { profileId: profile.id }); push('conversation', { id }); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const toggle = async () => {
    const next = !follow?.following;
    setData({ following: next });
    try { next ? await put(`/v1/profiles/${profile.id}/follow`) : await del(`/v1/profiles/${profile.id}/follow`); refresh(); }
    catch (e) { setData({ following: !next }); showToast(errorText(e), 'error'); }
  };
  return (
    <div class="pactions">
      <button class="pbtn is-accent" disabled={same} onClick={message}>Message</button>
      <button class="pbtn" disabled={same || !follow} onClick={toggle} aria-pressed={!!follow?.following}>
        <img src={icon(follow?.following ? 'IconUserMinus' : 'IconUserPlus')} alt="" />{follow?.following ? 'Unfollow' : 'Follow'}
      </button>
    </div>
  );
}

function Socials({ p }: { p: ProfilePage }) {
  const links = p.links ?? [];
  if (!p.socialAccounts.length && !links.length && !p.website) return null;
  const linkFor = (platform: string) => links.find((l) => l.kind === platform)?.url;
  return (
    <div class="socials" data-hscroll>
      {p.socialAccounts.map((s) => {
        const href = linkFor(s.platform);
        const body = <><span class="social__circle"><img src={icon(SOCIAL_ICON[s.platform] ?? 'ContactLink')} alt="" /></span>{fmtCount(s.followers)}</>;
        return href ? <a class="social" href={href} target="_blank" rel="noopener noreferrer nofollow" aria-label={s.platform}>{body}</a>
          : <span class="social" aria-label={s.platform}>{body}</span>;
      })}
      <button class="social" onClick={() => openLinks(p)}><span class="social__circle is-filled"><img src={icon('IconLink')} alt="" /></span>All Links</button>
    </div>
  );
}

function openLinks(p: ProfilePage) {
  const items = [...p.links, ...(p.website && !p.links.some((l) => l.kind === 'website') ? [{ kind: 'website', url: p.website }] : [])];
  openSheet((close) => (
    <SheetFrame title="Links" close={close}>
      {!items.length ? <Empty title="No links yet" iconName="IconLink" /> : items.map((l) => (
        <a class="menu-item" href={l.url} target="_blank" rel="noopener noreferrer nofollow" style={{ textDecoration: 'none' }}>
          <img src={icon(LINK_ICON[l.kind] ?? 'ContactLink')} alt="" />
          <span class="grow ellipsis">{l.kind === 'website' || l.kind === 'email' ? l.url.replace(/^(https?:\/\/|mailto:)/, '') : l.kind[0].toUpperCase() + l.kind.slice(1)}</span>
          <Icon name="IconCaretRight" size={14} />
        </a>
      ))}
    </SheetFrame>
  ));
}

/** The visitor's ••• menu: contacts (add / accept / cancel / remove), a review for a contact, report. */
function profileMenu(p: ProfilePage, reload: () => void) {
  openSheet((close) => <ProfileMenu p={p} close={close} reload={reload} />);
}

function ProfileMenu({ p, close, reload }: { p: ProfilePage; close: () => void; reload: () => void }) {
  const { data: rel } = useLoad<{ relation: string; requestId: string | null }>((s) => get(`/v1/contacts/relation/${p.id}`, s), [p.id]);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    close();
    try { await fn(); showToast(ok, 'ok'); reload(); refresh(); } catch (e) { showToast(errorText(e), 'error'); }
  };
  const r = rel?.relation;
  return (
    <SheetFrame title={p.displayName} close={close}>
      {!rel ? <Spinner /> : (
        <>
          {r === 'none' && <button class="menu-item" onClick={() => run(() => post('/v1/contacts/requests', { profileId: p.id }), 'Contact request sent')}><img src={icon('IconUserPlus')} alt="" />Add to contacts</button>}
          {r === 'incoming' && <button class="menu-item" onClick={() => run(() => post(`/v1/contacts/requests/${rel.requestId}/accept`), 'Contact added')}><img src={icon('IconCheckCircle')} alt="" />Accept contact request</button>}
          {r === 'requested' && <button class="menu-item" onClick={() => run(() => post(`/v1/contacts/requests/${rel.requestId}/cancel`), 'Request cancelled')}><img src={icon('IconXCircle')} alt="" />Cancel contact request</button>}
          {r === 'connected' && <button class="menu-item" onClick={() => { close(); push('review-form', { recipient: p }); }}><img src={icon('IconStarRating')} alt="" />Write a review</button>}
          {r === 'connected' && <button class="menu-item" onClick={() => { close(); confirmSheet('Remove contact?', `${p.displayName} will no longer be in your contacts.`, 'Remove', () => run(() => del(`/v1/contacts/${p.id}`), 'Contact removed'), true); }}><img src={icon('IconUserMinus')} alt="" />Remove from contacts</button>}
        </>
      )}
      <button class="menu-item is-danger" onClick={() => run(() => post('/v1/reports', { targetType: 'profile', targetId: p.id, reason: 'inappropriate' }), 'Reported — our team will review it')}>
        <img src={icon('IconShieldWarning')} alt="" />Report profile</button>
    </SheetFrame>
  );
}

// ─── Portfolio: All · Collections · Sort · + ───

function Portfolio({ profile, own, onChange }: { profile: ProfilePage; own: boolean; onChange: () => void }) {
  const [mode, setMode] = useState<'all' | 'collections'>('all');
  const [newest, setNewest] = useState(true);
  const { data, reload } = useLoad<{ items: Media[] }>((s) => get(`/v1/profiles/${profile.id}/media?purpose=portfolio`, s), [profile.id, refreshTick.value]);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const upload = async (file: File) => {
    setProgress(0);
    try {
      let posterMediaId: string | undefined;
      if (file.type.startsWith('video/')) { const poster = await posterFrom(file); if (poster) posterMediaId = (await uploadFile(poster, 'poster')).id; }
      await uploadFile(file, 'portfolio', posterMediaId ? { posterMediaId } : {}, (f) => setProgress(f));
      showToast('Uploaded', 'ok'); reload(); onChange(); refresh();
    } catch (e) { showToast(errorText(e), 'error'); } finally { setProgress(null); }
  };
  const items = [...(data?.items ?? [])].sort((a, b) => (newest ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  const [removing, setRemoving] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const remove = (m: Media) => alertDialog(m.kind === 'video' ? 'Delete this video?' : 'Delete this photo?',
    'It disappears from your profile, your collections and Reels. This can’t be undone.', 'Delete', async () => {
      setRemoving(m.id);
      try { await del(`/v1/media/${m.id}`); setGone((g) => [...g, m.id]); showToast(m.kind === 'video' ? 'Video deleted' : 'Photo deleted', 'ok'); reload(); onChange(); refresh(); }
      catch (e) { showToast(errorText(e), 'error'); } finally { setRemoving(null); }
    });
  const report = (m: Media) => post('/v1/reports', { targetType: 'media', targetId: m.id, reason: 'inappropriate' })
    .then(() => showToast('Reported — thank you', 'ok')).catch((e) => showToast(errorText(e), 'error'));
  const menuFor = (m: Media) => (own ? [{ label: 'Delete', icon: 'IconTrash', danger: true, run: () => remove(m) }]
    : [{ label: 'Report content', icon: 'IconShieldWarning', run: () => void report(m) }]);
  return (
    <>
      <div class="mfilter">
        <button class={`mchip ${mode === 'all' ? 'is-on' : ''}`} onClick={() => setMode('all')}>All</button>
        <button class={`mchip ${mode === 'collections' ? 'is-on' : ''}`} onClick={() => setMode('collections')}>Collections</button>
        <span class="grow" />
        {mode === 'all' && <button class="mchip is-plain" onClick={() => setNewest(!newest)} aria-label={newest ? 'Newest first' : 'Oldest first'}>
          <img src={icon('IconSortAscending')} alt="" style={{ transform: newest ? undefined : 'scaleY(-1)' }} />Sort</button>}
        {own && mode === 'all' && <button class="glass glass-btn" style={{ width: 40, height: 40 }} aria-label="Upload" disabled={progress !== null}
          onClick={() => input.current?.click()}>{progress !== null ? `${Math.round(progress * 100)}%` : <img src={icon('IconPlus')} alt="" style={{ width: 20, height: 20 }} />}</button>}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" hidden
          onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void upload(f); e.currentTarget.value = ''; }} />
      </div>
      {mode === 'collections' ? <Collections profile={profile} own={own} /> : !data ? <Spinner /> : !items.length ? (
        <Empty title={own ? 'Your portfolio is empty' : 'No portfolio yet'} text={own ? 'Upload photos and videos of your best work with +.' : undefined} iconName="IconImages" />
      ) : (
        <div class="mgrid">{items.filter((m) => !gone.includes(m.id)).map((m) => <MediaTile media={m} key={m.id} menu={menuFor(m)} removing={removing === m.id} />)}</div>
      )}
    </>
  );
}

function Collections({ profile, own }: { profile: ProfilePage; own: boolean }) {
  const { data, reload } = useLoad<{ items: { id: string; title: string; itemsCount: number; cover: Media | null }[] }>(
    (s) => get(`/v1/profiles/${profile.id}/collections`, s), [profile.id, refreshTick.value]);
  const locked = own && profile.entitlements?.collections === 'locked';
  const create = () => openSheet((close) => <NewCollection close={close} onDone={() => { close(); reload(); }} />);
  if (!data) return <Spinner />;
  if (locked) return <div class="locked"><b>Collections are part of creator.pro</b>Group your work into folders for brands. Test environment: PRO is a test entitlement — no payments.</div>;
  if (!data.items.length && !own) return <Empty title="No collections yet" iconName="IconFolderSimpleDashed" />;
  return (
    <div class="folders" data-hscroll style={{ flexWrap: 'wrap', overflow: 'visible' }}>
      {data.items.map((col) => (
        <button class="folder" key={col.id} onClick={() => push('collection', { id: col.id, own })}>
          <div class="folder__cover">{col.cover ? <img src={(col.cover.kind === 'video' ? col.cover.posterUrl : col.cover.url) ?? ''} alt="" loading="lazy" /> : <Icon name="IconFolderSimpleDashed" size={28} />}</div>
          <div class="folder__title ellipsis">{col.title}</div>
          <div class="folder__count">{col.itemsCount} {col.itemsCount === 1 ? 'item' : 'items'}</div>
        </button>
      ))}
      {own && (
        <button class="folder" onClick={create} style={{ marginLeft: data.items.length ? 30 : 0 }}>
          <div class="folder__cover is-new"><Icon name="IconNewFolderPlus" size={28} /></div>
          <div class="folder__title">New folder</div>
        </button>
      )}
    </div>
  );
}

function NewCollection({ close, onDone }: { close: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const save = async () => {
    try { await post('/v1/media/collections', { title }); showToast('Folder created', 'ok'); onDone(); } catch (e) { showToast(errorText(e), 'error'); }
  };
  return (
    <SheetFrame title="New folder" close={close}>
      <label class="field"><input maxLength={40} placeholder="Folder name" value={title} onInput={(e) => setTitle(e.currentTarget.value)} /></label>
      <button class="btn" style={{ marginTop: 16 }} disabled={!title.trim()} onClick={save}>Create</button>
    </SheetFrame>
  );
}

export function CollectionScreen({ id, own }: { id: string; own: boolean }) {
  const { data, reload } = useLoad<{ collection: any; items: Media[] }>((s) => get(`/v1/media/collections/${id}/items`, s), [id, refreshTick.value]);
  const edit = () => openSheet((close) => <PickMedia close={close} selected={data!.items.map((m) => m.id)} onSave={async (ids) => {
    try { await put(`/v1/media/collections/${id}/items`, { mediaIds: ids }); close(); reload(); refresh(); } catch (e) { showToast(errorText(e), 'error'); }
  }} />, true);
  const remove = () => confirmSheet('Delete folder?', 'Its photos and videos stay in your portfolio.', 'Delete folder', async () => {
    try { await del(`/v1/media/collections/${id}`); refresh(); back(); } catch (e) { showToast(errorText(e), 'error'); }
  }, true);
  const menu = () => openSheet((close) => (
    <SheetFrame title="Folder" close={close}>
      <button class="menu-item" onClick={() => { close(); edit(); }}><img src={icon('IconImages')} alt="" />Choose items</button>
      <button class="menu-item is-danger" onClick={() => { close(); remove(); }}><img src={icon('IconTrash')} alt="" />Delete folder</button>
    </SheetFrame>
  ));
  return (
    <>
      <div class="scroll">
        <div class="section-top" />
        {!data ? <Spinner /> : !data.items.length ? <Empty title="This folder is empty" text={own ? 'Add photos and videos from your portfolio.' : undefined}>
          {own && <button class="btn is-small" onClick={edit}>Add items</button>}</Empty> :
          <div class="mgrid">{data.items.map((m) => <MediaTile media={m} key={m.id} />)}</div>}
        <div style={{ height: 40 }} />
      </div>
      <Header left={<BackButton />} center={<HeaderTitle title={data?.collection.title ?? ''} sub={data ? `${data.items.length} items` : undefined} />}
        right={own ? <GlassButton name="IconDotsThree" label="Folder menu" onClick={menu} /> : null} />
    </>
  );
}

function PickMedia({ close, selected, onSave }: { close: () => void; selected: string[]; onSave: (ids: string[]) => void }) {
  const [ids, setIds] = useState<string[]>(selected);
  const { data } = useLoad<{ items: Media[] }>((s) => get(`/v1/profiles/${activeProfile.value!.id}/media?purpose=portfolio`, s), []);
  return (
    <SheetFrame title="Choose items" close={close}>
      {!data ? <Spinner /> : (
        <div class="mgrid" style={{ padding: 0 }}>{data.items.map((m) => (
          <MediaTile media={m} picked={ids.includes(m.id)} onOpen={() => setIds((x) => (x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id]))} />
        ))}</div>
      )}
      <button class="btn" style={{ marginTop: 16 }} onClick={() => onSave(ids)}>Save ({ids.length})</button>
    </SheetFrame>
  );
}

function ProfileJobs({ profile, own }: { profile: ProfilePage; own: boolean }) {
  const { data } = useLoad<{ items: Job[] }>((s) => get(`/v1/profiles/${profile.id}/jobs`, s), [profile.id, refreshTick.value]);
  if (!data) return <Spinner />;
  if (profile.hideJobPosts && !own) return <Empty title="Job posts are hidden" iconName="IconBriefcase" />;
  if (!data.items.length) return (
    <Empty title="No job posts" iconName="IconBriefcase" text={own ? 'Publish your first job — creators apply in the job. section.' : undefined}>
      {own && <button class="btn is-small" onClick={() => push('job-editor', {}, 'jobs')}>Create a job</button>}
    </Empty>
  );
  return <div class="feed">{data.items.map((j, i) => <>{i > 0 && <div class="post-sep" style={{ margin: '20px 0', height: 1, background: 'var(--separator)' }} />}<JobCard job={j} key={j.id} /></>)}</div>;
}

// ─── Reviews (FEATURE 23, Figma 980:17859): 4.9 out of 5 + stars, Quality · Speed · Contact bars, Request a review,
// then "Reviews 3 · Sort" and the cards ───

function Reviews({ profile, own }: { profile: ProfilePage; own: boolean }) {
  const [sort, setSort] = useState<'newest' | 'oldest' | 'highest' | 'lowest'>('newest');
  const { data } = useLoad<{ summary: any; items: Review[] }>((s) => get(`/v1/reviews?profileId=${profile.id}&sort=${sort}`, s), [profile.id, sort, refreshTick.value]);
  if (!data) return <Spinner />;
  const s = data.summary;
  const sortSheet = () => pickSheet('Sort reviews', [['newest', 'Newest'], ['oldest', 'Oldest'], ['highest', 'Highest rating'], ['lowest', 'Lowest rating']], sort, setSort);
  return (
    <div class="reviews">
      {s?.count ? (
        <div class="rsummary">
          <div class="rsummary__top">
            <div><span class="rsummary__big">{s.rating.toFixed(1)}</span><span class="rsummary__of">out of 5</span></div>
            <Stars value={s.rating} size={20} />
          </div>
          {(['quality', 'speed', 'contact'] as const).map((k) => (
            <div class="crit"><span>{k[0].toUpperCase() + k.slice(1)}</span><div class="crit__bar"><i style={{ width: `${(s[k] / 5) * 100}%` }} /></div><b>{s[k].toFixed(1)}</b></div>
          ))}
          {own && <button class="rrequest" onClick={() => openRequestReview()}>Request a review</button>}
        </div>
      ) : own ? <div class="rsummary"><button class="rrequest" onClick={() => openRequestReview()}>Request a review</button></div> : null}
      {data.items.length > 0 && <div class="rdivider" />}
      {data.items.length > 0 && (
        <div class="rlist__head"><span>Reviews</span><span class="ptabs__count">{data.items.length}</span><span class="grow" />
          <button class="rsort" onClick={sortSheet}><img src={icon('IconSortAscending')} alt="" />Sort</button></div>
      )}
      {!data.items.length ? <Empty title="No reviews yet" text={own ? 'Ask your contacts for a review.' : 'Reviews come from confirmed contacts.'} iconName="IconStarRating" /> :
        data.items.map((r) => <ReviewCard r={r} key={r.id} />)}
    </div>
  );
}

function ReviewCard({ r }: { r: Review }) {
  const [open, setOpen] = useState(false);
  const long = r.comment.length > 150;
  return (
    <div class="rcard">
      <button class="rcard__head" onClick={() => r.author && push('profile-view', { id: r.author.id })}>
        <Avatar card={r.author} size={48} ring />
        <div class="grow" style={{ minWidth: 0 }}>
          <div class="row" style={{ gap: 8 }}><span class="rcard__name ellipsis grow">{r.author?.displayName ?? 'KOLABA member'}</span>
            <span class="row" style={{ gap: 2 }}><Stars value={r.rating} /><b class="rcard__value">{r.rating.toFixed(1)}</b></span></div>
          <div class="rcard__date">{new Date(r.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
        </div>
      </button>
      <div class={`rcard__text selectable ${open ? '' : 'lines-3'}`}>{r.comment}</div>
      {long && <button class="show-more" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</button>}
    </div>
  );
}

// ─── Request a Review sheet ───

export function openRequestReview() {
  openSheet((close) => <RequestReview close={close} />, true);
}

function RequestReview({ close }: { close: () => void }) {
  const [query, setQuery] = useState('');
  const { data, setData } = useLoad<{ items: { profile: Card; state: string; requestId: string | null }[] }>((s) => get('/v1/reviews/requests/sheet', s), []);
  const [pending, setPending] = useState<string | null>(null);
  const request = async (card: Card) => {
    setPending(card.id);
    try { await post('/v1/reviews/requests', { contactProfileId: card.id }); setData({ items: data!.items.map((i) => (i.profile.id === card.id ? { ...i, state: 'requested' } : i)) }); showToast(`Request sent to ${card.displayName}`, 'ok'); }
    catch (e) { showToast(errorText(e), 'error'); } finally { setPending(null); }
  };
  const invite = async () => {
    try { const { url } = await post('/v1/reviews/invites'); openSheet((c2) => <InviteLink url={url} close={c2} />); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const items = (data?.items ?? []).filter((i) => !query || i.profile.displayName.toLowerCase().includes(query.toLowerCase()));
  return (
    <SheetFrame title="Request a Review" close={close}>
      <label class="field rr-search"><img src={icon('IconMagnifyingGlass')} alt="" style={{ opacity: 1 }} />
        <input placeholder="Search" value={query} onInput={(e) => setQuery(e.currentTarget.value)} aria-label="Search contacts" /></label>
      <div class="rr-label">Your contacts</div>
      {!data ? <Spinner /> : !items.length ? <Empty title="No contacts yet" text="Reviews come from confirmed contacts. Invite someone new below." iconName="IconUserPlus" /> :
        items.map((i) => (
          <div class="rr-row" key={i.profile.id}>
            <Avatar card={i.profile} size={64} ring />
            <div class="grow" style={{ minWidth: 0 }}><div class="rr-name ellipsis">{i.profile.displayName}</div>
              <div class="rr-place ellipsis">{i.profile.location ? `${i.profile.flag ?? ''} ${i.profile.location}` : `@${i.profile.username}`}</div></div>
            {i.state === 'available'
              ? <button class="rr-btn" disabled={pending === i.profile.id} onClick={() => request(i.profile)}>{pending === i.profile.id ? '…' : 'Request'}</button>
              : <span class="rr-btn is-done" aria-disabled="true">{i.state === 'requested' ? 'Requested' : 'Reviewed'}</span>}
          </div>
        ))}
      <div style={{ height: 96 }} />
      <button class="rr-invite" onClick={invite}>
        <span class="rr-invite__icon"><img src={icon('IconLink')} alt="" /></span>
        <span class="grow"><b>Invite someone new</b><span>Send a link to get a review</span></span>
        <Icon name="IconCaretRight" size={16} />
      </button>
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
      <p class="muted" style={{ fontSize: 14, lineHeight: 1.45, marginTop: 0 }}>Send this one-time link to someone outside kolaba. They sign up, become your contact and can leave one review. It expires in 14 days.</p>
      <div class="field selectable" style={{ fontSize: 13, overflow: 'hidden', whiteSpace: 'nowrap' }}><span class="ellipsis">{url}</span></div>
      <button class="btn" style={{ marginTop: 16 }} onClick={share}>Send link</button>
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
    try { await post('/v1/reviews', { recipientProfileId: recipient.id, ...scores, comment, requestId, inviteId }); showToast('Review published', 'ok'); refresh(); back(); }
    catch (e) { showToast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <div class="scroll">
        <div class="section-top pad">
          <div class="row" style={{ marginBottom: 22 }}><Avatar card={recipient} size={48} /><div><div style={{ fontWeight: 600 }}>{recipient.displayName}</div><div class="muted" style={{ fontSize: 14 }}>{recipient.location}</div></div></div>
          {(['quality', 'speed', 'contact'] as const).map((k) => (
            <div style={{ marginBottom: 16 }}>
              <span class="label" style={{ textTransform: 'capitalize' }}>{k}</span>
              <div class="score-picker">{[1, 2, 3, 4, 5].map((n) => <button class={scores[k] >= n ? 'is-on' : ''} aria-label={`${k} ${n}`} onClick={() => setScores({ ...scores, [k]: n })}>{n}</button>)}</div>
            </div>
          ))}
          <textarea class="textarea" maxLength={2000} placeholder="How was it to work together?" value={comment} onInput={(e) => setComment(e.currentTarget.value)} />
          {overall && <div class="row muted" style={{ margin: '12px 8px', gap: 6 }}>Overall <b style={{ color: '#fff' }}>{overall.toFixed(1)}</b><StarIcon size={14} /></div>}
          <button class="btn" style={{ margin: '16px 0 40px' }} disabled={busy || !complete} onClick={submit}>{busy ? 'Publishing…' : 'Publish review'}</button>
        </div>
      </div>
      <Header left={<BackButton />} center={<HeaderTitle title="Write a review" />} />
    </>
  );
}

// ─── Edit profile ───

export function EditProfileScreen() {
  const { data: p } = useLoad<ProfilePage>((s) => get(`/v1/profiles/${activeProfile.value!.id}`, s), [activeProfile.value?.id]);
  if (!p) return <><Header left={<BackButton />} center={<HeaderTitle title="Edit Profile" />} /><div class="section-top"><Spinner /></div></>;
  return <EditForm p={p} />;
}

function EditForm({ p }: { p: ProfilePage }) {
  const [form, setForm] = useState({ displayName: p.displayName, username: p.username, bio: p.bio, city: p.city ?? '', country: p.country ?? '',
    category: p.category ?? '', website: p.website ?? '', instagram: p.links.find((l) => l.kind === 'instagram')?.url ?? '',
    tiktok: p.links.find((l) => l.kind === 'tiktok')?.url ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: any) => setForm({ ...form, [k]: e.currentTarget.value });
  const avatarInput = useRef<HTMLInputElement>(null);
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
    try { showToast('Uploading photo…'); const m = await uploadFile(file, 'avatar'); await patch(`/v1/profiles/${p.id}`, { avatarMediaId: m.id }); await reloadSession(); refresh(); showToast('Photo updated', 'ok'); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const field = (k: keyof typeof form, label: string, iconName: string, placeholder = '') => (
    <div><span class="label">{label}</span><label class="field"><img src={icon(iconName)} alt="" /><input value={form[k]} placeholder={placeholder || label} onInput={set(k)} /></label></div>
  );
  const me = activeProfile.value ?? p;
  return (
    <>
      <div class="scroll">
        <div class="section-top pad" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 'calc(var(--header-h) + 16px)', paddingBottom: 120 }}>
          {field('displayName', p.type === 'business' ? 'Business name' : 'Your name', 'IconUser')}
          <div>
            <div class="row" style={{ justifyContent: 'space-between' }}><span class="label">Profile photo</span><span class="label" style={{ color: '#fff' }}>{me.avatarUrl ? 1 : 0} <span class="muted">/ 1</span></span></div>
            <div class="photos-row">
              {me.avatarUrl && <img class="photos-row__tile" src={me.avatarUrl} alt="Profile photo" />}
              <button class="photos-row__tile is-add" aria-label={me.avatarUrl ? 'Change photo' : 'Add photo'} onClick={() => avatarInput.current?.click()}><Icon name="IconPlus" size={18} /></button>
            </div>
            <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void uploadAvatar(f); e.currentTarget.value = ''; }} />
          </div>
          <div><span class="label">Username</span><label class="field"><img src={icon('IconUser')} alt="" /><input value={form.username} placeholder="Username"
            onInput={(e) => setForm({ ...form, username: e.currentTarget.value.toLowerCase().replace(/[^a-z0-9._]/g, '') })} />
            {/^[a-z0-9._]{3,30}$/.test(form.username) && <img src={icon('IconCheckActive')} alt="Valid" style={{ opacity: 1 }} />}</label></div>
          <div><span class="label">Your location</span><div class="row" style={{ gap: 8 }}>
            <label class="field grow"><img src={icon('IconMapPin')} alt="" /><input value={form.city} placeholder="City" onInput={set('city')} /></label>
            <label class="field grow"><input value={form.country} placeholder="Country" onInput={set('country')} /></label></div></div>
          {field('category', p.type === 'business' ? 'Category' : 'Niche', 'IconFunnel')}
          <div><div class="row" style={{ justifyContent: 'space-between' }}><span class="label">Profile description</span>
            <span class="label" style={{ color: '#fff' }}>{form.bio.length} <span class="muted">/ 1000</span></span></div>
            <textarea class="textarea" maxLength={1000} value={form.bio} onInput={set('bio')} style={{ minHeight: 160 }} /></div>
          {field('website', 'Website', 'IconGlobeSimple', 'example.com')}
          {field('instagram', 'Instagram', 'IconInstagram', 'https://instagram.com/…')}
          {field('tiktok', 'TikTok', 'IconTikTok', 'https://tiktok.com/@…')}
        </div>
      </div>
      <div class="save-bar"><button class="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
      <Header left={<BackButton />} center={<HeaderTitle title="Edit profile" />} />
    </>
  );
}

// ─── Settings (SettingsView, Figma 654:18389): the account card, grouped 50 pt rows, Log out in red ───

const Row = ({ iconName, title, value, onClick, danger }: { iconName?: string; title: string; value?: string; onClick: () => void; danger?: boolean }) => (
  <button class={`srow ${danger ? 'is-danger' : ''}`} onClick={onClick}>
    {iconName && <img class="srow__icon" src={icon(iconName)} alt="" />}
    <span class="grow ellipsis">{title}</span>
    {value && <span class="srow__value">{value}</span>}
    <img class="srow__caret" src={icon('IconCaretRight')} alt="" />
  </button>
);

const ToggleRow = ({ title, detail, on, onChange }: { title: string; detail?: string; on: boolean; onChange: (v: boolean) => void }) => (
  <button class="srow" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
    <span class="grow"><span style={{ display: 'block' }}>{title}</span>{detail && <span class="srow__detail">{detail}</span>}</span>
    <span class={`toggle ${on ? 'is-on' : ''}`} />
  </button>
);

export function SettingsScreen() {
  const [page, setPage] = useState<'main' | 'privacy' | 'language' | 'about'>('main');
  const [adding, setAdding] = useState<null | 'creator' | 'business'>(null);
  const { data: me, reload } = useLoad<ProfilePage>((s) => get(`/v1/profiles/${activeProfile.value!.id}`, s), [activeProfile.value?.id]);
  if (adding) return <CreateProfile allowed={[adding]} onCancel={() => setAdding(null)} onDone={() => setAdding(null)} />;
  if (page === 'about') return <Legal onBack={() => setPage('main')} />;
  const hasCreator = profiles.value.some((p) => p.type === 'creator');
  const businessCount = profiles.value.filter((p) => p.type === 'business').length;
  const setting = async (key: string, value: unknown) => {
    try { await patch(`/v1/profiles/${activeProfile.value!.id}`, { settings: { [key]: value } }); reload(); } catch (e) { showToast(errorText(e), 'error'); }
  };
  const goBack = page === 'main' ? undefined : () => setPage('main');
  const more = () => openSheet((close) => (
    <SheetFrame title="Settings" close={close}>
      <button class="menu-item" onClick={() => { close(); window.location.href = 'mailto:mlkdesignweb@gmail.com?subject=KOLABA%20web%20problem'; }}><img src={icon('IconQuestion')} alt="" />Report a problem</button>
      {profiles.value.length > 1 && <button class="menu-item is-danger" onClick={() => { close(); confirmSheet('Deactivate this profile?', 'It disappears for others; its open jobs close.', 'Deactivate', async () => {
        try { await del(`/v1/profiles/${activeProfile.value!.id}`); await reloadSession(); setActiveProfile(profiles.value[0]?.id ?? null); } catch (e) { showToast(errorText(e), 'error'); }
      }, true); }}><img src={icon('IconTrash')} alt="" />Deactivate this profile</button>}
    </SheetFrame>
  ));
  const title = { main: 'Settings', privacy: 'Privacy & Safety', language: 'Language' }[page];
  const p = activeProfile.value!;
  return (
    <>
      <div class="scroll">
        <div class="settings">
          {page === 'main' && (
            <>
              <div class="scard">
                <Avatar card={p} size={70} ring />
                <div class="grow" style={{ minWidth: 0 }}>
                  <div class="scard__name ellipsis">{p.displayName}</div>
                  {p.location && <div class="scard__place ellipsis">{p.flag} {p.location}</div>}
                </div>
                <button class="scard__edit" onClick={() => push('profile-edit', {}, 'profile')}>Edit profile</button>
              </div>
              <div class="sgroup">
                <Row iconName="IconBellSmall" title="Notifications" onClick={() => push('notifications', {}, 'profile')} />
                <Row iconName="IconShieldWarning" title="Privacy & Safety" onClick={() => setPage('privacy')} />
                <Row iconName="IconTranslateFilled" title="Language" value="English" onClick={() => setPage('language')} />
                <Row iconName="IconUser" title="My Contacts" onClick={() => push('contacts', {}, 'profile')} />
              </div>
              <div class="sgroup">
                {profiles.value.map((x) => (
                  <button class="srow" onClick={() => x.id !== p.id && setActiveProfile(x.id)}>
                    <Avatar card={x} size={28} />
                    <span class="grow ellipsis">{x.displayName} <span class="srow__value">· {x.type === 'business' ? 'Business' : 'Creator'}</span></span>
                    {x.id === p.id ? <img class="srow__caret" style={{ opacity: 1 }} src={icon('IconCheckActive')} alt="Current" /> : <img class="srow__caret" src={icon('IconCaretRight')} alt="" />}
                  </button>
                ))}
                {!hasCreator && <Row iconName="IconAddAccount" title="Add creator account" onClick={() => setAdding('creator')} />}
                {businessCount < 5 && <Row iconName="IconAddAccount" title="Add business account" value={`${businessCount}/5`} onClick={() => setAdding('business')} />}
              </div>
              <div class="sgroup">
                <Row iconName="IconQuestion" title="Help & Support" onClick={() => { window.location.href = 'mailto:mlkdesignweb@gmail.com?subject=KOLABA%20help'; }} />
                <Row iconName="IconInfo" title="About" onClick={() => setPage('about')} />
              </div>
              <div class="sgroup is-danger">
                <Row iconName="IconSignOut" title="Log out" danger onClick={() => confirmSheet('Log out?', 'Sign in again to see your profile, jobs and messages.', 'Log out', () => void signOut(), true)} />
              </div>
              <div class="center muted" style={{ fontSize: 12, marginTop: 8 }}>{user.value?.email}</div>
            </>
          )}
          {page === 'privacy' && (me?.settings ? (
            <div class="sgroup">
              <ToggleRow title="Show location" detail="Your city on your profile and cards" on={me.settings.showLocation} onChange={(v) => setting('showLocation', v)} />
              <ToggleRow title="Show social links" on={me.settings.showLinks} onChange={(v) => setting('showLinks', v)} />
              <Row title="Who can message me" value={{ everyone: 'Everyone', contacts: 'Contacts', nobody: 'Nobody' }[me.settings.whoCanMessage]}
                onClick={() => pickSheet('Who can message me', [['everyone', 'Everyone'], ['contacts', 'Contacts'], ['nobody', 'Nobody']], me.settings!.whoCanMessage as any, (v) => setting('whoCanMessage', v))} />
              {me.type === 'business' && <ToggleRow title="Hide my job posts" on={me.settings.hideJobPosts} onChange={(v) => setting('hideJobPosts', v)} />}
            </div>
          ) : <Spinner />)}
          {page === 'language' && (
            <>
              <div class="sgroup"><button class="srow"><span class="grow">English</span><img class="srow__caret" style={{ opacity: 1 }} src={icon('IconCheckActive')} alt="Selected" /></button></div>
              <div class="muted" style={{ fontSize: 13, margin: '10px 16px' }}>The web version is in English for now.</div>
            </>
          )}
        </div>
        <div style={{ height: 40 }} />
      </div>
      <Header left={<BackButton onClick={goBack} />} center={<HeaderTitle title={title} />}
        right={page === 'main' ? <GlassButton name="IconDotsThree" label="More" onClick={more} /> : null} />
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
      <div class="scroll"><div class="section-top" />
        {error ? <Empty title="Invite not available" text={errorText(error)} /> : !data ? <Spinner /> : (
          <div class="pad center">
            <div style={{ display: 'grid', placeItems: 'center', margin: '20px 0' }}><Avatar card={data.recipient} size={88} /></div>
            <h2 style={{ margin: '0 0 6px' }}>{data.recipient.displayName}</h2>
            <p class="muted">asks you for a review. Accepting adds you to each other's contacts; then you can leave one review.</p>
            <button class="btn" onClick={accept}>Accept and write a review</button>
          </div>
        )}
      </div>
      <Header left={<BackButton />} center={<HeaderTitle title="Review invite" />} />
    </>
  );
}
