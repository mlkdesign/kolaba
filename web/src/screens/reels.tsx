// kolaba. — the vertical video feed (one playing <video>, the next one preloading, the rest posters) and Notifications.
import { useEffect, useRef, useState } from 'preact/hooks';
import { del, errorText, get, Media, Notification, Page, post, put } from '../api';
import { activeProfile, badges, push, refresh, refreshTick, showToast, tab } from '../state';
import { Avatar, Empty, fmtCount, Icon, ProBadge, Spinner, timeAgo, TopBar, useLoad } from '../ui';

export function ReelsScreen() {
  const [items, setItems] = useState<Media[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);

  const load = async (more: boolean) => {
    if (loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await get<Page<Media>>(`/v1/reels?limit=8${more && cursor ? `&cursor=${cursor}` : ''}`);
      setItems((prev) => (more ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError('');
    } catch (e) { setError(errorText(e)); } finally { setLoading(false); loadingMore.current = false; }
  };
  useEffect(() => { void load(false); }, [activeProfile.value?.id]);

  // The active reel = the one filling the screen.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting && entry.intersectionRatio > 0.6) setActive(Number((entry.target as HTMLElement).dataset.index));
    }, { root: el, threshold: [0.6] });
    el.querySelectorAll('.reel').forEach((r) => io.observe(r));
    return () => io.disconnect();
  }, [items.length]);
  useEffect(() => { if (active >= items.length - 3 && cursor) void load(true); }, [active, cursor]);

  const visible = tab.value === 'kolaba';
  const setLike = async (m: Media) => {
    const liked = !m.isLiked;
    setItems((all) => all.map((x) => (x.id === m.id ? { ...x, isLiked: liked, likesCount: x.likesCount + (liked ? 1 : -1) } : x)));
    try {
      const res = liked ? await put(`/v1/media/${m.id}/like`) : await del(`/v1/media/${m.id}/like`);
      setItems((all) => all.map((x) => (x.id === m.id ? { ...x, isLiked: res.liked, likesCount: res.likesCount } : x)));
    } catch (e) {
      setItems((all) => all.map((x) => (x.id === m.id ? { ...x, isLiked: m.isLiked, likesCount: m.likesCount } : x)));
      showToast(errorText(e), 'error');
    }
  };

  return (
    <>
      <div class="reels" ref={root}>
        {loading && <div style={{ paddingTop: 200 }}><Spinner /></div>}
        {!loading && error && <div style={{ paddingTop: 140 }}><Empty title="Couldn't load the feed" text={error} /></div>}
        {!loading && !error && !items.length && <div style={{ paddingTop: 140 }}><Empty title="No videos yet" iconName="IconPlayCircle" /></div>}
        {items.map((m, i) => (
          <Reel key={m.id} media={m} index={i} active={visible && i === active} near={Math.abs(i - active) <= 1} muted={muted}
            onLike={() => setLike(m)} onToggleSound={() => setMuted(!muted)} />
        ))}
      </div>
      <div class="reels-top">
        <div class="logo-word">kolaba<i>.</i></div>
        <button class="glass-btn" aria-label="Notifications" onClick={() => push('notifications')}>
          <Icon name="IconBell" />{badges.value.notifications > 0 && <span class="badge">{badges.value.notifications > 99 ? '99+' : badges.value.notifications}</span>}
        </button>
      </div>
    </>
  );
}

function Reel({ media, index, active, near, muted, onLike, onToggleSound }: {
  media: Media; index: number; active: boolean; near: boolean; muted: boolean; onLike: () => void; onToggleSound: () => void;
}) {
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
    } else {
      v.pause();
    }
  }, [active, muted]);
  const author = media.author;
  return (
    <section class="reel" data-index={index} aria-label={media.title ?? 'Video'}>
      {/* Only the active and neighbouring reels get a <video>; the rest show their poster. */}
      {near && !failed ? (
        <video ref={video} src={src ?? undefined} poster={media.posterUrl ?? undefined} loop playsInline muted={muted}
          preload={active ? 'auto' : 'metadata'}
          onError={() => { if (media.fallbackUrl && src !== media.fallbackUrl) setSrc(media.fallbackUrl); else setFailed(true); }} />
      ) : (
        media.posterUrl && <img src={media.posterUrl} alt="" loading="lazy" />
      )}
      <button class="reel__tap" aria-label={muted ? 'Sound on' : 'Sound off'} onClick={onToggleSound} onDblClick={() => !media.isLiked && onLike()} />
      {active && muted && <span class="reel__muted glass-btn" aria-hidden="true"><Icon name="IconSpeakerX" size={18} /></span>}
      <div class="reel__info">
        {author && (
          <button class="reel__author" onClick={() => push('profile-view', { id: author.id })}>
            <Avatar card={author} size={36} /><span>{author.displayName}</span><ProBadge card={author} />
          </button>
        )}
        {author?.location && <div class="reel__loc">{author.flag} {author.location}</div>}
        {author?.category && <div class="reel__title">{author.category}</div>}
        {media.source && <div class="reel__source">Stock video · {media.source.provider}{media.source.attribution && media.source.attribution !== media.source.provider ? ` / ${media.source.attribution}` : ''} · demo profile</div>}
        {failed && <div class="reel__source">Video unavailable right now</div>}
      </div>
      <div class="reel__side">
        <button class="reel__action" aria-pressed={media.isLiked} aria-label={media.isLiked ? 'Unlike' : 'Like'} onClick={onLike}>
          <Icon name={media.isLiked ? 'IconHeartLiked' : 'IconHeart'} size={30} /><span>{fmtCount(media.likesCount)}</span>
        </button>
        <div class="reel__action"><Icon name="IconEye" size={26} /><span>{fmtCount(media.viewsCount)}</span></div>
      </div>
    </section>
  );
}

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
      <Avatar card={n.actor} size={44} />
      <div class="grow"><div class="notif__text"><b>{n.actor?.displayName ?? 'Someone'}</b> {(notificationText[n.type] ?? (() => n.type))(n)}</div>
        <div class="notif__time">{timeAgo(n.createdAt)}</div></div>
    </button>
  );
  return (
    <>
      <TopBar title="Notifications">
        <button class="glass-btn" aria-label="Mark all as read" onClick={readAll} disabled={!data?.unreadCount}><Icon name="IconCheckCircle" /></button>
      </TopBar>
      <div class="scroll">
        <div class="below-topbar" />
        {loading && !data ? <Spinner /> : !data?.items.length ? <Empty title="No notifications" text="Contact requests, messages, applications and reviews appear here." iconName="IconBell" /> : (
          <>
            {today.length > 0 && <div class="section-title">Today</div>}
            {today.map(row)}
            {earlier.length > 0 && <div class="section-title">Earlier</div>}
            {earlier.map(row)}
          </>
        )}
      </div>
    </>
  );
}
