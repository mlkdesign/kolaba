// Shared UI pieces: icons, avatars, ratings, headers, sheets, empty states, formatting.
import { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Card, Media } from './api';
import { back, openSheet, sheets } from './state';

export const BASE: string = (import.meta as any).env?.BASE_URL ?? '/';
export const icon = (name: string) => `${BASE}icons/${name}.svg`;

export function Icon({ name, size = 22, alt = '' }: { name: string; size?: number; alt?: string }) {
  return <img src={icon(name)} width={size} height={size} alt={alt} draggable={false} />;
}

const palette = [['#FF00A6', '#9000FF'], ['#00AEFF', '#2D5BFF'], ['#FF7A00', '#FF0077'], ['#00C2A8', '#0074FF'], ['#B200FF', '#FF4D9D'],
  ['#5DCD41', '#00AEFF'], ['#FFB800', '#FF3D00']];
export function gradientFor(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = palette[h % palette.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function Avatar({ card, size = 44 }: { card: Pick<Card, 'displayName' | 'avatarUrl' | 'type'> | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!card) return <div class="avatar" style={{ width: size, height: size }} />;
  const business = card.type === 'business';
  return (
    <div class={`avatar ${business ? 'is-business' : ''}`} style={{ width: size, height: size, fontSize: size * 0.38,
      background: card.avatarUrl && !broken ? '#222' : gradientFor(card.displayName) }}>
      {card.avatarUrl && !broken
        ? <img src={card.avatarUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
        : <span>{initials(card.displayName)}</span>}
    </div>
  );
}

export function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <span class="stars" aria-label={`${value.toFixed(1)} of 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i class="star" style={{ width: size, height: size, ['--fill' as any]: `${Math.min(Math.max(value - i, 0), 1) * 100}%` }} />
      ))}
    </span>
  );
}

export function RatingInline({ rating, count }: { rating: number | null; count: number }) {
  if (!rating || !count) return <span class="muted" style={{ fontSize: 12 }}>No reviews yet</span>;
  return <span class="rating-inline"><i class="star" style={{ ['--fill' as any]: '100%' }} />{rating.toFixed(1)}<span class="muted">({count})</span></span>;
}

export function ProBadge({ card }: { card: Pick<Card, 'isPro' | 'type'> }) {
  if (!card.isPro) return null;
  return <span class={`pro ${card.type === 'business' ? 'is-business' : ''}`}>{card.type === 'business' ? 'business.pro' : 'PRO'}</span>;
}

export const DemoTag = ({ card }: { card: Pick<Card, 'isDemo'> }) => (card.isDemo ? <span class="demo-tag" title="Demo profile">DEMO</span> : null);

export function TopBar({ title, children, onBack, logo }: { title?: string; children?: ComponentChildren; onBack?: (() => void) | false; logo?: string }) {
  return (
    <header class="topbar">
      {onBack !== false && !logo && (
        <button class="glass-btn" aria-label="Back" onClick={() => (onBack ? onBack() : back())}><Icon name="IconArrowLeft" /></button>
      )}
      {logo ? <div class="logo-word">{logo}<i>.</i></div> : <div class="topbar__title">{title}</div>}
      {children ?? (onBack !== false && !logo ? <span class="topbar__spacer" /> : null)}
    </header>
  );
}

export function Empty({ title, text, iconName = 'IconFolderSimpleDashed', children }: { title: string; text?: string; iconName?: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty__icon"><Icon name={iconName} size={28} /></div>
      <div class="empty__title">{title}</div>
      {text && <div>{text}</div>}
      {children && <div style={{ marginTop: 18 }}>{children}</div>}
    </div>
  );
}

export const Spinner = () => <div class="spinner" role="status" aria-label="Loading" />;

export function SheetFrame({ title, close, children }: { title?: string; close: () => void; children: ComponentChildren }) {
  return (
    <>
      <div class="sheet__grabber" />
      <div class="sheet__head">
        <span style={{ width: 32 }} />
        <div class="sheet__title">{title}</div>
        <button class="sheet__close" aria-label="Close" onClick={close}><Icon name="IconSheetClose" size={14} /></button>
      </div>
      <div class="sheet__body">{children}</div>
    </>
  );
}

export function Sheets() {
  return (
    <>
      {sheets.value.map((s) => {
        const close = () => { sheets.value = sheets.value.filter((x) => x.id !== s.id); };
        return (
          <div class="sheet-root" key={s.id}>
            <div class="sheet-backdrop" onClick={close} />
            <div class={`sheet ${s.tall ? 'is-tall' : ''}`} role="dialog" aria-modal="true">{s.render(close)}</div>
          </div>
        );
      })}
    </>
  );
}

/** Confirm dialog as a small sheet. */
export function confirmSheet(title: string, text: string, action: string, onConfirm: () => void, danger = false) {
  openSheet((close) => (
    <SheetFrame title={title} close={close}>
      <p class="soft" style={{ fontSize: 15, lineHeight: 1.45, marginTop: 0 }}>{text}</p>
      <button class={`btn ${danger ? 'danger' : ''}`} onClick={() => { close(); onConfirm(); }}>{action}</button>
      <button class="btn secondary" style={{ marginTop: 10 }} onClick={close}>Cancel</button>
    </SheetFrame>
  ));
}

/** Full-screen media viewer (photo or video) inside the device screen. */
export function openViewer(media: Media) {
  openSheet((close) => (
    <div class="viewer" onClick={close}>
      {media.kind === 'video'
        ? <video src={media.url ?? undefined} poster={media.posterUrl ?? undefined} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
        : <img src={media.url ?? undefined} alt="" />}
      <button class="glass-btn" aria-label="Close" onClick={close}><Icon name="IconSheetClose" size={16} /></button>
    </div>
  ));
}

export function MediaTile({ media, onOpen }: { media: Media; onOpen?: () => void }) {
  const [broken, setBroken] = useState(false);
  const src = media.kind === 'video' ? media.posterUrl : media.url;
  return (
    <button class="media-tile" onClick={onOpen ?? (() => openViewer(media))} aria-label={media.title ?? media.kind}>
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
        : <div style={{ position: 'absolute', inset: 0, background: gradientFor(media.id) }} />}
      {media.kind === 'video' && (
        <span class="media-tile__badge"><Icon name="IconPlay" size={11} />{media.duration ? fmtDuration(media.duration) : ''}</span>
      )}
    </button>
  );
}

// ─── formatting ───

export function fmtDuration(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtCount(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
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
    load(controller.signal).then((d) => { if (id === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (id === seq.current && e?.name !== 'AbortError') setError(e); })
      .finally(() => { if (id === seq.current) setLoading(false); });
    return controller;
  };
  useEffect(() => { const c = run(); return () => c.abort(); }, deps);
  return { data, error, loading, reload: run, setData };
}

/** Debounced value (search fields). */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(t); }, [value]);
  return v;
}

export const flagLocation = (c: { flag: string | null; location: string | null }) => (c.location ? `${c.flag ?? ''} ${c.location}`.trim() : null);
