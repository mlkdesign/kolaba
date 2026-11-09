// kolaba. — ReelsView: one vertical page per creator, their videos side by side (dots under the logo); the info panel
// (avatar, name, location, like pill, pink Follow), bio, ••• and the pink progress line above the tab bar. Only the
// video on screen plays; its neighbours preload metadata. Plus Notifications (the bell).
import { useEffect, useRef, useState } from 'preact/hooks';
import { Card, del, errorText, get, Media, Notification, post, put } from '../api';
import { activeProfile, badges, openSheet, push, refresh, refreshTick, showToast, tab } from '../state';
import { Avatar, BackButton, Dots, Empty, fmtCount, GlassButton, Header, HeaderTitle, Icon, icon, Logo, ProBadge, SheetFrame, Spinner, timeAgo, useLoad } from '../ui';

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
      {current && <div class="reel__dots"><Dots count={current.videos.length} index={videoIndex[current.author.id] ?? 0} /></div>}
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
    setHearts((h) => [...h, { id: Date.now(), x: e.clientX - box.left, y: e.clientY - box.top }]);
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
      {active && muted && <span class="reel__muted glass glass-btn" aria-hidden="true"><img src={icon('IconSpeakerX')} alt="" /></span>}
      <div class="reel__shade" />
      <div class="reel__info">
        <div class="reel__author">
          <button onClick={() => push('profile-view', { id: a.id })} aria-label={a.displayName}><Avatar card={a} size={56} ring /></button>
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
          <div class="reel__source">{media?.source ? `Stock video · ${media.source.provider} · demo profile` : ''}</div>
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

// ─── Notifications ───

const notificationText: Record<string, (n: Notification) => string> = {
  contact_request: () => 'wants to add you to contacts',
  contact_accepted: () => 'accepted your contact request',
  new_message: () => 'sent you a message',
  application_received: (n) => `applied to “${n.payload.jobTitle ?? 'your job'}”`,
  review_request: () => 'asked you for a review',
  new_review: () => 'left you a review',
  liked_video: () => 'liked your video',
  viewed_profile: () => 'viewed your profile',
  followed: () => 'started following you',
  job_update: () => 'updated a job',
};
const notificationIcon: Record<string, string> = {
  contact_request: 'IconUserPlus', contact_accepted: 'IconCheckCircle', new_message: 'IconChatText', application_received: 'IconNotifBriefcase',
  review_request: 'IconStarRating', new_review: 'IconStarRating', liked_video: 'IconNotifHeart', viewed_profile: 'IconNotifEye', followed: 'IconNotifFollow',
  job_update: 'IconNotifBriefcase',
};

export function NotificationsScreen() {
  const { data, loading, setData } = useLoad<{ items: Notification[]; unreadCount: number; nextCursor: string | null }>(
    (s) => get('/v1/notifications?limit=50', s), [refreshTick.value, activeProfile.value?.id]);
  const open = async (n: Notification) => {
    if (!n.readAt) {
      post('/v1/notifications/read', { ids: [n.id] }).then(refresh).catch(() => {});
      setData({ ...data!, items: data!.items.map((x) => (x.id === n.id ? { ...x, readAt: Date.now() } : x)) });
    }
    if (n.type === 'new_message' && n.payload.conversationId) push('conversation', { id: n.payload.conversationId });
    else if (n.type === 'application_received' && n.payload.jobId) push('job', { id: n.payload.jobId });
    else if (n.type === 'contact_request') push('contacts', { filter: 'requests' });
    else if (n.type === 'review_request' && n.actor) push('review-form', { recipient: n.actor });
    else if (n.type === 'new_review') push('profile-view', { id: activeProfile.value!.id, tab: 'reviews' });
    else if (n.actor) push('profile-view', { id: n.actor.id });
  };
  const readAll = async () => {
    try { await post('/v1/notifications/read-all'); setData({ ...data!, unreadCount: 0, items: data!.items.map((x) => ({ ...x, readAt: x.readAt ?? Date.now() })) }); refresh(); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const today = (data?.items ?? []).filter((n) => Date.now() - n.createdAt < 86_400_000);
  const earlier = (data?.items ?? []).filter((n) => Date.now() - n.createdAt >= 86_400_000);
  const row = (n: Notification) => (
    <button class={`notif ${n.readAt ? '' : 'is-unread'}`} onClick={() => open(n)} key={n.id}>
      <span style={{ position: 'relative' }}><Avatar card={n.actor} size={48} />
        <span class="notif__icon" style={{ left: 30 }}><img src={icon(notificationIcon[n.type] ?? 'IconBellSmall')} alt="" /></span></span>
      <div class="grow"><div class="notif__text"><b>{n.actor?.displayName ?? 'Someone'}</b> {(notificationText[n.type] ?? (() => n.type))(n)}</div>
        <div class="notif__time">{timeAgo(n.createdAt)}</div></div>
    </button>
  );
  return (
    <>
      <div class="scroll">
        <div class="section-top" />
        {loading && !data ? <Spinner /> : !data?.items.length ? <Empty title="No notifications" text="Contact requests, messages, applications, follows and reviews appear here." iconName="IconBell" /> : (
          <>
            {today.length > 0 && <div class="section-label" style={{ marginTop: 0 }}>Today</div>}
            {today.map(row)}
            {earlier.length > 0 && <div class="section-label">Earlier</div>}
            {earlier.map(row)}
          </>
        )}
        <div style={{ height: 40 }} />
      </div>
      <Header left={<BackButton />} center={<HeaderTitle title="Notifications" />}
        right={<GlassButton name="IconCheckCircle" label="Mark all as read" disabled={!data?.unreadCount} onClick={readAll} />} />
    </>
  );
}
