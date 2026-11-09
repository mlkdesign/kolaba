// My Profile and public profiles (MyProfileView / VisitorProfileView): the 400 pt photo under the status bar with the
// animated glow, name + PRO, figures, actions, social circles, Portfolio / Reviews; edit, settings, collections, the
// review request sheet, the review form and the invite landing.
import { useEffect, useRef, useState } from 'preact/hooks';
import { LocationField, placeFields, placeOf, type Place } from '../location';
import { analyticsAllowed, setAnalyticsAllowed } from '../analytics';
import { api, Card, del, errorText, get, Job, Media, patch, post, posterFrom, ProfilePage, put, Review, uploadFile } from '../api';
import { activeProfile, back, isBusiness, openSheet, profiles, push, refresh, refreshTick, reloadSession, setActiveProfile, showToast, signOut, signOutLocally, user } from '../state';
import { ProfileGlow } from '../fx';
import { openPaywall } from '../paywall';
import { offerRoleSwitch } from '../roles';
import {
  BASE, Avatar, BackButton, confirmSheet, Empty, fmtCount, GlassButton, gradientFor, Header, HeaderTitle, Icon, icon, initials, MediaTile,
  openViewer, Gallery, Dots, PageTabs, ProBadge, SheetFrame, Spinner, StarIcon, Stars, SwipePages, timeAgo, useLoad, usePullToRefresh, alertDialog, pickSheet, useCollapsingHeader, TopBlur, PinnedTabs, InHeader, Subtab, SortButton, AddButton, ActionPill,
} from '../ui';
import { JobCard } from './jobs';
import { CreateProfile, Legal } from './auth';

const SOCIAL_ICON: Record<string, string> = { instagram: 'SocialInstagramColor', tiktok: 'SocialTikTokColor', youtube: 'SocialYouTubeColor', pinterest: 'SocialPinterestColor' };
export function ProfileScreen({ id, tab: initialTab }: { id?: string; tab?: 'reviews' }) {
  const profileId = id ?? activeProfile.value?.id;
  const { data: p, error, reload } = useLoad<ProfilePage>((s) => get(`/v1/profiles/${profileId}`, s), [profileId, refreshTick.value]);
  const own = !id || !!p?.isOwner;
  const [tabIndex, setTabIndex] = useState(initialTab === 'reviews' ? 1 : 0);
  const viewed = useRef(false);
  const { scroller, Indicator } = usePullToRefresh(() => reload(), [!!p]);
  // FIX 109: the profile's tabs follow the scroll freely (no snapping) and pin at 62 pt, moving in over 60 pt.
  const { root, changeTab } = useCollapsingHeader({ distance: 100000, insetTravel: 60, snap: false }, scroller, [!!p]);
  const pick = (i: number) => changeTab(tabIndex, i, () => setTabIndex(i));
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
  const tabs = business ? ['Job posts', 'Reviews', 'About'] : ['Portfolio', 'Reviews'];
  return (
    <div class={`collapsing ${business ? 'is-business-profile' : ''}`} ref={root}>
      <div class="scroll" ref={scroller}>
        <TopBlur sticky />
        {/* The glow belongs to the page's top (ProfileGlow): it scrolls away with the content, under the top blur. */}
        {p.isPro && <ProfileGlow business={business} />}
        {business ? <BusinessHeader p={p} own={own} /> : (
          <>
            <Hero p={p} own={own} />
            <div class="pinfo">
              <div class="pinfo__block">
                <div class="pname"><span>{p.displayName}</span><ProBadge card={p} /></div>
                <div class="pmeta">
                  {p.location ? <span>{p.flag} {p.location}</span>
                    : own ? <button class="padd-link" onClick={() => push('profile-edit', {}, 'profile')}><img src={icon('IconMapPin')} alt="" /><u>Add location</u></button>
                    : <span style={{ opacity: .5 }}>Location not specified</span>}
                </div>
                {p.bio ? <Bio text={p.bio} /> : own ? (
                  <button class="padd-bio" onClick={() => push('profile-edit', {}, 'profile')}>Tell people about yourself and what you create.  <u>Add bio</u></button>
                ) : null}
              </div>
              <Figures p={p} />
              {own ? <OwnerActions p={p} /> : <VisitorActions profile={p} />}
              <Socials p={p} own={own} />
            </div>
          </>
        )}
        <PinnedTabs class="ptab-bar" style={{ marginTop: 22 }}>
          <PageTabs tabs={tabs} index={tabIndex} onChange={pick} profile counts={[undefined, p.ratings?.count || undefined]} />
        </PinnedTabs>
        <SwipePages index={tabIndex} onChange={pick}>
          {business ? <BusinessJobs profile={p} own={own} /> : <Portfolio profile={p} own={own} onChange={reload} />}
          <Reviews profile={p} own={own} />
          {business ? <BusinessAbout p={p} own={own} /> : null}
        </SwipePages>
        <div style={{ height: own ? 'var(--tabbar-clear)' : 40 }} />
      </div>
      <Indicator />
      <Header left={left} right={right} blur={false} />
    </div>
  );
}

// ─── Business profile (BusinessProfileHeader, Figma 770:5495 / 770:6286): its own top — no 400 pt photo, no intro
// video, no networks row (FIX 94: a business's links are in About) ───

function BusinessHeader({ p, own }: { p: ProfilePage; own: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <div class="bheader">
      <div class="blogo" style={{ background: p.avatarUrl && !broken ? '#1a1a1a' : gradientFor(p.displayName) }}>
        {p.avatarUrl && !broken ? <img src={p.avatarUrl} alt="Logo" onError={() => setBroken(true)} /> : <span>{initials(p.displayName)}</span>}
      </div>
      <div class="bheader__info">
        <div class="bheader__name"><span>{p.displayName}</span><ProBadge card={p} /></div>
        {p.location ? <div class="bheader__place">{p.flag} {p.location}</div>
          : own ? <button class="bheader__add" onClick={() => push('profile-edit', {}, 'profile')}>Add location</button>
          : <div class="bheader__place" style={{ opacity: .5 }}>Location not specified</div>}
      </div>
      {p.bio ? <BusinessBio text={p.bio} /> : own ? (
        <button class="bheader__hint" onClick={() => push('profile-edit', {}, 'profile')}>
          Tell creators about your business and what you're looking for.  <u>Add description</u></button>
      ) : null}
      <div style={{ alignSelf: 'stretch' }}><Figures p={p} /></div>
      <div style={{ alignSelf: 'stretch' }}>{own ? <OwnerActions p={p} /> : <VisitorActions profile={p} />}</div>
    </div>
  );
}

function BusinessBio({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 140;
  return (
    <div class="bheader__bio selectable">
      <span class={!open && long ? 'lines-3' : ''} style={{ display: !open && long ? '-webkit-box' : 'block' }}>{text}</span>
      {long && !open && <button class="show-more" onClick={() => setOpen(true)}>Show more</button>}
    </div>
  );
}

/** A business's Job Posts (Figma 770:5638): Active · Archive (the chosen one blue with its count) and Sort, then the
 *  jobs as the feed shows them. Active: published and open (and the owner's drafts); Archive: closed or past deadline. */
function BusinessJobs({ profile, own }: { profile: ProfilePage; own: boolean }) {
  const { data } = useLoad<{ items: Job[] }>((s) => get(`/v1/profiles/${profile.id}/jobs`, s), [profile.id, refreshTick.value]);
  const [filter, setFilter] = useState<'active' | 'past'>('active');
  const [newest, setNewest] = useState(true);
  if (!data) return <Spinner />;
  if (profile.hideJobPosts && !own) return <Empty title="Job posts are hidden" />;
  const isPast = (j: Job) => j.status === 'closed' || (j.deadline != null && j.deadline < Date.now());
  const active = data.items.filter((j) => !isPast(j) && (j.status === 'published' || own));
  const past = data.items.filter(isPast);
  const list = (filter === 'active' ? active : past).sort((a, b) => (newest ? 1 : -1) * ((b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt)));
  return (
    <>
      <div class="mfilter">
        <Subtab label="Active" count={active.length} on={filter === 'active'} onClick={() => setFilter('active')} />
        <Subtab label="Archive" count={past.length} on={filter === 'past'} onClick={() => setFilter('past')} />
        <span class="grow" />
        <SortButton flipped={!newest} onClick={() => setNewest(!newest)} />
      </div>
      {!list.length ? (
        filter === 'active'
          ? (own ? <Empty title="You haven't posted any jobs yet."><ActionPill label="Create new job" onClick={() => push('job-editor', {}, 'jobs')} /></Empty> : <Empty title="No active jobs right now." />)
          : <Empty title="No closed jobs yet." />
      ) : <div class="feed" style={{ paddingTop: 0 }}>{list.map((j, i) => <div key={j.id}>{i > 0 && <div style={{ height: 1, background: 'var(--separator)', margin: '20px 0' }} />}<JobCard job={j} /></div>)}</div>}
    </>
  );
}

/** A business's About (FEATURE 19 / FIX 106): Description, Location, then its links. */
function BusinessAbout({ p, own }: { p: ProfilePage; own: boolean }) {
  const empty = profileContacts(p).isEmpty;
  return (
    <div class="babout">
      <section><h3>Description</h3>{p.bio ? <p class="selectable">{p.bio}</p> : <p class="is-empty">{own ? 'Add a description of your business in Edit profile.' : 'No description yet.'}</p>}</section>
      <section><h3>Location</h3>{p.location ? <p>{p.flag} {p.location}</p> : <p class="is-empty">Location not specified</p>}</section>
      {!empty ? <ContactsList p={p} contactTitle="Contacts" /> : own ? <Socials p={p} own /> : null}
    </div>
  );
}

/** A creator's profile photos (up to 10; the profile's current photo first), newest after it. */
function useProfilePhotos(p: ProfilePage) {
  const { data, reload } = useLoad<{ items: Media[] }>((sig) => get(`/v1/profiles/${p.id}/media?purpose=avatar&kind=photo`, sig), [p.id, p.avatarUrl, refreshTick.value]);
  const items = data?.items ?? [];
  const current = items.find((m) => m.url && m.url === p.avatarUrl);
  const photos = current ? [current, ...items.filter((m) => m !== current)] : items;
  // An older profile whose photo isn't among its uploads (an external demo photo) still shows it.
  return { photos: photos.length ? photos : p.avatarUrl ? [{ id: 'avatar', url: p.avatarUrl, kind: 'photo' } as Media] : [], loaded: !!data, reload };
}

/** Uploads picked photos as profile photos (each up to the 10's room); the first becomes the profile photo when there
 *  is none. A business has one photo: a new one replaces it. */
async function addProfilePhotos(p: ProfilePage, files: File[], have: number) {
  const business = p.type === 'business';
  const room = business ? 1 : Math.max(0, 10 - have);
  if (!room) { alertDialog('Limit reached', 'You can add up to 10 profile photos.', 'OK', () => {}, false); return; }
  const picked = files.slice(0, room);
  try {
    showToast(picked.length > 1 ? `Uploading ${picked.length} photos…` : 'Uploading photo…');
    let first: Media | null = null;
    for (const f of picked) { const m = await uploadFile(f, 'avatar'); first ??= m; }
    if (first && (business || !p.avatarUrl)) await patch(`/v1/profiles/${p.id}`, { avatarMediaId: first.id });
    await reloadSession(); refresh(); showToast(business ? 'Logo updated' : picked.length > 1 ? 'Photos added' : 'Photo added', 'ok');
    if (files.length > room) alertDialog('Limit reached', 'You can add up to 10 profile photos.', 'OK', () => {}, false);
  } catch (e) { showToast(errorText(e), 'error'); }
}

function Hero({ p, own }: { p: ProfilePage; own: boolean }) {
  const [broken, setBroken] = useState(false);
  const [index, setIndex] = useState(0);
  const introInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const { photos, loaded } = useProfilePhotos(p);
  const canIntro = own && p.type === 'creator' && p.entitlements?.introVideo === 'available';
  const intro = p.introVideo;
  const empty = loaded && !photos.length;
  return (
    <div class={`phero ${empty && own ? 'is-empty' : ''}`}>
      {photos.length > 0 && !broken ? (
        <Gallery media={photos} class="phero__gallery" dots={false} onIndex={setIndex} onOpen={(m) => openViewer(m)} />
      ) : empty && own ? null : (
        <div class="phero__track">{p.avatarUrl && !broken ? <img src={p.avatarUrl} alt="" draggable={false} onError={() => setBroken(true)} />
          : <div class="phero__mono" style={{ background: gradientFor(p.displayName) }}>{initials(p.displayName)}</div>}</div>
      )}
      {photos.length > 1 && <InHeader><div class="phero__dots"><Dots count={photos.length} index={index} /></div></InHeader>}
      <div class="phero__shade" />
      {empty && own && (
        <div class="phero__add">
          <ActionPill label="Add Profile Photos" onClick={() => photoInput.current?.click()} />
          <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
            onChange={(e) => { const f = [...(e.currentTarget.files ?? [])]; if (f.length) void addProfilePhotos(p, f, 0); e.currentTarget.value = ''; }} />
        </div>
      )}
      {intro ? (
        <button class="glass intro-pill is-tinted" onClick={() => openViewer(intro)}><span class="play"><img src={icon('IconPlay')} alt="" /></span>Intro Video</button>
      ) : own && p.type === 'creator' && p.entitlements?.introVideo === 'locked' ? (
        <button class="glass intro-pill" onClick={() => openPaywall('introVideo')}><span class="play"><img src={icon('IconPlay')} alt="" /></span>Add Intro Video</button>
      ) : canIntro ? (
        <>
          <button class="glass intro-pill" onClick={() => introInput.current?.click()}><span class="play"><img src={icon('IconPlay')} alt="" /></span>Add Intro Video</button>
          <input ref={introInput} type="file" accept="video/mp4,video/quicktime" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void uploadIntro(p, f); e.currentTarget.value = ''; }} />
        </>
      ) : null}
    </div>
  );
}

function StripImage({ m, name }: { m: Media; name: string }) {
  const [broken, setBroken] = useState(false);
  return m.url && !broken ? <img src={m.url} alt="" draggable={false} onError={() => setBroken(true)} />
    : <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 800, background: gradientFor(name) }}>{initials(name)}</span>;
}

/** Edit profile's photo strip (ProfileSetupView.photoStrip): 80 pt tiles, radius 12, the first is the profile photo;
 *  a tap offers Make profile photo / Remove; + while there is room. A business: its one Logo, + replaces it. */
function PhotoStrip({ p }: { p: ProfilePage }) {
  const { photos, reload } = useProfilePhotos(p);
  const input = useRef<HTMLInputElement>(null);
  const business = p.type === 'business';
  const limit = business ? 1 : 10;
  const shown = business ? photos.slice(0, 1) : photos;
  const menu = (m: Media, i: number) => openSheet((close) => (
    <SheetFrame title={business ? 'Logo' : 'Profile photo'} close={close}>
      {!business && i > 0 && <button class="menu-item" onClick={async () => { close(); try { await patch(`/v1/profiles/${p.id}`, { avatarMediaId: m.id }); await reloadSession(); refresh(); reload(); } catch (e) { showToast(errorText(e), 'error'); } }}>
        <Icon name="IconUser" />Make profile photo</button>}
      {business && <button class="menu-item" onClick={() => { close(); input.current?.click(); }}><Icon name="IconArrowsClockwise" />Replace logo</button>}
      {m.id !== 'avatar' && <button class="menu-item is-danger" onClick={() => { close(); confirmSheet(business ? 'Remove logo?' : 'Remove photo?', 'It will be removed from your profile.', 'Remove', async () => {
        try {
          await del(`/v1/media/${m.id}`);
          const next = photos.find((x) => x.id !== m.id && x.id !== 'avatar');
          if (i === 0 && next) await patch(`/v1/profiles/${p.id}`, { avatarMediaId: next.id });
          await reloadSession(); refresh(); reload();
        } catch (e) { showToast(errorText(e), 'error'); }
      }, true); }}><Icon name="IconTrash" />Remove</button>}
    </SheetFrame>
  ));
  return (
    <div>
      <div class="row" style={{ justifyContent: 'space-between' }}><span class="label">{business ? 'Logo' : 'Profile photos'}</span>
        <span class="label" style={{ color: '#fff' }}>{shown.length} <span class="muted">/ {limit}</span></span></div>
      <div class="photo-strip" data-hscroll>
        {shown.map((m, i) => (
          <button class="photo-strip__tile" aria-label={i === 0 ? 'Profile photo' : `Photo ${i + 1}`} onClick={() => menu(m, i)}>
            <StripImage m={m} name={p.displayName} />{i === 0 && !business && shown.length > 1 && <span class="photo-strip__main">Main</span>}
          </button>
        ))}
        {(business || shown.length < limit) && (
          <button class="photo-strip__tile is-add" aria-label={business && shown.length ? 'Replace logo' : 'Add photo'} onClick={() => input.current?.click()}><Icon name="IconPlus" size={20} /></button>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple={!business} hidden
        onChange={async (e) => { const f = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; if (f.length) { await addProfilePhotos(p, f, business ? 0 : shown.filter((x) => x.id !== 'avatar').length); reload(); } }} />
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

/** Collabs | Rating | Contacts (ProfileFiguresRow, FEATURE 20/23): Collabs are the reviews the profile received (one
 *  per finished collaboration); Rating "–" without any. */
function Figures({ p }: { p: ProfilePage }) {
  const rating = p.ratings?.count ? p.ratings.rating! : null;
  return (
    <div class="stats">
      <div class="stats__cell"><b>{fmtCount(p.ratings?.count ?? 0)}</b><span>Collabs</span></div>
      <div class="stats__cell"><b>{rating ? rating.toFixed(1) : '–'}{rating && <StarIcon size={16} />}</b><span>Rating</span></div>
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

// ─── Links & Contact (KolabaContactsSheet / ProfileContacts, FEATURE 22): one list per profile, nothing twice ───

interface ContactItem { id: string; kind: string; title: string; subtitle: string | null; followers: number | null; url: string | null }
const PLATFORM_TITLE: Record<string, string> = { instagram: 'Instagram', youtube: 'YouTube', pinterest: 'Pinterest', tiktok: 'TikTok' };
const handleOf = (url: string) => {
  try { const parts = new URL(url).pathname.split('/').filter((x) => x && !['c', 'user', 'channel'].includes(x.toLowerCase())); const n = parts[parts.length - 1]?.replace(/^@/, ''); return n ? `@${n}` : null; }
  catch { return null; }
};
const safeWeb = (url: string) => { try { const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); return u.hostname ? u.href : null; } catch { return null; } };
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** Social Media (Instagram · YouTube · Pinterest · TikTok — a platform once, with its link and followers),
 *  Contact (Telegram · WhatsApp · Email) and More Links (websites, each address once). */
function profileContacts(p: ProfilePage) {
  const links = p.links ?? [];
  const linkOf = (kind: string) => links.find((l) => l.kind === kind)?.url ?? null;
  const social: ContactItem[] = ['instagram', 'youtube', 'pinterest', 'tiktok'].flatMap((platform) => {
    const stat = p.socialAccounts.find((x) => x.platform === platform);
    const raw = linkOf(platform);
    if (!stat && !raw) return [];
    const url = raw ? safeWeb(raw) : null;
    return [{ id: platform, kind: platform, title: PLATFORM_TITLE[platform], subtitle: url ? handleOf(url) : null, followers: stat?.followers ?? null, url }];
  });
  const contact: ContactItem[] = [];
  const tg = linkOf('telegram');
  if (tg) { const url = safeWeb(tg.startsWith('@') ? `t.me/${tg.slice(1)}` : tg.includes('/') || tg.includes('.') ? tg : `t.me/${tg}`); contact.push({ id: 'telegram', kind: 'telegram', title: 'Telegram', subtitle: url ? handleOf(url) : tg, followers: null, url }); }
  const wa = linkOf('whatsapp');
  if (wa) { const digits = (wa.match(/phone=(\d+)/)?.[1] ?? wa).replace(/\D/g, ''); contact.push({ id: 'whatsapp', kind: 'whatsapp', title: 'WhatsApp', subtitle: digits.length >= 6 ? `+${digits}` : null, followers: null, url: digits.length >= 6 ? `https://wa.me/${digits}` : safeWeb(wa) }); }
  const mail = linkOf('email');
  if (mail) { const address = mail.replace(/^mailto:/i, '').split('?')[0]; if (/^[^\s@]+@[^\s@]+$/.test(address)) contact.push({ id: 'email', kind: 'email', title: 'Email', subtitle: address, followers: null, url: `mailto:${address}` }); }
  const seen = new Set<string>();
  const more: ContactItem[] = [p.website, linkOf('website')].flatMap((raw) => {
    const url = raw ? safeWeb(raw) : null;
    if (!url || seen.has(hostOf(url) + new URL(url).pathname.replace(/\/$/, ''))) return [];
    seen.add(hostOf(url) + new URL(url).pathname.replace(/\/$/, ''));
    return [{ id: `link-${url}`, kind: 'website', title: 'Website', subtitle: hostOf(url), followers: null, url }];
  });
  return { social, contact, more, isEmpty: !social.length && !contact.length && !more.length };
}

/** A row's 40 pt mark: the networks' own marks; YouTube / TikTok glyphs on red / black; Email and links white on 20 %. */
function ContactIcon({ kind }: { kind: string }) {
  const own: Record<string, string> = { instagram: 'ContactInstagram', pinterest: 'ContactPinterest', telegram: 'ContactTelegram', whatsapp: 'ContactWhatsApp' };
  if (own[kind]) return <img class="cicon" src={icon(own[kind])} alt="" />;
  if (kind === 'youtube') return <span class="cicon" style={{ background: '#f00' }}><img src={icon('ContactYouTubeGlyph')} alt="" style={{ width: 20, height: 13.333 }} /></span>;
  if (kind === 'tiktok') return <span class="cicon" style={{ background: '#000' }}><img src={icon('ContactTikTokGlyph')} alt="" style={{ width: 17.647, height: 20 }} /></span>;
  return <span class="cicon" style={{ background: 'rgba(255,255,255,.2)' }}><img src={icon(kind === 'email' ? 'ContactEmail' : 'ContactLink')} alt="" style={{ width: 20, height: 20 }} /></span>;
}

function ContactsList({ p, contactTitle = 'Contact' }: { p: ProfilePage; contactTitle?: string }) {
  const c = profileContacts(p);
  const section = (title: string, items: ContactItem[]) => items.length ? (
    <section class="clist__section">
      <h3>{title}</h3>
      <div class="clist__group">
        {items.map((it, i) => (
          <>{i > 0 && <i class="clist__sep" />}
            <a class={`clist__row ${it.url ? '' : 'is-dead'}`} href={it.url ?? undefined} target={it.url?.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer nofollow">
              <ContactIcon kind={it.kind} />
              <span class="grow clist__text"><b>{it.title}</b>{it.subtitle && <span>{it.subtitle}</span>}</span>
              {it.followers != null && <span class="clist__count"><b>{fmtCount(it.followers)}</b><span>Followers</span></span>}
              <img class="clist__caret" src={icon('IconCaretRight')} alt="" />
            </a>
          </>
        ))}
      </div>
    </section>
  ) : null;
  return <div class="clist">{section('Social Media', c.social)}{section(contactTitle, c.contact)}{section('More Links', c.more)}</div>;
}

function openLinks(p: ProfilePage) {
  openSheet((close) => (
    <SheetFrame title="Links & Contact" close={close}>
      {profileContacts(p).isEmpty ? <Empty title="No links yet" /> : <ContactsList p={p} />}
      <div style={{ height: 24 }} />
    </SheetFrame>
  ), { tall: true });
}

/** The networks row (each platform once, its followers or its name), a business's Web Site, All Links; the owner
 *  without any link gets the Add links card (Figma 707:4025), someone else nothing. */
function Socials({ p, own }: { p: ProfilePage; own: boolean }) {
  const c = profileContacts(p);
  if (c.isEmpty) {
    return own ? (
      <div class="links-empty">
        <p>Add your social media, website or messenger links so others can connect with you.</p>
        <ActionPill label="Add links" iconName="IconLink" onClick={() => push('profile-edit', {}, 'profile')} />
      </div>
    ) : null;
  }
  const web = p.type === 'business' ? c.more[0] : undefined;
  return (
    <div class="socials" data-hscroll>
      {c.social.map((s) => {
        const body = <><span class="social__circle"><img src={icon(SOCIAL_ICON[s.kind] ?? 'ContactLink')} alt="" /></span>{s.followers != null ? fmtCount(s.followers) : s.title}</>;
        return s.url ? <a class="social" href={s.url} target="_blank" rel="noopener noreferrer nofollow" aria-label={s.title}>{body}</a>
          : <span class="social" aria-label={s.title}>{body}</span>;
      })}
      {web && <a class="social" href={web.url!} target="_blank" rel="noopener noreferrer nofollow"><span class="social__circle"><img src={icon('IconGlobeSimple')} alt="" style={{ width: 24, height: 24 }} /></span>Web Site</a>}
      <button class="social" onClick={() => openLinks(p)}><span class="social__circle is-filled"><img src={icon('IconLink')} alt="" /></span>All Links</button>
    </div>
  );
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
  const cols = useLoad<{ items: unknown[] }>((s) => get(`/v1/profiles/${profile.id}/collections`, s), [profile.id, refreshTick.value]);
  const colCount = cols.data?.items.length;
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
        <Subtab label="All" count={data?.items.length ?? 0} on={mode === 'all'} onClick={() => setMode('all')} />
        <Subtab label="Collections" count={colCount ?? undefined} on={mode === 'collections'} locked={own && profile.entitlements?.collections === 'locked'}
          onClick={() => (own && profile.entitlements?.collections === 'locked' ? openPaywall('collections') : setMode('collections'))} />
        <span class="grow" />
        <SortButton flipped={!newest} onClick={() => setNewest(!newest)} />
        {own && items.length > 0 && <AddButton label="Add content" busy={progress !== null ? `${Math.round(progress * 100)}%` : null} onClick={() => input.current?.click()} />}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" hidden
          onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void upload(f); e.currentTarget.value = ''; }} />
      </div>
      {mode === 'collections' ? <Collections profile={profile} own={own} /> : !data ? <Spinner /> : !items.length ? (
        own ? <Empty cards="media" title="Your portfolio is empty" text="Add photos and videos to showcase your work and let others discover your creativity.">
          <ActionPill label={progress !== null ? `Uploading ${Math.round(progress * 100)}%` : 'Add content'} onClick={() => input.current?.click()} /></Empty>
          : <Empty cards="media" title="No portfolio yet." />
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
      ) : null}
      {data.items.length > 0 && <div class="rdivider" />}
      {data.items.length > 0 && (
        <div class="rlist__head"><span>Reviews</span><span class="ptabs__count">{data.items.length}</span><span class="grow" />
          <SortButton onClick={sortSheet} /></div>
      )}
      {!data.items.length ? (
        <Empty title="No reviews yet" text={own ? 'Ask your contacts for a review — it will appear here.' : "Reviews from this profile's contacts will appear here."}>
          {own && <button class="action-pill is-outline" onClick={() => openRequestReview()}>Request a review</button>}
        </Empty>
      ) :
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

const LINK_KINDS = ['instagram', 'youtube', 'tiktok', 'telegram', 'whatsapp', 'email'] as const;
type LinkKind = typeof LINK_KINDS[number];

export function EditProfileScreen() {
  const { data: p } = useLoad<ProfilePage>((s) => get(`/v1/profiles/${activeProfile.value!.id}`, s), [activeProfile.value?.id]);
  if (!p) return <><Header left={<BackButton />} center={<HeaderTitle title="Edit Profile" />} /><div class="section-top"><Spinner /></div></>;
  return <EditForm p={p} />;
}

function EditForm({ p }: { p: ProfilePage }) {
  const [place, setPlace] = useState<Place | null>(placeOf(p));
  const [form, setForm] = useState({ displayName: p.displayName, username: p.username, bio: p.bio, website: p.website ?? p.links.find((l) => l.kind === 'website')?.url ?? '', ...Object.fromEntries(LINK_KINDS.map((k) => [k, p.links.find((l) => l.kind === k)?.url ?? ''])) as Record<LinkKind, string> });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: any) => setForm({ ...form, [k]: e.currentTarget.value });
  const save = async () => {
    setBusy(true);
    try {
      const links: Record<string, string> = {};
      if (form.website) links.website = form.website;
      for (const k of LINK_KINDS) if (form[k].trim()) links[k] = form[k].trim();
      await patch(`/v1/profiles/${p.id}`, { displayName: form.displayName, username: form.username, bio: form.bio, ...placeFields(place),
        website: form.website || null, links });
      await reloadSession(); refresh(); showToast('Saved', 'ok'); back();
    } catch (e) { showToast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const field = (k: keyof typeof form, label: string, iconName: string, placeholder = '') => (
    <div><span class="label">{label}</span><label class="field"><img src={icon(iconName)} alt="" /><input value={form[k]} placeholder={placeholder || label} onInput={set(k)} /></label></div>
  );
  return (
    <>
      <div class="scroll">
        <div class="section-top pad" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 'calc(var(--header-h) + 16px)', paddingBottom: 120 }}>
          {field('displayName', p.type === 'business' ? 'Business name' : 'Your name', 'IconUser')}
          <PhotoStrip p={p} />
          <div><span class="label">Username</span><label class="field"><img src={icon('IconUser')} alt="" /><input value={form.username} placeholder="Username"
            onInput={(e) => setForm({ ...form, username: e.currentTarget.value.toLowerCase().replace(/[^a-z0-9._]/g, '') })} />
            {/^[a-z0-9._]{3,30}$/.test(form.username) && <img src={icon('IconCheckActive')} alt="Valid" style={{ opacity: 1 }} />}</label></div>
          <div><span class="label">Your location</span><LocationField value={place} onChange={setPlace} /></div>
          <div><div class="row" style={{ justifyContent: 'space-between' }}><span class="label">Profile description</span>
            <span class="label" style={{ color: '#fff' }}>{form.bio.length} <span class="muted">/ 1000</span></span></div>
            <textarea class="textarea" maxLength={1000} value={form.bio} onInput={set('bio')} style={{ minHeight: 160 }} /></div>
          {field('website', 'Website', 'IconGlobeSimple', 'example.com')}
          <span class="label" style={{ marginBottom: -8 }}>Social media</span>
          {field('instagram', 'Instagram', 'IconInstagram', 'instagram.com/yourname')}
          {field('youtube', 'YouTube', 'IconYouTube', 'youtube.com/@yourname')}
          {field('tiktok', 'TikTok', 'IconTikTok', 'tiktok.com/@yourname')}
          <span class="label" style={{ marginBottom: -8 }}>Contact</span>
          {field('telegram', 'Telegram', 'IconTelegram', '@yourname')}
          {field('whatsapp', 'WhatsApp', 'IconWhatsApp', '+380 …')}
          {field('email', 'Email', 'IconEnvelopeSimple', 'you@example.com')}
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

/** SettingsToggleRow: an optional 16 pt icon, the title (15) and its detail (12, 50 %), the iOS switch at the end;
 *  50 pt, 10 pt above and below with a detail. */
const ToggleRow = ({ title, detail, on, onChange, iconName, disabled }: { title: string; detail?: string; on: boolean; onChange: (v: boolean) => void; iconName?: string; disabled?: boolean }) => (
  <button class={`srow ${detail ? 'has-detail' : ''}`} role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}>
    {iconName && <img class="srow__icon-white" src={icon(iconName)} alt="" />}
    <span class="grow"><span style={{ display: 'block' }}>{title}</span>{detail && <span class="srow__detail">{detail}</span>}</span>
    <span class={`toggle ${on ? 'is-on' : ''}`} />
  </button>
);

/** This browser's consent to usage analytics (Microsoft Clarity): kept on this device only, applied at once. */
function AnalyticsToggle() {
  const [on, setOn] = useState(analyticsAllowed());
  return (
    <>
      <div class="sgroup" style={{ marginTop: 12 }}>
        <ToggleRow title="Usage analytics" detail="Anonymous screen and tap recordings (Microsoft Clarity) help us improve KOLABA. Passwords, codes, messages and forms are always masked."
          on={on} onChange={(v) => { setOn(v); setAnalyticsAllowed(v); }} />
      </div>
    </>
  );
}

/** SettingsView (Figma 654:18389): the account card; Notifications · Privacy & Safety · Language; Switch to Business /
 *  Creator Account; creator.pro / business.pro (Testing) for allowed testers; Help & Support · About; Log out. ⋯: Delete
 *  account. Every row opens its page or does its action. */
export function SettingsScreen() {
  const [page, setPage] = useState<'main' | 'notifications' | 'privacy' | 'language' | 'about'>('main');
  const { data: me, reload } = useLoad<ProfilePage>((s) => get(`/v1/profiles/${activeProfile.value!.id}`, s), [activeProfile.value?.id, refreshTick.value]);
  const p = activeProfile.value!;
  const setting = async (key: string, value: unknown) => {
    try { await patch(`/v1/profiles/${p.id}`, { settings: { [key]: value } }); reload(); } catch (e) { showToast(errorText(e), 'error'); }
  };
  const goBack = page === 'main' ? undefined : () => setPage('main');
  const deleteAccount = () => alertDialog('Delete account?',
    'Your account and all its data will be permanently deleted: profiles, media, jobs, applications, contacts and reviews. This action cannot be undone.',
    'Delete account', async () => {
      try { await api('DELETE', '/v1/me', { confirm: 'DELETE' }); signOutLocally(); showToast('Your account was deleted', 'ok'); }
      catch (e) { showToast(errorText(e), 'error'); }
    });
  const more = () => openSheet((close) => (
    <SheetFrame title="Settings" close={close}>
      <button class="menu-item is-danger" onClick={() => { close(); deleteAccount(); }}><img src={icon('IconTrash')} alt="" />Delete account</button>
    </SheetFrame>
  ));
  const other = profiles.value.find((x) => x.type !== p.type);
  const switchType = () => {
    if (other) { setActiveProfile(other.id); return; }
    push('create-profile', { type: p.type === 'creator' ? 'business' : 'creator' });
  };
  // The switch moves at once; the server decides — on an error it goes back to what the server has.
  const [proShown, setProShown] = useState<boolean | null>(null);
  const [proBusy, setProBusy] = useState(false);
  const togglePro = async (on: boolean) => {
    if (proBusy) return;
    setProShown(on); setProBusy(true);
    try { await put('/v1/me/pro-test', { pro: on }); await reloadSession(); refresh(); }
    catch (e) { showToast(errorText(e), 'error'); }
    finally { setProShown(null); setProBusy(false); }
  };
  const title = { main: 'Settings', notifications: 'Notifications', privacy: 'Privacy & Safety', language: 'Language', about: 'About' }[page];
  const canTestPro = !!(user.value as any)?.canTestPro;
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
                <Row iconName="IconBellSmall" title="Notifications" onClick={() => setPage('notifications')} />
                <Row iconName="IconShieldWarning" title="Privacy & Safety" onClick={() => setPage('privacy')} />
                <Row iconName="IconTranslateFilled" title="Language" value="English" onClick={() => setPage('language')} />
              </div>
              <div class="sgroup">
                <Row iconName={p.type === 'creator' ? 'IconTreasureChest' : 'IconUser'} title={p.type === 'creator' ? 'Switch to Business Account' : 'Switch to Creator Account'} onClick={switchType} />
              </div>
              {canTestPro && (
                <div class="sgroup">
                  <ToggleRow iconName="IconCrownSimple" title={`${p.type}.pro (Testing)`} detail="Test state for this account on the server. No purchase, no subscription." on={proShown ?? !!activeProfile.value?.isPro} onChange={togglePro} />
                </div>
              )}
              <div class="sgroup">
                <Row iconName="IconQuestion" title="Help & Support" onClick={() => { window.location.href = 'mailto:mlkdesignweb@gmail.com?subject=KOLABA%20help'; }} />
                <Row iconName="IconInfo" title="About" onClick={() => setPage('about')} />
              </div>
              <div class="sgroup is-danger">
                <Row iconName="IconSignOut" title="Log out" danger onClick={() => confirmSheet('Log out?', 'Sign in again to see your profile, jobs and messages.', 'Log out', () => void signOut(), true)} />
              </div>
            </>
          )}
          {page === 'notifications' && <NotificationSettings />}
          {page === 'privacy' && (me?.settings ? (
            <>
              <div class="sgroup">
                <Row title="Profile visibility" value={me.visibility === 'private' ? 'Private' : 'Public'}
                  onClick={() => pickSheet('Profile visibility', [['public', 'Public'], ['private', 'Private']], (me.visibility === 'private' ? 'private' : 'public') as any,
                    async (v) => { try { await patch(`/v1/profiles/${p.id}`, { visibility: v }); reload(); } catch (e) { showToast(errorText(e), 'error'); } })} />
                <ToggleRow title="Show location" on={me.settings.showLocation} onChange={(v) => setting('showLocation', v)} />
                <Row title="Who can message me" value={{ everyone: 'Everyone', contacts: 'Contacts', nobody: 'Nobody' }[me.settings.whoCanMessage]}
                  onClick={() => pickSheet('Who can message me', [['everyone', 'Everyone'], ['contacts', 'Contacts'], ['nobody', 'Nobody']], me.settings!.whoCanMessage as any, (v) => setting('whoCanMessage', v))} />
                <ToggleRow title="Show social links" on={me.settings.showLinks} onChange={(v) => setting('showLinks', v)} />
                {me.type === 'business' && <ToggleRow title="Hide my job posts" on={me.settings.hideJobPosts} onChange={(v) => setting('hideJobPosts', v)} />}
              </div>
              <div class="sgroup">
                <Row title="Report a problem" onClick={() => { window.location.href = 'mailto:mlkdesignweb@gmail.com?subject=KOLABA%20problem'; }} />
              </div>
              <div class="muted" style={{ fontSize: 13, margin: '4px 16px' }}>These settings are saved to your profile on the server.</div>
              <AnalyticsToggle />
            </>
          ) : <Spinner />)}
          {page === 'language' && (
            <>
              <div class="sgroup"><button class="srow"><span class="grow">English</span><img class="srow__caret" style={{ opacity: 1 }} src={icon('IconCheckActive')} alt="Selected" /></button></div>
              <div class="muted" style={{ fontSize: 13, margin: '10px 16px' }}>The web version is in English for now.</div>
            </>
          )}
          {page === 'about' && (
            <>
              <div class="about-head"><div class="logo" style={{ fontSize: 32, lineHeight: '45px' }}>kolaba<i>.</i></div><div class="muted">Web test version</div></div>
              <div class="sgroup">
                <Row title="Terms of Service" onClick={() => { window.open(`${BASE}terms.html`, '_blank'); }} />
                <Row title="Privacy Policy" onClick={() => { window.open(`${BASE}privacy.html`, '_blank'); }} />
                <button class="srow" disabled><span class="grow">Community Guidelines</span><span class="srow__value">Not available yet</span></button>
              </div>
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

/** SettingsNotificationsPage: Push and its four kinds (off with Push), E-mail — saved as switched, on the server. */
function NotificationSettings() {
  const { data, setData } = useLoad<{ notifications: Record<string, boolean> }>((s) => get('/v1/me/settings', s), []);
  if (!data) return <Spinner />;
  const n = data.notifications;
  const set = async (key: string, v: boolean) => {
    const next = { ...n, [key]: v };
    setData({ notifications: next });
    try { await put('/v1/me/settings', { notifications: next }); } catch (e) { setData({ notifications: n }); showToast(errorText(e), 'error'); }
  };
  const row = (key: string, title: string, sub = false) => (
    <div style={sub && !n.push ? { opacity: .5, pointerEvents: 'none' } : undefined}><ToggleRow title={title} on={n[key]} onChange={(v) => set(key, v)} /></div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div class="sgroup">
        {row('push', 'Push notifications')}
        {row('newMessages', 'New messages', true)}
        {row('projectUpdates', 'Job updates', true)}
        {row('newApplications', 'New applications', true)}
        {row('followersAndMentions', 'Followers & mentions', true)}
      </div>
      <div class="sgroup">{row('email', 'E-mail notifications')}</div>
    </div>
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
