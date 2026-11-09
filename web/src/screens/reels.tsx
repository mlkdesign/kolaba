// kolaba. — ReelsView: one vertical page per creator, their videos side by side (dots under the logo); the info panel
// (avatar, name, location, like pill, pink Follow), bio, ••• and the pink progress line above the tab bar. Only the
// video on screen plays; its neighbours preload metadata. Plus Notifications (the bell).
import { useEffect, useRef, useState } from 'preact/hooks';
import { Card, del, errorText, get, Media, Notification, post, put } from '../api';
import { activeProfile, badges, openSheet, push, refresh, refreshTick, showToast, tab } from '../state';
import { uiScale } from '../scale';
import { gradientFor, openContextMenu, openViewer, useLongPress, Avatar, BackButton, Dots, Empty, fmtCount, GlassButton, Header, HeaderTitle, Icon, icon, Logo, ProBadge, SheetFrame, Spinner, timeAgo, useLoad } from '../ui';
import { InHeader } from '../ui';

interface CreatorReels { author: Card; bio: string; isFollowing: boolean; videos: Media[] }

export function ReelsScreen() {
  const [items, setItems] = useState<CreatorReels[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [videoIndex, setVideoIndex] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState(true);
  const [onlyFollowing, setOnlyFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const load = async (more: boolean) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const page = await get<{ items: CreatorReels[]; nextCursor: string | null }>(`/v1/reels/creators?limit=6${more && cursor ? `&cursor=${cursor}` : ''}`);
      setItems((prev) => (more ? [...prev, ...page.items.filter((p) => !prev.some((x) => x.author.id === p.author.id))] : page.items));
      setCursor(page.nextCursor); setError('');
    } catch (e) { setError(errorText(e)); } finally { setLoading(false); busy.current = false; }
  };
  useEffect(() => { void load(false); }, [activeProfile.value?.id]);

  const shown = items.filter((c) => c.author.id !== activeProfile.value?.id && (!onlyFollowing || c.isFollowing) && c.videos.length);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.6) setActive(Number((e.target as HTMLElement).dataset.index));
    }, { root: el, threshold: [0.6] });
    el.querySelectorAll('.reel-creator').forEach((r) => io.observe(r));
    return () => io.disconnect();
  }, [shown.length]);
  useEffect(() => { if (active >= shown.length - 2 && cursor) void load(true); }, [active, cursor, shown.length]);

  const patchCreator = (id: string, fn: (c: CreatorReels) => CreatorReels) => setItems((all) => all.map((c) => (c.author.id === id ? fn(c) : c)));
  const setLike = async (creator: CreatorReels, m: Media) => {
    const liked = !m.isLiked;
    const apply = (isLiked: boolean, likesCount: number) => patchCreator(creator.author.id, (c) => ({ ...c, videos: c.videos.map((v) => (v.id === m.id ? { ...v, isLiked, likesCount } : v)) }));
    apply(liked, m.likesCount + (liked ? 1 : -1));
    try { const res = liked ? await put(`/v1/media/${m.id}/like`) : await del(`/v1/media/${m.id}/like`); apply(res.liked, res.likesCount); }
    catch (e) { apply(!!m.isLiked, m.likesCount); showToast(errorText(e), 'error'); }
  };
  const setFollow = async (creator: CreatorReels) => {
    const next = !creator.isFollowing;
    patchCreator(creator.author.id, (c) => ({ ...c, isFollowing: next }));
    try { next ? await put(`/v1/profiles/${creator.author.id}/follow`) : await del(`/v1/profiles/${creator.author.id}/follow`); refresh(); }
    catch (e) { patchCreator(creator.author.id, (c) => ({ ...c, isFollowing: !next })); showToast(errorText(e), 'error'); }
  };
  const filter = () => openSheet((close) => (
    <SheetFrame title="Feed" close={close}>
      {[[false, 'All creators'], [true, 'Following']].map(([v, l]) => (
        <button class="menu-item" onClick={() => { setOnlyFollowing(v as boolean); close(); root.current?.scrollTo({ top: 0 }); }}>
          <span class="grow">{l}</span>{onlyFollowing === v && <Icon name="IconCheckActive" />}</button>
      ))}
    </SheetFrame>
  ));
  const visible = tab.value === 'kolaba';
  const current = shown[active];
  return (
    <>
      <div class="reels" ref={root}>
        {loading && <div style={{ paddingTop: 260 }}><Spinner /></div>}
        {!loading && error && <div style={{ paddingTop: 160 }}><Empty title="Couldn't load the feed" text={error}><button class="btn is-small is-milky" onClick={() => load(false)}>Try again</button></Empty></div>}
        {!loading && !error && !shown.length && <div style={{ paddingTop: 160 }}><Empty title={onlyFollowing ? 'Nobody followed yet' : 'No videos yet'} text={onlyFollowing ? 'Follow creators with the pink button.' : undefined} iconName="IconPlayCircle" /></div>}
        {shown.map((c, i) => (
          <CreatorPage key={c.author.id} creator={c} index={i} active={visible && i === active} near={Math.abs(i - active) <= 1} muted={muted}
            onVideo={(v) => setVideoIndex((x) => ({ ...x, [c.author.id]: v }))}
            onLike={(m) => setLike(c, m)} onFollow={() => setFollow(c)} onToggleSound={() => setMuted(!muted)} />
        ))}
      </div>
      <div class="reel__top" />
      {current && <InHeader><div class="reel__dots"><Dots count={current.videos.length} index={videoIndex[current.author.id] ?? 0} /></div></InHeader>}
      <Header blur={false}
        left={<GlassButton name="IconSlidersHorizontal" label="Feed filter" onClick={filter} />}
        center={<Logo word="kolaba" />}
        right={<GlassButton name="IconNotificationsBell" label="Notifications" badge={badges.value.notifications} onClick={() => push('notifications')} />} />
    </>
  );
}

function CreatorPage({ creator, index, active, near, muted, onVideo, onLike, onFollow, onToggleSound }: {
  creator: CreatorReels; index: number; active: boolean; near: boolean; muted: boolean; onVideo: (i: number) => void;
  onLike: (m: Media) => void; onFollow: () => void; onToggleSound: () => void;
}) {
  const [v, setV] = useState(0);
  const [progress, setProgress] = useState(0);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const row = useRef<HTMLDivElement>(null);
  const a = creator.author;
  const media = creator.videos[v];
  const onScroll = () => {
    const el = row.current!;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== v) { setV(i); onVideo(i); setProgress(0); }
  };
  const like = (e: MouseEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHearts((h) => [...h, { id: Date.now(), x: (e.clientX - box.left) / uiScale(), y: (e.clientY - box.top) / uiScale() }]);
    if (!media.isLiked) onLike(media);
  };
  const more = () => openSheet((close) => (
    <SheetFrame title={a.displayName} close={close}>
      <button class="menu-item" onClick={() => { close(); push('profile-view', { id: a.id }); }}><img src={icon('IconUser')} alt="" />Open profile</button>
      <button class="menu-item" onClick={async () => { close(); try { const { id } = await post('/v1/conversations', { profileId: a.id }); push('conversation', { id }); } catch (err) { showToast(errorText(err), 'error'); } }}>
        <img src={icon('IconChatText')} alt="" />Message</button>
      <button class="menu-item" onClick={() => { close(); onToggleSound(); }}><img src={icon('IconSpeakerX')} alt="" />{muted ? 'Sound on' : 'Sound off'}</button>
      <button class="menu-item is-danger" onClick={async () => { close(); try { await post('/v1/reports', { targetType: 'media', targetId: media.id, reason: 'inappropriate' }); showToast('Reported — thank you', 'ok'); } catch (err) { showToast(errorText(err), 'error'); } }}>
        <img src={icon('IconShieldWarning')} alt="" />Report video</button>
    </SheetFrame>
  ));
  return (
    <section class="reel-creator" data-index={index} aria-label={`${a.displayName}'s videos`}>
      <div class="reel-h" ref={row} onScroll={onScroll} data-hscroll role="button" tabIndex={-1} aria-label={muted ? 'Sound on' : 'Sound off'}
        onClick={onToggleSound} onDblClick={like as any}>
        {creator.videos.map((m, i) => (
          <Reel key={m.id} media={m} active={active && i === v} load={near && Math.abs(i - v) <= 1} muted={muted} onProgress={i === v ? setProgress : undefined} />
        ))}
      </div>
      {hearts.map((h) => <img key={h.id} class="heart-pop" src={icon('IconHeartLiked')} alt="" style={{ left: h.x, top: h.y }} onAnimationEnd={() => setHearts((x) => x.filter((y) => y.id !== h.id))} />)}
      <div class="reel__shade" />
      <div class="reel__info">
        <div class="reel__author">
          <button onClick={() => push('profile-view', { id: a.id })} aria-label={a.displayName}><Avatar card={a} size={48} ring /></button>
          <button class="reel__who" onClick={() => push('profile-view', { id: a.id })}>
            <div class="reel__name"><span class="ellipsis">{a.displayName}</span><ProBadge card={a} compact /></div>
            {a.location && <div class="reel__loc ellipsis">{a.flag} {a.location}</div>}
          </button>
          <button class="glass like-pill" aria-pressed={!!media?.isLiked} aria-label={media?.isLiked ? 'Unlike' : 'Like'} onClick={() => media && onLike(media)}>
            <img src={icon(media?.isLiked ? 'IconHeartLiked' : 'IconHeartFilled')} alt="" />{fmtCount(media?.likesCount ?? 0)}
          </button>
          <button class="follow-btn" aria-pressed={creator.isFollowing} aria-label={creator.isFollowing ? 'Unfollow' : 'Follow'} onClick={onFollow}>
            <img src={icon(creator.isFollowing ? 'IconFollowingCheck' : 'IconPlus')} alt="" />
          </button>
        </div>
        {creator.bio && <div class="reel__bio lines-3">{creator.bio}</div>}
        <div class="reel__foot">
          <div class="reel__source">{media?.source ? `Video: ${media.source.provider}` : ''}</div>
          <button class="glass reel__more" aria-label="More" onClick={more}><img src={icon('IconDotsThree')} alt="" /></button>
        </div>
      </div>
      <div class="reel__progress" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></div>
    </section>
  );
}

function Reel({ media, active, load, muted, onProgress }: { media: Media; active: boolean; load: boolean; muted: boolean; onProgress?: (p: number) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState(media.url);
  const counted = useRef(false);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (active) {
      v.muted = muted;
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
      if (!counted.current) { counted.current = true; post(`/v1/media/${media.id}/view`).catch(() => {}); }
    } else v.pause();
  }, [active, muted, load]);
  return (
    <div class="reel">
      {load && !failed ? (
        <video ref={video} src={src ?? undefined} poster={media.posterUrl ?? undefined} loop playsInline muted={muted} preload={active ? 'auto' : 'metadata'}
          onTimeUpdate={(e) => onProgress?.(e.currentTarget.currentTime / (e.currentTarget.duration || 1))}
          onError={() => { if (media.fallbackUrl && src !== media.fallbackUrl) setSrc(media.fallbackUrl); else setFailed(true); }} />
      ) : media.posterUrl ? <img src={media.posterUrl} alt="" loading="lazy" /> : null}
    </div>
  );
}

// ─── Notifications (NotificationsView, Figma 654:16140): Today (with its unread count) and Last 30 days ───

const notificationText: Record<string, string> = {
  contact_request: 'Sent you a contact request', contact_accepted: 'Accepted your contact request', new_message: 'Sent you a message',
  application_received: 'Applied to your job', review_request: 'Asked you for a review', new_review: 'Left you a review',
  liked_video: 'Liked your video', viewed_profile: 'Viewed your profile', followed: 'Followed you', job_update: 'Updated a job you saved',
};
const notificationIcon: Record<string, string> = {
  contact_request: 'IconUserPlus', contact_accepted: 'IconUserPlus', new_message: 'IconEnvelopeFilled', application_received: 'IconNotifBriefcase',
  review_request: 'IconStarRating', new_review: 'IconStarRating', liked_video: 'IconNotifHeart', viewed_profile: 'IconNotifEye', followed: 'IconNotifFollow',
  job_update: 'IconArrowsClockwise',
};

/** "1 m", "3 h" today (or within the hour), else "4 Mar" (NotificationTime). */
function notificationTime(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (new Date(ms).toDateString() === new Date().toDateString() || s < 3600) return s < 3600 ? `${Math.max(1, Math.floor(s / 60))} m` : `${Math.floor(s / 3600)} h`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

type Note = Notification & { media?: Media | null; isFollowingActor?: boolean };

export function NotificationsScreen() {
  const { data, loading, setData, reload } = useLoad<{ items: Note[]; unreadCount: number; nextCursor: string | null }>(
    (s) => get('/v1/notifications?limit=60', s), [refreshTick.value, activeProfile.value?.id]);
  const patchItems = (fn: (n: Note) => Note) => setData({ ...data!, items: data!.items.map(fn) });
  const open = (n: Note) => {
    if (!n.readAt) {
      post('/v1/notifications/read', { ids: [n.id] }).then(refresh).catch(() => {});
      patchItems((x) => (x.id === n.id ? { ...x, readAt: Date.now() } : x));
    }
    if (n.type === 'new_message' && n.payload.conversationId) push('conversation', { id: n.payload.conversationId });
    else if (n.type === 'application_received' && n.payload.jobId) push('job', { id: n.payload.jobId });
    else if (n.type === 'contact_request') push('contacts', { filter: 'requests' });
    else if (n.type === 'review_request' && n.actor) push('review-form', { recipient: n.actor });
    else if (n.type === 'new_review') push('profile-view', { id: activeProfile.value!.id, tab: 'reviews' });
    else if (n.type === 'liked_video' && n.media) openViewer(n.media);
    else if (n.actor) push('profile-view', { id: n.actor.id });
  };
  const follow = async (n: Note) => {
    const next = !n.isFollowingActor;
    const set = (v: boolean) => setData((d) => d && ({ ...d, items: d.items.map((x) => (x.actor?.id === n.actor!.id ? { ...x, isFollowingActor: v } : x)) }));
    set(next);
    try { next ? await put(`/v1/profiles/${n.actor!.id}/follow`) : await del(`/v1/profiles/${n.actor!.id}/follow`); }
    catch (e) { set(!next); showToast(errorText(e), 'error'); }
  };
  const remove = async (n: Note) => {
    try { await del(`/v1/notifications/${n.id}`); setData((d) => d && ({ ...d, items: d.items.filter((x) => x.id !== n.id) })); refresh(); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const readAll = async () => {
    try { await post('/v1/notifications/read-all'); setData({ ...data!, unreadCount: 0, items: data!.items.map((x) => ({ ...x, readAt: x.readAt ?? Date.now() })) }); refresh(); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const menu = () => openSheet((close) => (
    <SheetFrame title="Notifications" close={close}>
      <button class="menu-item" disabled={!data?.unreadCount} onClick={() => { close(); void readAll(); }}><img src={icon('IconCheckCircle')} alt="" />Mark all as read</button>
      <button class="menu-item" onClick={() => { close(); void reload(); }}><img src={icon('IconArrowsClockwise')} alt="" />Refresh</button>
    </SheetFrame>
  ));
  const items = data?.items ?? [];
  const today = items.filter((n) => new Date(n.createdAt).toDateString() === new Date().toDateString());
  const earlier = items.filter((n) => !today.includes(n) && Date.now() - n.createdAt < 30 * 86_400_000);
  const unreadToday = today.filter((n) => !n.readAt).length;
  return (
    <>
      <div class="scroll">
        <div style={{ height: 'calc(var(--header-h) + 16px)' }} />
        {loading && !data ? <Spinner /> : !today.length && !earlier.length ? <Empty title="No notifications yet." text="Follows, likes, messages, applications and reviews appear here." iconName="IconBell" /> : (
          <div class="notifs">
            {today.length > 0 && <div class="notifs__title">Today{unreadToday > 0 && <span class="badge" style={{ position: 'static' }}>{unreadToday}</span>}</div>}
            {today.map((n) => <NotificationRow n={n} key={n.id} onOpen={open} onFollow={follow} onDelete={remove} />)}
            {earlier.length > 0 && <div class="notifs__title">Last 30 days</div>}
            {earlier.map((n) => <NotificationRow n={n} key={n.id} onOpen={open} onFollow={follow} onDelete={remove} />)}
          </div>
        )}
        <div style={{ height: 40 }} />
      </div>
      <Header left={<BackButton />} center={<HeaderTitle title="Notifications" />}
        right={<GlassButton name="IconDotsThree" label="More" onClick={menu} />} />
    </>
  );
}

function NotificationRow({ n, onOpen, onFollow, onDelete }: { n: Note; onOpen: (n: Note) => void; onFollow: (n: Note) => void; onDelete: (n: Note) => void }) {
  const press = useLongPress((el) => openContextMenu(el, [{ label: 'Delete notification', icon: 'IconTrash', danger: true, run: () => onDelete(n) }]));
  const name = n.actor?.username ?? 'kolaba';
  const job = n.type === 'application_received' || n.type === 'job_update' ? n.payload.jobTitle as string | undefined : undefined;
  const followable = (n.type === 'followed' || n.type === 'viewed_profile') && n.actor?.type === 'creator';
  return (
    <div class={`notif ${n.readAt ? '' : 'is-unread'}`} role="button" tabIndex={0} aria-label={`${name}: ${notificationText[n.type] ?? n.type}`}
      onPointerDown={press.onPointerDown as any} onPointerMove={press.onPointerMove as any} onPointerUp={press.onPointerUp} onPointerCancel={press.onPointerCancel}
      onPointerLeave={press.onPointerLeave} onContextMenu={press.onContextMenu} onClick={press.click(() => onOpen(n))}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(n)}>
      <Avatar card={n.actor} size={48} />
      <div class="grow" style={{ minWidth: 0 }}>
        <div class="notif__title">{name}{job && <><img src={icon('IconNotifAngle')} alt="" class="notif__angle" /><span class="ellipsis">{job}</span></>}</div>
        <div class="notif__detail"><img src={icon(notificationIcon[n.type] ?? 'IconBellSmall')} alt="" /><span class="ellipsis">{notificationText[n.type] ?? n.type}</span><span>•</span><span style={{ flex: 'none' }}>{notificationTime(n.createdAt)}</span></div>
      </div>
      {n.type === 'liked_video' && n.media ? (
        <img class="notif__thumb" src={(n.media.kind === 'video' ? n.media.posterUrl : n.media.url) ?? ''} alt="" style={{ background: gradientFor(n.media.id) }}
          onError={(e) => { e.currentTarget.removeAttribute('src'); }} />
      ) : followable ? (
        <button class={`follow-pill ${n.isFollowingActor ? 'is-on' : ''}`} aria-pressed={!!n.isFollowingActor}
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onFollow(n); }}>
          {n.isFollowingActor ? 'Following' : <>Follow<img src={icon('IconPlusSmall')} alt="" /></>}
        </button>
      ) : null}
    </div>
  );
}
