// Shared admin components (Figma: "KOLABA Admin / …" components and the Reusable UI states kit).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, errorText } from './api';
import chevronDown from './assets/icons/chevron-down.svg';
import chevronLeft from './assets/icons/chevron-left.svg';
import chevronRight from './assets/icons/chevron-right.svg';
import ellipsis from './assets/icons/ellipsis.svg';
import searchIcon from './assets/icons/search.svg';
import shieldCheck from './assets/icons/shield-check.svg';

export const Icon = ({ src, size = 17, className }: { src: string; size?: number; className?: string }) =>
  <img src={src} width={size} height={size} alt="" className={`icon ${className ?? ''}`} aria-hidden="true" />;

// ─── formatting ───

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const utcFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' });
export const fmtDate = (t?: number | null) => (t ? dateFmt.format(t) : '—');
export const fmtDateTime = (t?: number | null) => (t ? timeFmt.format(t) : '—');
export const fmtUTC = (t?: number | null) => (t ? utcFmt.format(t) : '—');
export const fmtNum = (n?: number | null) => (n ?? 0).toLocaleString('en-US');
export const fmtBytes = (n?: number | null) => (!n ? '—' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
export const fmtDuration = (s?: number | null) => (s ? `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}` : null);
export const initials = (text: string) => text.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

// ─── data loading ───

export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    load(ctrl.signal).then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => { if (error?.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false })); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

// ─── toasts ───

type Toast = { id: number; title: string; text?: string; tone: 'ok' | 'error' };
let pushToast: (t: Omit<Toast, 'id'>) => void = () => {};
export const toast = { ok: (title: string, text?: string) => pushToast({ title, text, tone: 'ok' }),
                       error: (title: string, text?: string) => pushToast({ title, text, tone: 'error' }) };

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let seq = 0;
    pushToast = (t) => {
      const id = ++seq;
      setItems((list) => [...list.slice(-2), { ...t, id }]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), t.tone === 'error' ? 7000 : 4500);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast is-${t.tone}`}>
          <span className="toast__mark">{t.tone === 'ok' ? <CheckGlyph /> : '!'}</span>
          <div className="toast__body"><b>{t.title}</b>{t.text && <span>{t.text}</span>}</div>
          <button className="toast__close" aria-label="Dismiss" onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}><CloseGlyph /></button>
        </div>
      ))}
    </div>
  );
}

export const CheckGlyph = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const CloseGlyph = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
export const ExternalGlyph = () => <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M8 2h4v4M12 2L6.5 7.5M10.5 8.5V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const BackGlyph = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8.5 3L4.5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;

// ─── buttons ───

export function Button({ children, variant = 'secondary', loading, disabled, onClick, type = 'button', small, href, title }: {
  children: ReactNode; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; loading?: boolean; disabled?: boolean;
  onClick?: () => void; type?: 'button' | 'submit'; small?: boolean; href?: string | null; title?: string;
}) {
  const cls = `btn btn--${variant} ${small ? 'btn--small' : ''} ${loading ? 'is-loading' : ''}`;
  if (href) return <a className={cls} href={href} target="_blank" rel="noopener noreferrer" title={title}>{children}</a>;
  return (
    <button type={type} className={cls} disabled={disabled || loading} onClick={onClick} title={title}>
      {loading && <span className="spinner" aria-hidden="true" />}{children}
    </button>
  );
}

// ─── dropdown (filters) and row menus ───

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', on);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', key); };
  }, [open, close]);
  return ref;
}

export function Select<V extends string>({ label, value, options, onChange }: {
  label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className="dropdown" ref={ref}>
      <button className={`filter ${open ? 'is-open' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        {label}: {current?.label}<Icon src={chevronDown} size={13} />
      </button>
      {open && (
        <div className="menu" role="listbox">
          {options.map((o) => (
            <button key={o.value} role="option" aria-selected={o.value === value} className={`menu__item ${o.value === value ? 'is-on' : ''}`}
                    onClick={() => { onChange(o.value); setOpen(false); }}>
              {o.label}{o.value === value && <CheckGlyph />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface MenuAction { label: string; onClick?: () => void; href?: string | null; danger?: boolean; hidden?: boolean; icon?: ReactNode }

export function RowMenu({ actions, label = 'Actions' }: { actions: MenuAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const shown = actions.filter((a) => !a.hidden);
  return (
    <div className="dropdown dropdown--end" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon src={ellipsis} size={18} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {shown.map((a) => a.href !== undefined
            ? (a.href
              ? <a key={a.label} role="menuitem" className="menu__item" href={a.href} target={a.href.startsWith('#') ? undefined : '_blank'}
                   rel="noopener noreferrer" onClick={() => setOpen(false)}>{a.label}{a.icon}</a>
              : null)
            : <button key={a.label} role="menuitem" className={`menu__item ${a.danger ? 'is-danger' : ''}`}
                      onClick={() => { setOpen(false); a.onClick?.(); }}>{a.label}</button>)}
          <div className="menu__note">Sensitive actions require confirmation.</div>
        </div>
      )}
    </div>
  );
}

// ─── search ───

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  return (
    <label className="search">
      <Icon src={searchIcon} size={17} />
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value ? <button className="search__clear" aria-label="Clear search" onClick={() => onChange('')}><CloseGlyph /></button>
             : <span className="search__kbd">⌘ K</span>}
    </label>
  );
}

// ─── status ───

const tones: Record<string, string> = {
  active: 'green', visible: 'green', published: 'green', success: 'green',
  blocked: 'amber', hidden: 'amber', closed: 'muted', draft: 'muted',
  deleted: 'red', failure: 'red',
};
const labels: Record<string, string> = { blocked: 'Blocked', deleted: 'Deleted', hidden: 'Hidden', visible: 'Visible' };
export const Status = ({ value }: { value: string }) => (
  <span className={`status is-${tones[value] ?? 'muted'}`}><i />{labels[value] ?? value.charAt(0).toUpperCase() + value.slice(1)}</span>
);

export function Avatar({ url, name, size = 34 }: { url?: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return url && !broken
    ? <img className="avatar" src={url} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />
    : <span className="avatar avatar--text" style={{ width: size, height: size }}>{initials(name)}</span>;
}

// ─── states ───

export const Loading = ({ label = 'Loading…' }: { label?: string }) => <div className="state"><span className="spinner spinner--big" />{label}</div>;

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  if (error instanceof ApiError && error.status === 401) return null; // the app returns to the sign-in screen
  return (
    <div className="state state--error">
      <div className="state__badge">!</div>
      <b>Couldn’t load data</b>
      <span>{errorText(error)}</span>
      {retry && <Button small onClick={retry}>Try again</Button>}
    </div>
  );
}

export const Empty = ({ title, text, action }: { title: string; text?: string; action?: ReactNode }) => (
  <div className="state">
    <div className="state__badge"><Icon src={shieldCheck} size={16} /></div>
    <b>{title}</b>{text && <span>{text}</span>}{action}
  </div>
);

// ─── pagination ───

export function Pagination({ page, limit, total, onPage, onLimit, noun = '' }: {
  page: number; limit: number; total: number; onPage: (p: number) => void; onLimit: (n: number) => void; noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(page * limit, total);
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  return (
    <div className="pagination">
      <span>Showing {fmtNum(from)}–{fmtNum(to)} of {fmtNum(total)}{noun && ` ${noun}`}</span>
      <div className="pagination__controls">
        <Select label="Rows per page" value={String(limit)} options={[10, 20, 50].map((n) => ({ value: String(n), label: String(n) }))}
                onChange={(v) => onLimit(Number(v))} />
        {nums.map((n, i) => (
          <span key={n} className="pagination__group">
            {i > 0 && n - nums[i - 1]! > 1 && <span className="pagination__gap">…</span>}
            <button className={`page ${n === page ? 'is-on' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>
          </span>
        ))}
        <button className="icon-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><Icon src={chevronLeft} size={16} /></button>
        <button className="icon-btn" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><Icon src={chevronRight} size={16} /></button>
      </div>
    </div>
  );
}

// ─── modals ───

export function Modal({ title, children, onClose, width = 480 }: { title: string; children: ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width }}>
        <div className="modal__head"><h2>{title}</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><CloseGlyph /></button></div>
        {children}
      </div>
    </div>, document.body);
}

/** Confirmation for sensitive actions; `reason` adds a required reason field, `typeToConfirm` a typed word. */
export function ConfirmModal({ title, text, confirmLabel, danger, reason, reasonOptional, typeToConfirm, onConfirm, onClose }: {
  title: string; text: ReactNode; confirmLabel: string; danger?: boolean; reason?: boolean; reasonOptional?: boolean; typeToConfirm?: string;
  onConfirm: (reason: string) => Promise<void>; onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = (!reason || reasonOptional || value.trim().length >= 3) && (!typeToConfirm || typed === typeToConfirm);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await onConfirm(value.trim()); onClose(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (ready) submit(); }}>
        <div className="modal__text">{text}</div>
        {reason && (
          <Field label={reasonOptional ? 'Reason (optional)' : 'Reason'}>
            <textarea className="input" rows={3} maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} autoFocus
                      placeholder="Visible in Activity Logs" />
          </Field>
        )}
        {typeToConfirm && (
          <Field label={`Type ${typeToConfirm} to confirm`}>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal__actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!ready}>{confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="field"><span className="field__label">{label}</span>{children}{hint && <span className="field__hint">{hint}</span>}</label>
);

/** Holds the one open modal of a page. */
export function useModal() {
  const [node, setNode] = useState<ReactNode>(null);
  return { modal: node, open: (render: (close: () => void) => ReactNode) => setNode(render(() => setNode(null))) };
}

export function KPI({ label, value, note, icon }: { label: string; value: ReactNode; note?: ReactNode; icon?: string }) {
  return (
    <div className="kpi">
      <div className="kpi__label"><span>{label}</span>{icon && <Icon src={icon} size={17} />}</div>
      <div className="kpi__value">{value}</div>
      {note && <div className="kpi__note">{note}</div>}
    </div>
  );
}
