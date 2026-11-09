// Shared UI pieces, each the web counterpart of a component in kolaba/Core/Components: glass buttons, the header with
// its top blur, the logo, page tabs with the sliding underline, swipeable pages, media galleries, sheets (drag to
// dismiss), avatars, ratings, PRO badges, empty states, and formatting helpers.
import { ComponentChildren, toChildArray } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Card, Media } from './api';
import { activeProfile, back, closeSheet, openSheet, sheets } from './state';
import { badgeOffers, offerFor, openPaywall } from './paywall';
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
export function Header({ left, center, right, blur = true, blurOpacity = 1, collapsingTitle }: {
  left?: ComponentChildren; center?: ComponentChildren; right?: ComponentChildren; blur?: boolean; blurOpacity?: number; collapsingTitle?: boolean;
}) {
  return (
    <>
      {blur && <TopBlur opacity={blurOpacity} />}
      <header class="header">
        <div class="header__side">{left}</div>
        {center && <div class={`header__center ${collapsingTitle ? 'is-title' : ''}`}>{center}</div>}
        <div class="header__side is-end">{right}</div>
      </header>
    </>
  );
}

/** KolabaTopBlur: the 100 pt band at the top — the background darkening (70 % → 50 % → 0) under a progressive blur
 *  (radius 8 at the top edge → 0 at the bottom: four stacked 4 px backdrop blurs, each masked by a linear ramp that
 *  ends lower than the one before, so the radius falls off without a step or an edge). `sticky` puts the band inside a
 *  scroll view as its first child: then it shares one stacking context with the pinned tabs, which always draw above
 *  it — in every engine, Safari's composited scrolling included. */
export function TopBlur({ opacity = 1, sticky }: { opacity?: number; sticky?: boolean }) {
  const band = (
    <div class="top-blur" style={{ opacity }} aria-hidden="true">
      <i class="top-blur__dark" /><i class="top-blur__l1" /><i class="top-blur__l2" /><i class="top-blur__l3" /><i class="top-blur__l4" />
    </div>
  );
  return sticky ? <div class="top-blur-pin" aria-hidden="true">{band}</div> : band;
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
export function useHorizontalSwipe(onDrag: (dx: number) => void, onEnd: (dx: number, velocity: number) => void, own = false) {
  return (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // A gallery's own recogniser (own) takes drags inside itself; the pages around it leave them alone.
    if ((e.target as HTMLElement).closest(own ? 'input, textarea' : '[data-hscroll], input, textarea')) return;
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
    true,
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
export function ProBadge({ card, compact }: { card: Pick<Card, 'isPro' | 'type'> & { id?: string } | null; compact?: boolean }) {
  if (!card?.isPro) return null;
  const cls = `pro ${card.type === 'business' ? 'is-business' : ''} ${compact ? 'is-compact' : ''}`;
  // Someone else's badge offers a non-PRO viewer the paywall of their own type (proBadgeOffer); the tap stays here.
  const offers = card.id !== activeProfile.value?.id && badgeOffers(card.type);
  if (!offers) return <span class={cls}><img src={icon('IconCrownSimple')} alt="" />PRO</span>;
  return (
    <span class={`${cls} is-tappable`} role="button" tabIndex={0} aria-label={`PRO — see ${card.type}.pro`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); openPaywall(offerFor(card.type)); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); openPaywall(offerFor(card.type)); } }}>
      <img src={icon('IconCrownSimple')} alt="" />PRO</span>
  );
}


/** KolabaEmptyState: the card fan (PortfolioCardFan — three glass cards that open with a spring, the pink +), the
 *  message (Bold 16) and its detail (Light 14), both light grey at 50 %, then an optional action. */
export function Empty({ title, text, children, plus = false, cards = 'standard' }: { title: string; text?: string; iconName?: string; children?: ComponentChildren; plus?: boolean; cards?: 'standard' | 'media' }) {
  // CardFanIcons: the locks on the sides (standard), or a portfolio's video ▶ and photos (Figma 707:3736).
  const [left, right] = cards === 'media' ? ['IconPlay', 'IconImages'] : ['IconLockKey', 'IconLockKey'];
  return (
    <div class="empty" role="status">
      <div class="fan" aria-hidden="true">
        <span class="fan__card is-left"><img src={icon(left)} alt="" class={left === 'IconPlay' ? 'is-dim' : ''} /></span>
        <span class="fan__card is-right"><img src={icon(right)} alt="" /></span>
        <span class="fan__card is-center"><img src={icon('IconPortfolioMark')} alt="" style={{ width: 20, height: 19.5 }} /></span>
        {plus && <span class="fan__plus"><img src={icon('IconPlus')} alt="" /></span>}
      </div>
      <div class="empty__text">
        <div class="empty__title">{title}</div>
        {text && <div class="empty__detail">{text}</div>}
      </div>
      {children && <div class="empty__action">{children}</div>}
    </div>
  );
}

/** KolabaSubtabStyle + KolabaCountBadge: 40 pt, radius 16, 16 pt in, Regular 14; chosen white with black text (its
 *  count dark), the others white 5 % with the text at 50 % (count white 30 %). */
export function Subtab({ label, count, on, onClick, locked }: { label: string; count?: number; on: boolean; onClick: () => void; locked?: boolean }) {
  return (
    <button class={`subtab ${on ? 'is-on' : ''}`} role="tab" aria-selected={on} onClick={onClick}>
      {label}{count !== undefined && !locked && <span class="subtab__count">{count > 999 ? '999+' : count}</span>}
      {locked && <img src={icon('IconLockKey')} alt="Locked" class="subtab__lock" />}
    </button>
  );
}

/** SortMenu: the sort glyph and "Sort" (Regular 14, white) — a 44 pt target. */
export const SortButton = ({ onClick, flipped }: { onClick: () => void; flipped?: boolean }) => (
  <button class="sort-btn" onClick={onClick}><img src={icon('IconSortAscending')} alt="" style={{ transform: flipped ? 'scaleY(-1)' : undefined }} />Sort</button>
);

/** ProfileFilterAddButton: 48 × 40, white 5 %, radius 16, the 16 pt plus. */
export const AddButton = ({ onClick, label = 'Add', busy }: { onClick: () => void; label?: string; busy?: string | null }) => (
  <button class="add-btn" aria-label={label} disabled={!!busy} onClick={onClick}>{busy ?? <img src={icon('IconPlus')} alt="" />}</button>
);

/** ProfileActionLabel(style: .filled, height 40): white, black Medium 12, the 16 pt icon 10 pt before it. */
export const ActionPill = ({ label, onClick, iconName = 'IconPlus' }: { label: string; onClick: () => void; iconName?: string }) => (
  <button class="action-pill" onClick={onClick}><img src={icon(iconName)} alt="" />{label}</button>
);

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

// ─── a video's real length: the API's duration, else the file's own metadata (read once, kept per id) ───

const durations = new Map<string, number>();
const pendingDurations = new Map<string, Promise<number | null>>();
function videoDuration(media: Media): Promise<number | null> {
  if (media.duration) return Promise.resolve(media.duration);
  if (durations.has(media.id)) return Promise.resolve(durations.get(media.id)!);
  if (!media.url) return Promise.resolve(null);
  if (!pendingDurations.has(media.id)) {
    pendingDurations.set(media.id, new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true;
      const done = (d: number | null) => { v.removeAttribute('src'); v.load(); if (d) durations.set(media.id, d); resolve(d); };
      v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
      v.onerror = () => done(null);
      window.setTimeout(() => done(null), 15000);
      v.src = media.url!;
    }));
  }
  return pendingDurations.get(media.id)!;
}

/** The ▶ and the length ("0:30", "1:24") on every video tile — never a made-up one. */
export function VideoTime({ media }: { media: Media }) {
  const [d, setD] = useState<number | null>(media.duration ?? durations.get(media.id) ?? null);
  useEffect(() => { let live = true; if (!d) void videoDuration(media).then((x) => { if (live && x) setD(x); }); return () => { live = false; }; }, [media.id]);
  return <span class="mtile__time"><Icon name="IconPlay" size={12} />{d ? fmtDuration(d) : null}</span>;
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
      {media.kind === 'video' && <VideoTime media={media} />}
    </button>
  );
}

// ─── pull to refresh: none on the web (the ТЗ removes the imitation). Data still refreshes on events and on return. ───

/** Kept as a seam so screens own their scroller ref; there is no pull gesture, indicator or glow reaction. */
export function usePullToRefresh(_onRefresh?: () => unknown, _deps: unknown[] = []) {
  const scroller = useRef<HTMLDivElement>(null);
  const Indicator = () => null;
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
  const screenW = a.width / k;
  const top = Math.max(70, Math.min(box.y, screenH - 40 - menuH - 12 - box.h));
  const clone = el.cloneNode(true) as HTMLElement;
  openSheet((close) => (
    <div class="ctx" onClick={close} onContextMenu={(e) => e.preventDefault()}>
      <div class="ctx__preview" style={{ left: box.x, top, width: box.w, height: box.h, ['--from' as any]: `${box.y - top}px` }}
        ref={(n) => { if (n && !n.firstChild) { clone.style.width = '100%'; clone.style.height = '100%'; n.appendChild(clone); } }} />
      <div class={`ctx__menu glass ${box.x + box.w / 2 > screenW / 2 ? 'is-end' : ''}`} role="menu"
        style={{ top: top + box.h + 12, ...(box.x + box.w / 2 > screenW / 2 ? { right: Math.max(16, screenW - box.x - box.w) } : { left: Math.max(16, box.x) }) }}
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

// ─── CollapsingHeader (KolabaTabbedScroll): one scroll offset drives the title, the tabs and their inset ───

/** The header's travel, from KolabaTabbedScroll / StickyTabs: the tabs rest at safe-top + 62 (124 pt) and pin at
 *  `pinTop` = safe-top − 2 + (44 − 40) / 2 = 62 pt, between the 44 pt controls — inset 16 → 16 + 44 + 8 = 68 pt.
 *  A section's title moves up with the content and fades over its first 48 pt (`startOfTravel(titleFade)`); a
 *  released scroll inside the travel ends collapsed or expanded (KolabaHeaderSnapBehavior, fling 150 pt/s). */
export const COLLAPSE = { restTop: 124, pinTop: 62, restInset: 16, pinnedInset: 68, titleFade: 48, flingSpeed: 150 };

export interface CollapseOptions { distance?: number; insetTravel?: number; snap?: boolean; fade?: number }

/** Writes --collapse-shift, --collapse-title (opacity) and --collapse-approach (0 … 1, the tabs' inset) on `root`
 *  from `scroller`'s offset — no re-render per frame; returns the refs to attach. */
export function useCollapsingHeader({ distance = COLLAPSE.restTop - COLLAPSE.pinTop, insetTravel, snap = true, fade = COLLAPSE.titleFade }: CollapseOptions = {},
  external?: { current: HTMLDivElement | null }, deps: unknown[] = []) {
  const root = useRef<HTMLDivElement>(null);
  const own = useRef<HTMLDivElement>(null);
  const scroller = external ?? own;
  useLayoutEffect(() => {
    const el = scroller.current; const host = root.current;
    if (!el || !host) return;
    let last = el.scrollTop; let lastT = performance.now(); let v = 0; let timer = 0; let touching = false;
    const tabsEl = () => host.querySelector<HTMLElement>('[data-collapse-tabs]');
    void uiScale;
    const paint = () => {
      const off = el.scrollTop;
      const shift = Math.min(off, distance);
      host.style.setProperty('--collapse-shift', `${Math.max(shift, -200)}px`);
      host.style.setProperty('--collapse-shift-n', String(Math.round(Math.max(shift, -200))));
      host.style.setProperty('--collapse-title', String(1 - Math.min(Math.max(Math.max(shift, 0) / Math.max(fade, 1), 0), 1)));
      // The tabs' own top on the screen (they may sit lower than the section's rest, e.g. a profile's).
      const tabs = tabsEl();
      let approach = Math.min(Math.max(shift / Math.max(distance, 1), 0), 1);
      if (tabs && insetTravel) {
        // Arithmetic, not the sticky element's live rect: its natural top (the zero-height anchor before it, plus
        // its margin) minus the offset, pinned at pinTop.
        const anchor = tabs.previousElementSibling as HTMLElement | null;
        const natural = anchor ? anchor.offsetTop + anchor.offsetHeight + parseFloat(getComputedStyle(tabs).marginTop || '0') : tabs.offsetTop;
        const pin = parseFloat(getComputedStyle(tabs).top) || COLLAPSE.pinTop;
        const top = Math.max(natural - off, pin);
        approach = Math.min(Math.max(1 - (top - pin) / insetTravel, 0), 1);
      }
      host.style.setProperty('--collapse-approach', approach.toFixed(4));
    };
    const settle = () => {
      if (!snap || touching) return;
      const off = el.scrollTop;
      if (off <= 0.5 || off >= distance - 0.5) return;
      const target = v > COLLAPSE.flingSpeed ? distance : v < -COLLAPSE.flingSpeed ? 0 : off >= distance / 2 ? distance : 0;
      el.scrollTo({ top: target, behavior: 'smooth' });
    };
    const onScroll = () => {
      const now = performance.now(); const off = el.scrollTop;
      const dt = Math.max(now - lastT, 1); v = ((off - last) / dt) * 1000 * 0.6 + v * 0.4; last = off; lastT = now;
      paint();
      window.clearTimeout(timer); timer = window.setTimeout(settle, 140);
    };
    const down = () => { touching = true; };
    const up = () => { touching = false; window.clearTimeout(timer); timer = window.setTimeout(settle, 140); };
    paint();
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('touchstart', down, { passive: true }); el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    el.addEventListener('pointerdown', down); window.addEventListener('pointerup', up);
    const ro = new ResizeObserver(paint); ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll); el.removeEventListener('touchstart', down); el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up); el.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up);
      ro.disconnect(); window.clearTimeout(timer);
    };
  }, [distance, insetTravel, snap, fade, ...deps]);
  // A tab change (KolabaTabScrollCoordinator.beginPaging): the header stays where it is; with the header collapsed the
  // new tab shows at its own saved place past the pinned tabs, otherwise at its top. Never a jump to the top.
  const saved = useRef<Record<string, number>>({});
  const travel = () => {
    const tabs = root.current?.querySelector<HTMLElement>('[data-collapse-tabs]');
    if (!insetTravel || !tabs) return distance;
    const anchor = tabs.previousElementSibling as HTMLElement | null;
    const natural = anchor ? anchor.offsetTop + anchor.offsetHeight + parseFloat(getComputedStyle(tabs).marginTop || '0') : tabs.offsetTop;
    return Math.max(0, natural - (parseFloat(getComputedStyle(tabs).top) || COLLAPSE.pinTop));
  };
  const changeTab = (from: string | number, to: string | number, apply: () => void) => {
    const el = scroller.current;
    if (!el) { apply(); return; }
    const d = travel(); const off = el.scrollTop; const collapsed = off >= d - 0.5;
    saved.current[String(from)] = collapsed ? off - d : 0;
    apply();
    requestAnimationFrame(() => { el.scrollTop = Math.min(off, d) + (collapsed ? saved.current[String(to)] ?? 0 : 0); });
  };
  return { root, scroller, changeTab };
}
