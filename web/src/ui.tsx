// Shared UI pieces, each the web counterpart of a component in kolaba/Core/Components: glass buttons, the header with
// its top blur, the logo, page tabs with the sliding underline, swipeable pages, media galleries, sheets (drag to
// dismiss), avatars, ratings, PRO badges, empty states, and formatting helpers.
import { ComponentChildren, toChildArray } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Card, Media } from './api';
import { back, closeSheet, openSheet, sheets } from './state';
import { uiScale } from './scale';

export const BASE: string = (import.meta as any).env?.BASE_URL ?? '/';
export const icon = (name: string) => `${BASE}icons/${name}.svg`;

export function Icon({ name, size = 20, alt = '', class: cls }: { name: string; size?: number; alt?: string; class?: string }) {
  return <img class={cls} src={icon(name)} width={size} height={size} alt={alt} draggable={false} />;
}

// ─── glass controls and the header ───

export function GlassButton({ name, label, onClick, badge, back: isBack, disabled }: {
  name: string; label: string; onClick?: () => void; badge?: number; back?: boolean; disabled?: boolean;
}) {
  return (
    <button class={`glass glass-btn ${isBack ? 'is-back' : ''}`} aria-label={label} onClick={onClick} disabled={disabled}>
      <img src={icon(name)} alt="" draggable={false} />
      {!!badge && badge > 0 && <span class="badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}

export const BackButton = ({ onClick }: { onClick?: () => void }) => (
  <GlassButton name="IconArrowLeft" label="Back" back onClick={onClick ?? back} />
);

export const Logo = ({ word }: { word: string }) => <div class="logo" role="heading" aria-level={1}>{word}<i>.</i></div>;

/** KolabaHeader: 44 pt controls at the safe area's top − 2, the centre piece between them, the top blur under it. */
export function Header({ left, center, right, blur = true, blurOpacity = 1 }: {
  left?: ComponentChildren; center?: ComponentChildren; right?: ComponentChildren; blur?: boolean; blurOpacity?: number;
}) {
  return (
    <>
      {blur && <div class="top-blur" style={{ opacity: blurOpacity }} />}
      <header class="header">
        <div class="header__side">{left}</div>
        {center && <div class="header__center">{center}</div>}
        <div class="header__side is-end">{right}</div>
      </header>
    </>
  );
}

export const HeaderTitle = ({ title, sub }: { title: string; sub?: string }) => (
  <div><div class="header__title ellipsis">{title}</div>{sub && <div class="header__sub ellipsis">{sub}</div>}</div>
);

// ─── page tabs and swipeable pages ───

/** Equal-width tabs, 40 pt, the pink capsule underline sliding under the selected one. */
export function PageTabs({ tabs, index, onChange, profile, counts }: { tabs: string[]; index: number; onChange: (i: number) => void; profile?: boolean; counts?: (number | undefined)[] }) {
  const width = 100 / tabs.length;
  return (
    <nav class={`ptabs ${profile ? 'is-profile' : ''}`} role="tablist">
      {tabs.map((t, i) => (
        <button role="tab" aria-selected={i === index} class={`ptabs__tab ${i === index ? 'is-active' : ''}`} onClick={() => onChange(i)}>{t}{counts?.[i] ? <span class="ptabs__count">{counts[i]}</span> : null}</button>
      ))}
      <i class="ptabs__line" style={{ width: `${width}%`, transform: `translateX(${index * 100}%)` }} />
    </nav>
  );
}

/** A horizontal drag recogniser: locks to an axis after 10 px, settles to the next page past half a width or a
 *  500 px/s flick (KolabaMotion.MainApp: directionLock 10, pageFlipVelocity 500). Ignores drags that start inside an
 *  element marked data-hscroll (carousels, galleries) so those keep their own swipes. */
export function useHorizontalSwipe(onDrag: (dx: number) => void, onEnd: (dx: number, velocity: number) => void) {
  return (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if ((e.target as HTMLElement).closest('[data-hscroll], input, textarea')) return;
    const k = uiScale();
    const x0 = e.clientX; const y0 = e.clientY; const t0 = performance.now();
    let mode: 'none' | 'h' | 'v' = 'none';
    let lastX = x0; let lastT = t0; let vx = 0;
    const el = e.currentTarget as HTMLElement;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / k; const dy = (ev.clientY - y0) / k;
      if (mode === 'none') {
        if (Math.hypot(dx, dy) < 10) return;
        mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        if (mode === 'h') { try { el.setPointerCapture(e.pointerId); } catch { /* */ } }
      }
      if (mode !== 'h') return;
      const now = performance.now();
      vx = ((ev.clientX - lastX) / k / Math.max(now - lastT, 1)) * 1000; lastX = ev.clientX; lastT = now;
      onDrag(dx);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (mode === 'h') {
        onEnd((ev.clientX - x0) / k, vx);
        // swallow the click that ends a drag
        const stop = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener('click', stop, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 50);
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
}

export function settleIndex(index: number, count: number, dx: number, width: number, velocity: number) {
  let next = index;
  if (velocity <= -500 || dx < -width / 2) next = index + 1;
  else if (velocity >= 500 || dx > width / 2) next = index - 1;
  return Math.min(Math.max(next, 0), count - 1);
}

/** Pages side by side, swiped sideways (inner tabs of Projects, Creators, Profile). Each page keeps its content. */
export function SwipePages({ index, onChange, children }: { index: number; onChange: (i: number) => void; children: ComponentChildren }) {
  const pages = toChildArray(children);
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const onPointerDown = useHorizontalSwipe(
    (dx) => {
      const edge = (index === 0 && dx > 0) || (index === pages.length - 1 && dx < 0);
      setDrag(edge ? dx / 3 : dx);
    },
    (dx, v) => { setDrag(null); onChange(settleIndex(index, pages.length, dx, root.current?.clientWidth ?? 390, v)); },
  );
  return (
    <div class="swipe" ref={root} onPointerDown={onPointerDown as any}>
      <div class={`swipe__track ${drag !== null ? 'is-dragging' : ''}`} style={{ transform: `translateX(calc(${-index * 100}% + ${drag ?? 0}px))` }}>
        {pages.map((p, i) => <div class="swipe__page" aria-hidden={i !== index} style={i !== index ? { height: 0, overflow: 'hidden' } as any : undefined}>{p}</div>)}
      </div>
    </div>
  );
}

export const Dots = ({ count, index }: { count: number; index: number }) =>
  count > 1 ? <div class="dots" aria-hidden="true">{Array.from({ length: Math.min(count, 10) }, (_, i) => <i class={i === Math.min(index, 9) ? 'is-on' : ''} />)}</div> : null;

/** A sideways media pager with ReelsPagination dots (job cards, job details, profile hero). */
export function Gallery({ media, onOpen, class: cls = 'gallery', dots = true, children, onIndex }: {
  media: Media[]; onOpen?: (m: Media, i: number) => void; class?: string; dots?: boolean; children?: ComponentChildren; onIndex?: (i: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const count = media.length;
  const set = (i: number) => { setIndex(i); onIndex?.(i); };
  const onPointerDown = useHorizontalSwipe(
    (dx) => setDrag((index === 0 && dx > 0) || (index === count - 1 && dx < 0) ? dx / 3 : dx),
    (dx, v) => { setDrag(null); set(settleIndex(index, count, dx, root.current?.clientWidth ?? 370, v)); },
  );
  return (
    <div class={cls} ref={root} data-hscroll={count > 1 ? '' : undefined} onPointerDown={count > 1 ? (e) => { e.stopPropagation(); onPointerDown(e as any); } : undefined}>
      <div class={`gallery__track ${drag !== null ? 'is-dragging' : ''}`} style={{ transform: `translateX(calc(${-index * 100}% + ${drag ?? 0}px))` }}>
        {media.map((m, i) => (
          <MediaImage media={m} onClick={onOpen ? () => onOpen(m, i) : undefined} eager={i === 0} />
        ))}
      </div>
      {media[index]?.kind === 'video' && onOpen && (
        <button class="glass gallery__play" aria-label="Play video" onClick={() => onOpen(media[index], index)}><Icon name="IconPlay" size={18} /></button>
      )}
      {dots && count > 1 && <div class="gallery__dots"><Dots count={count} index={index} /></div>}
      {children}
    </div>
  );
}

function MediaImage({ media, onClick, eager }: { media: Media; onClick?: () => void; eager?: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = media.kind === 'video' ? media.posterUrl : media.url;
  if (!src || broken) return <div onClick={onClick} style={{ background: gradientFor(media.id) }} />;
  return <img src={src} alt="" loading={eager ? 'eager' : 'lazy'} draggable={false} onClick={onClick} onError={() => setBroken(true)} />;
}

// ─── avatars, ratings, badges ───

const palette = [['#FF00A6', '#9000FF'], ['#00AEFF', '#2D5BFF'], ['#FF7A00', '#FF0077'], ['#00C2A8', '#0074FF'], ['#B200FF', '#FF4D9D'],
  ['#5DCD41', '#00AEFF'], ['#FFB800', '#FF3D00']];
export function gradientFor(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = palette[h % palette.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function Avatar({ card, size = 48, rounded, ring }: { card: Pick<Card, 'displayName' | 'avatarUrl' | 'type'> | null; size?: number; rounded?: boolean; ring?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cls = `avatar ${rounded ? 'is-rounded' : ''} ${ring ? 'has-ring' : ''}`;
  if (!card) return <div class={cls} style={{ width: size, height: size }} />;
  const photo = card.avatarUrl && !broken;
  return (
    <div class={cls} style={{ width: size, height: size, fontSize: size * 0.38, background: photo ? '#222' : gradientFor(card.displayName) }}>
      {photo ? <img src={card.avatarUrl!} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} /> : <span>{initials(card.displayName)}</span>}
    </div>
  );
}

export const StarIcon = ({ size = 16 }: { size?: number }) => <i class="star-icon" style={{ width: size, height: size }} aria-hidden="true" />;

export function Stars({ value, size = 16.667 }: { value: number; size?: number }) {
  return (
    <span class="stars" role="img" aria-label={`${value.toFixed(1)} of 5`}>
      {[0, 1, 2, 3, 4].map((i) => <i class="star" style={{ width: size, height: size, ['--fill' as any]: `${Math.min(Math.max(value - i, 0), 1) * 100}%` }} />)}
    </span>
  );
}

export function RatingInline({ rating, count }: { rating: number | null; count: number }) {
  if (!rating || !count) return <span class="muted" style={{ fontSize: 12 }}>No reviews yet</span>;
  return <span class="row" style={{ gap: 4, display: 'inline-flex', fontWeight: 600, fontSize: 14 }}>{rating.toFixed(1)}<StarIcon size={14} /><span class="muted" style={{ fontWeight: 400 }}>({count})</span></span>;
}

/** ProBadge: crown + PRO in the account's colour (creator pink, business blue). */
export function ProBadge({ card, compact }: { card: Pick<Card, 'isPro' | 'type'> | null; compact?: boolean }) {
  if (!card?.isPro) return null;
  return <span class={`pro ${card.type === 'business' ? 'is-business' : ''} ${compact ? 'is-compact' : ''}`}><img src={icon('IconCrownSimple')} alt="" />PRO</span>;
}

export const DemoTag = ({ card }: { card: Pick<Card, 'isDemo'> }) => (card.isDemo ? <span class="demo-tag" title="Demo profile">DEMO</span> : null);

export function Empty({ title, text, iconName = 'IconFolderSimpleDashed', children }: { title: string; text?: string; iconName?: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty__icon"><Icon name={iconName} size={28} /></div>
      <div class="empty__title">{title}</div>
      {text && <div>{text}</div>}
      {children && <div style={{ marginTop: 14 }}>{children}</div>}
    </div>
  );
}

export const Spinner = () => <div class="spinner" role="status" aria-label="Loading" />;

// ─── sheets ───

export function SheetFrame({ title, close, children }: { title?: string; close: () => void; children: ComponentChildren }) {
  return (
    <>
      <div class="sheet__grabber" data-drag />
      <div class="sheet__head" data-drag>
        <span style={{ width: 44 }} />
        <div class="sheet__title ellipsis">{title}</div>
        <button class="glass sheet__close" aria-label="Close" onClick={close}><Icon name="IconSheetClose" size={14} /></button>
      </div>
      <div class="sheet__body">{children}</div>
    </>
  );
}

/** One sheet: slides up (spring .35), follows the finger down from its grabber, header or a body scrolled to the
 *  top, and closes past a third of its height or on a downward flick. */
function SheetView({ id, tall, closing, render }: { id: number; tall?: boolean; closing?: boolean; render: (close: () => void) => any }) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const [settling, setSettling] = useState(false);
  const close = () => closeSheet(id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && sheets.value[sheets.value.length - 1]?.id === id) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    const body = target.closest('.sheet__body') as HTMLElement | null;
    if (!target.closest('[data-drag]') && !(body && body.scrollTop <= 0)) return;
    if (target.closest('input, textarea, select')) return;
    const k = uiScale();
    const y0 = e.clientY; let lastY = y0; let lastT = performance.now(); let v = 0; let active = false;
    const move = (ev: PointerEvent) => {
      const dy = (ev.clientY - y0) / k;
      if (!active) { if (dy < 8) { if (dy < -8) cleanup(); return; } active = true; }
      const now = performance.now(); v = ((ev.clientY - lastY) / k / Math.max(now - lastT, 1)) * 1000; lastY = ev.clientY; lastT = now;
      setOffset(Math.max(0, dy));
      ev.preventDefault();
    };
    const up = (ev: PointerEvent) => {
      cleanup();
      if (!active) return;
      const dy = Math.max(0, (ev.clientY - y0) / k);
      const h = ref.current?.clientHeight ?? 400;
      if (dy > h / 3 || v > 700) { ref.current?.style.setProperty('--from', `${dy}px`); setOffset(null); close(); }
      else { setSettling(true); setOffset(0); window.setTimeout(() => { setSettling(false); setOffset(null); }, 300); }
    };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  return (
    <div class={`sheet-root ${closing ? 'is-closing' : ''}`}>
      <div class="sheet-backdrop" onClick={close} style={offset ? { opacity: Math.max(0, 1 - offset / 400) } : undefined} />
      <div ref={ref} class={`sheet ${tall ? 'is-tall' : ''} ${offset !== null && !settling ? 'is-dragging' : ''} ${settling ? 'is-settling' : ''}`}
        role="dialog" aria-modal="true" onPointerDown={onPointerDown as any}
        style={offset !== null ? { transform: `translateY(${offset}px)` } : undefined}>
        {render(close)}
      </div>
    </div>
  );
}

export function Sheets() {
  return <>{sheets.value.map((s) => (s.raw ? <div key={s.id}>{s.render(() => closeSheet(s.id))}</div> : <SheetView key={s.id} {...s} />))}</>;
}

/** Confirmation in the app's alert style (iOS Alert). */
export function confirmSheet(title: string, text: string, action: string, onConfirm: () => void | Promise<void>, danger = false) {
  alertDialog(title, text, action, onConfirm, danger);
}

/** A choice from a short list (replaces <select>): a sheet with a check on the current value. */
export function pickSheet<T extends string>(title: string, options: [T, string][], current: T, onPick: (v: T) => void) {
  openSheet((close) => (
    <SheetFrame title={title} close={close}>
      {options.map(([v, label]) => (
        <button class="menu-item" role="menuitemradio" aria-checked={v === current} onClick={() => { close(); if (v !== current) onPick(v); }}>
          <span class="grow">{label}</span>{v === current && <Icon name="IconCheckActive" />}
        </button>
      ))}
    </SheetFrame>
  ));
}

/** Full-screen photo / video viewer. */
export function openViewer(media: Media, extra?: (close: () => void) => ComponentChildren) {
  openSheet((close) => (
    <div class="viewer" onClick={close}>
      {media.kind === 'video'
        ? <video src={media.url ?? undefined} poster={media.posterUrl ?? undefined} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
        : <img src={media.url ?? undefined} alt="" />}
      <span onClick={(e) => e.stopPropagation()}><GlassButton name="IconSheetClose" label="Close" onClick={close} /></span>
      {extra && <span onClick={(e) => e.stopPropagation()}>{extra(close)}</span>}
    </div>
  ), { raw: true });
}

export function MediaTile({ media, onOpen, picked, menu, removing }: { media: Media; onOpen?: () => void; picked?: boolean; menu?: MenuAction[]; removing?: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = media.kind === 'video' ? media.posterUrl : media.url;
  const press = useLongPress((el) => menu?.length && openContextMenu(el, menu));
  const open = onOpen ?? (() => openViewer(media));
  return (
    <button class={`mtile ${picked ? 'is-picked' : ''} ${removing ? 'is-removing' : ''}`} aria-label={media.title ?? (media.kind === 'video' ? 'Video' : 'Photo')}
      {...(menu?.length ? { onPointerDown: press.onPointerDown as any, onPointerMove: press.onPointerMove as any, onPointerUp: press.onPointerUp,
        onPointerCancel: press.onPointerCancel, onPointerLeave: press.onPointerLeave, onContextMenu: press.onContextMenu } : {})}
      onClick={menu?.length ? press.click(open) : open}>
      {src && !broken ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
        : <div style={{ position: 'absolute', inset: 0, background: gradientFor(media.id) }} />}
      {media.kind === 'video' && (
        <span class="mtile__time"><Icon name="IconPlay" size={12} />{media.duration ? fmtDuration(media.duration) : ''}</span>
      )}
    </button>
  );
}

// ─── pull to refresh: the arrows follow the pull; past 112 pt it refreshes ───

export function usePullToRefresh(onRefresh: () => Promise<unknown> | void) {
  const scroller = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let y0: number | null = null; let pull = 0; let busy = false;
    const paint = (p: number, spinning = false) => {
      const ind = indicator.current;
      if (!ind) return;
      ind.style.opacity = String(Math.min(p / 112, 1));
      ind.style.transform = `translateY(${Math.min(p, 140) * 0.5}px) rotate(${p * 2.4}deg)`;
      ind.classList.toggle('is-spinning', spinning);
    };
    const start = (e: TouchEvent | PointerEvent) => {
      if (busy || el.scrollTop > 0) return;
      if ('pointerType' in e && e.pointerType !== 'mouse') return;
      y0 = 'touches' in e ? e.touches[0].clientY : e.clientY; pull = 0;
    };
    const move = (e: TouchEvent | PointerEvent) => {
      if (y0 === null) return;
      const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
      pull = Math.max(0, ((y - y0) / uiScale()) * 0.6);
      if (el.scrollTop > 0) { y0 = null; pull = 0; }
      paint(pull);
    };
    const end = async () => {
      if (y0 === null) return;
      y0 = null;
      if (pull >= 112 * 0.6) {
        busy = true; paint(112, true);
        try { await onRefresh(); } finally { busy = false; paint(0); }
      } else paint(0);
    };
    el.addEventListener('touchstart', start, { passive: true }); el.addEventListener('touchmove', move, { passive: true }); el.addEventListener('touchend', end);
    el.addEventListener('pointerdown', start); window.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
    return () => {
      el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end);
      el.removeEventListener('pointerdown', start); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end);
    };
  }, []);
  const Indicator = () => <div class="ptr glass" ref={indicator} aria-hidden="true"><Icon name="IconArrowsClockwise" size={18} /></div>;
  return { scroller, Indicator };
}

// ─── formatting ───

export function fmtDuration(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtCount(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function timeAgo(ms: number) {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "7 Nov, 10:30" — the post date of Projects' cards. */
export const postDate = (ms: number) => `${new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${clock(ms)}`;

/** Chat list time: today HH:mm, this week a weekday, else a date. */
export function chatTime(ms: number) {
  const d = new Date(ms); const now = new Date();
  if (d.toDateString() === now.toDateString()) return clock(ms);
  if (now.getTime() - ms < 6 * 86_400_000) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Chat day separator: "Today 23:00", "Yesterday 22:06", "7 Nov 10:30". */
export function daySeparator(ms: number) {
  const d = new Date(ms); const now = new Date(); const y = new Date(now.getTime() - 86_400_000);
  const day = d.toDateString() === now.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${day} ${clock(ms)}`;
}

export function clock(ms: number) {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const currencySymbols: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', UAH: '₴', PLN: 'zł', THB: '฿', KZT: '₸', AED: 'AED', VND: '₫', IDR: 'Rp', TRY: '₺' };
export function price(job: { compensationType: string; budgetMin: number | null; budgetMax: number | null; currency: string | null }) {
  const sym = job.currency ? currencySymbols[job.currency] ?? job.currency : '';
  const n = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (job.compensationType === 'barter') return 'Barter';
  if (job.compensationType === 'fixed' && job.budgetMin != null) return `${sym} ${n(job.budgetMin)}`;
  if (job.compensationType === 'range' && job.budgetMin != null && job.budgetMax != null) return `${sym} ${n(job.budgetMin)}–${n(job.budgetMax)}`;
  return null;
}
export const priceCaption = (c: string) => ({ fixed: 'Fixed price', range: 'Budget range', barter: 'Collaboration', not_selected: '' } as Record<string, string>)[c] ?? '';

/** Calls `load` on mount and whenever `deps` change; exposes data/error/reload. */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = () => {
    const id = ++seq.current;
    const controller = new AbortController();
    setLoading(true);
    const p = load(controller.signal).then((d) => { if (id === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (id === seq.current && e?.name !== 'AbortError') setError(e); })
      .finally(() => { if (id === seq.current) setLoading(false); });
    return Object.assign(controller, { done: p });
  };
  useEffect(() => { const c = run(); return () => c.abort(); }, deps);
  return { data, error, loading, reload: () => run().done, setData };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(t); }, [value]);
  return v;
}

export const flagLocation = (c: { flag: string | null; location: string | null }) => (c.location ? `${c.flag ?? ''} ${c.location}`.trim() : null);

// ─── long press (the iOS context menu's 0.5 s) ───

/** Press and hold 500 ms without moving (10 pt): `onLong` runs and the click that ends the press is swallowed;
 *  moving, scrolling or releasing earlier cancels it, so a tap still opens and a swipe still swipes. Mouse and
 *  touch alike; the browser's own context menu never shows. */
export function useLongPress(onLong: (el: HTMLElement) => void, ms = 500) {
  const timer = useRef<number>();
  const fired = useRef(false);
  const start = useRef<[number, number] | null>(null);
  const cancel = () => { window.clearTimeout(timer.current); start.current = null; };
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      fired.current = false;
      start.current = [e.clientX, e.clientY];
      const el = e.currentTarget as HTMLElement;
      timer.current = window.setTimeout(() => { fired.current = true; start.current = null; navigator.vibrate?.(8); onLong(el); }, ms);
    },
    onPointerMove: (e: PointerEvent) => {
      if (!start.current) return;
      if (Math.hypot(e.clientX - start.current[0], e.clientY - start.current[1]) / uiScale() > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: Event) => e.preventDefault(),
    /** True (once) right after a long press fired — for swallowing the click that ends it. */
    consume: () => { const f = fired.current; fired.current = false; return f; },
    /** Wraps a click handler: skipped right after a long press. */
    click: (fn: () => void) => () => { if (fired.current) { fired.current = false; return; } fn(); },
  };
}

export interface MenuAction { label: string; icon: string; danger?: boolean; run: () => void }

/** The iOS context menu over a lifted card: the rest blurred and dimmed, the card at its place (moved up if the
 *  menu would not fit under it), the menu under it. A tap outside closes it. */
export function openContextMenu(el: HTMLElement, actions: MenuAction[]) {
  const app = (el.closest('.app') as HTMLElement | null) ?? document.body;
  const k = uiScale();
  const a = app.getBoundingClientRect(); const r = el.getBoundingClientRect();
  const box = { x: (r.left - a.left) / k, y: (r.top - a.top) / k, w: r.width / k, h: r.height / k };
  const menuH = actions.length * 44 + 8;
  const screenH = a.height / k;
  const top = Math.max(70, Math.min(box.y, screenH - 40 - menuH - 12 - box.h));
  const clone = el.cloneNode(true) as HTMLElement;
  openSheet((close) => (
    <div class="ctx" onClick={close} onContextMenu={(e) => e.preventDefault()}>
      <div class="ctx__preview" style={{ left: box.x, top, width: box.w, height: box.h, ['--from' as any]: `${box.y - top}px` }}
        ref={(n) => { if (n && !n.firstChild) { clone.style.width = '100%'; clone.style.height = '100%'; n.appendChild(clone); } }} />
      <div class={`ctx__menu glass ${box.x + box.w / 2 > 201 ? 'is-end' : ''}`} role="menu"
        style={{ top: top + box.h + 12, ...(box.x + box.w / 2 > 201 ? { right: Math.max(16, 402 - box.x - box.w) } : { left: Math.max(16, box.x) }) }}
        onClick={(e) => e.stopPropagation()}>
        {actions.map((m) => (
          <button role="menuitem" class={`ctx__item ${m.danger ? 'is-danger' : ''}`} onClick={() => { close(); m.run(); }}>
            <span>{m.label}</span><img src={icon(m.icon)} alt="" />
          </button>
        ))}
      </div>
    </div>
  ), { raw: true });
}

/** The app's alert (iOS Alert, KOLABA style): title, message, a destructive or default action and Cancel. */
export function alertDialog(title: string, message: string, action: string, onConfirm: () => void | Promise<void>, danger = true) {
  openSheet((close) => <AlertView title={title} message={message} action={action} danger={danger} close={close} onConfirm={onConfirm} />, { raw: true });
}

function AlertView({ title, message, action, danger, close, onConfirm }: { title: string; message: string; action: string; danger: boolean; close: () => void; onConfirm: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div class="alert-root" onClick={() => !busy && close()}>
      <div class="alert" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div class="alert__text"><b>{title}</b><span>{message}</span></div>
        <div class="alert__buttons">
          <button disabled={busy} onClick={close}>Cancel</button>
          <button class={danger ? 'is-danger' : 'is-default'} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { close(); } }}>
            {busy ? <span class="spinner" style={{ width: 16, height: 16, margin: 0, borderWidth: 2 }} /> : action}
          </button>
        </div>
      </div>
    </div>
  );
}
