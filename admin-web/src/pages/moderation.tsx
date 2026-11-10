// Moderation — reports from the apps (profiles, posts, media, messages, reviews) and automatic checks.
// Moderators see only what a report shares: for messages, the copy the reporter agreed to share — never a conversation.
// Every action is confirmed, needs a reason when it affects someone, and is written to the audit log.
import { useState } from 'react';
import { api, query, type Card, type Paged } from '../api';
import { PageHeader } from '../app';
import { href, navigate, useRemembered } from '../router';
import {
  Avatar, Button, ConfirmModal, Empty, ErrorState, ExternalGlyph, Field, Icon, KPI, Loading, Modal, Pagination, SearchField, Select, Status,
  fmtDate, fmtDateTime, fmtNum, toast, useDebounced, useLoad, useModal,
} from '../ui';
import flagIcon from '../assets/icons/nav-moderation.svg';
import shieldCheck from '../assets/icons/shield-check.svg';
import usersIcon from '../assets/icons/users.svg';

export const CATEGORY_LABELS: Record<string, string> = {
  spam: 'Spam', sexual: 'Nudity / Sexual', violence: 'Violence / Dangerous', harassment: 'Harassment / Bullying', hate: 'Hate Speech',
  scam: 'Scam / Fraud', impersonation: 'Fake Account / Impersonation', copyright: 'Copyright Violation', illegal: 'Illegal Content', other: 'Other',
};
const TYPE_LABELS: Record<string, string> = { user: 'Profile', post: 'Post', media: 'Media', message: 'Message', conversation: 'Conversation', review: 'Review' };
const STATUS_LABELS: Record<string, string> = { pending: 'Pending', under_review: 'Under review', resolved: 'Resolved', dismissed: 'Dismissed' };
const TABS: [string, string][] = [['', 'All'], ['profiles', 'Profiles'], ['posts', 'Posts'], ['media', 'Media'], ['messages', 'Messages'], ['reviews', 'Reviews']];

interface ReportRow {
  id: string; source: 'user' | 'auto'; targetType: string; targetId: string; category: string; details: string | null; priority: 'normal' | 'high' | 'urgent';
  status: string; resolution: string | null; createdAt: number; updatedAt: number; handledAt: number | null; handledBy: string | null;
  context: { title?: string; excerpt?: string; username?: string; kind?: string; purpose?: string };
  reporter: (Card & { userId?: string }) | null; reportedUser: (Card & { userId?: string }) | null; targetUserId: string | null; sharedMessages: boolean;
}
interface Stats { pendingReports: number; underReview: number; resolved: number; rejectedReports: number; restrictedUsers: number; urgent: number }

export function ReportStatus({ value }: { value: string }) {
  const tone = value === 'pending' ? 'amber' : value === 'under_review' ? 'amber' : value === 'resolved' ? 'green' : 'muted';
  return <span className={`status is-${tone}`}><i />{STATUS_LABELS[value] ?? value}</span>;
}
const Priority = ({ value }: { value: string }) => value === 'normal' ? <span className="cell-muted">Normal</span>
  : <span className={`priority priority--${value}`}>{value === 'urgent' ? 'Urgent' : 'High'}</span>;

export function ModerationPage() {
  const [tab, setTab] = useRemembered('mod.tab', '');
  const [search, setSearch] = useRemembered('mod.q', '');
  const [category, setCategory] = useRemembered('mod.category', '');
  const [status, setStatus] = useRemembered('mod.status', 'open');
  const [range, setRange] = useRemembered('mod.range', '');
  const [sort, setSort] = useRemembered('mod.sort', 'priority');
  const [page, setPage] = useRemembered('mod.page', 1);
  const [limit, setLimit] = useRemembered('mod.limit', 20);
  const q = useDebounced(search);
  const from = range ? Date.now() - Number(range) * 86_400_000 : undefined;
  const stats = useLoad<Stats>((s) => api('GET', '/moderation/stats', undefined, s), []);
  const list = useLoad<Paged<ReportRow>>((s) => api('GET', `/reports${query({ tab, q, category, status, from, sort, page, limit })}`, undefined, s),
                                         [tab, q, category, status, range, sort, page, limit]);
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const st = stats.data;
  return (
    <>
      <PageHeader title="Moderation" subtitle="Reports about profiles, posts, media, messages and reviews"
                  actions={<Button small onClick={() => { stats.reload(); list.reload(); }}>Refresh</Button>} />
      <div className="content">
        {st && (
          <div className="kpis kpis--5">
            <KPI label="Pending Reports" icon={flagIcon} value={fmtNum(st.pendingReports)} note={st.urgent ? <span className="text-red">{fmtNum(st.urgent)} urgent</span> : 'Waiting for a moderator'} />
            <KPI label="Under Review" icon={flagIcon} value={fmtNum(st.underReview)} note="Taken by a moderator" />
            <KPI label="Resolved" icon={shieldCheck} value={fmtNum(st.resolved)} note="Action taken" />
            <KPI label="Rejected Reports" icon={shieldCheck} value={fmtNum(st.rejectedReports)} note="Dismissed — no violation" />
            <KPI label="Restricted Users" icon={usersIcon} value={fmtNum(st.restrictedUsers)} note="Restricted, suspended or banned" />
          </div>
        )}
        <div className="tabs" role="tablist">
          {TABS.map(([v, l]) => (
            <button key={v} role="tab" aria-selected={tab === v} className={`tab ${tab === v ? 'is-on' : ''}`} onClick={() => filter(setTab)(v)}>
              {l}{tab === v && list.data ? ` · ${fmtNum(list.data.total)}` : ''}
            </button>
          ))}
        </div>
        <div className="toolbar">
          <SearchField value={search} onChange={filter(setSearch)} placeholder="Search report ID, user ID, name or @username" />
          <Select label="Category" value={category} onChange={filter(setCategory)}
                  options={[{ value: '', label: 'All' }, ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))]} />
          <Select label="Status" value={status} onChange={filter(setStatus)} options={[{ value: '', label: 'All' }, { value: 'open', label: 'Open' },
            { value: 'pending', label: 'Pending' }, { value: 'under_review', label: 'Under review' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismissed', label: 'Dismissed' }]} />
          <Select label="Date" value={range} onChange={filter(setRange)} options={[{ value: '', label: 'Any time' }, { value: '1', label: 'Last 24 h' },
            { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }]} />
          <Select label="Sort" value={sort} onChange={filter(setSort)} options={[{ value: 'priority', label: 'Priority' }, { value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }]} />
        </div>
        <div className="table">
          <div className="table__head table__row reports-grid">
            <span>Report ID</span><span>Reported content</span><span>Target type</span><span>Category</span><span>Reporter</span><span>Reported user</span>
            <span>Date</span><span>Status</span><span>Actions</span>
          </div>
          {list.error ? <ErrorState error={list.error} retry={list.reload} /> : !list.data ? <Loading /> :
            list.data.items.length === 0 ? <Empty title="No reports" text={q || category || tab || status ? 'Nothing matches these filters.' : 'No one has reported anything yet.'} /> : (
            <div className={list.loading ? 'is-refreshing' : ''}>
              {list.data.items.map((r) => (
                <div key={r.id} className={`table__row reports-grid is-link ${r.priority === 'urgent' && ['pending', 'under_review'].includes(r.status) ? 'is-urgent' : ''}`}
                     onClick={() => navigate(`/moderation/${r.id}`)} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/moderation/${r.id}`); }}>
                  <span className="cell-mono ellipsis" title={r.id}>{r.id.slice(0, 14)}…</span>
                  <span className="cell-user__text">
                    <b className="regular">{r.context.title ?? r.context.excerpt ?? (r.targetType === 'message' || r.targetType === 'conversation' ? 'Shared messages' : r.targetId)}</b>
                    <span>{r.details ?? (r.source === 'auto' ? 'Automatic check' : '—')}</span>
                  </span>
                  <span className="cell-muted">{TYPE_LABELS[r.targetType] ?? r.targetType}</span>
                  <span className="cell-user__text"><b className="regular">{CATEGORY_LABELS[r.category] ?? r.category}</b><span><Priority value={r.priority} /></span></span>
                  <span className="cell-muted ellipsis">{r.source === 'auto' ? 'System' : r.reporter ? `@${r.reporter.username ?? '—'}` : 'Deleted account'}</span>
                  <span className="cell-muted ellipsis">{r.reportedUser ? `@${r.reportedUser.username ?? r.reportedUser.id}` : '—'}</span>
                  <span className="cell-muted">{fmtDate(r.createdAt)}</span>
                  <span><ReportStatus value={r.status} /></span>
                  <span className="cell-actions"><a className="link-sm" href={href(`/moderation/${r.id}`)} onClick={(e) => e.stopPropagation()}>Open ›</a></span>
                </div>
              ))}
            </div>
          )}
          {list.data && list.data.total > 0 && (
            <Pagination page={page} limit={limit} total={list.data.total} noun="reports" onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
          )}
        </div>
        <p className="safeguard"><Icon src={shieldCheck} size={14} />Reporters’ identities are never shown to the reported person. Opening shared messages is recorded in Activity Logs.</p>
      </div>
    </>
  );
}

// ─── one report ───

interface Evidence { messageId: string; isReported: boolean; body: string; sentAt: number; sender: Card | { id: string };
                     attachments: { kind: string; url: string | null }[] }
interface ReportDetail {
  report: ReportRow; evidence: Evidence[];
  target: { kind: string; publicUrl?: string | null; profile?: Card & { bio: string; status: string };
            post?: { id: string; title: string; description: string; reviewStatus: string; status: string; media: { url: string | null; kind: string }[] };
            media?: { id: string; kind: string; url: string | null; posterUrl: string | null; purpose: string; reviewStatus: string };
            review?: { comment: string; quality: number; speed: number; contact: number; reviewStatus: string } } | null;
  history: { id: string; category: string; status: string; source: string; createdAt: number }[];
  actions: { id: string; reportId: string | null; action: string; reason: string | null; adminEmail: string; detail: { days?: number } | null; createdAt: number }[];
}

type Action = 'review' | 'dismiss' | 'resolve' | 'remove_content' | 'restore_content' | 'warn' | 'restrict' | 'unrestrict' | 'suspend' | 'unsuspend' | 'ban';
const ACTION_COPY: Record<Action, { title: string; label: string; danger?: boolean; reason?: boolean; text: string }> = {
  review: { title: 'Take for review', label: 'Mark under review', text: 'Mark this report as under review.' },
  dismiss: { title: 'Dismiss report', label: 'Dismiss report', reason: true, text: 'No violation: close this report without action. The content stays as it is.' },
  resolve: { title: 'Mark as resolved', label: 'Mark as resolved', reason: true, text: 'Close this report as handled.' },
  remove_content: { title: 'Remove content', label: 'Remove content', danger: true, reason: true,
    text: 'Remove the reported item from KOLABA for everyone. Nothing is erased: it stays in storage as evidence and can be restored.' },
  restore_content: { title: 'Restore content', label: 'Restore content', text: 'Make the removed item visible again.' },
  warn: { title: 'Warn user', label: 'Send warning', reason: true, text: 'The user gets an in-app notice with your reason. No other effect.' },
  restrict: { title: 'Temporarily restrict user', label: 'Restrict user', danger: true, reason: true,
    text: 'The user can still sign in and read, but can’t post jobs, upload media, send messages, apply, review or send contact requests until the restriction ends.' },
  unrestrict: { title: 'Lift restriction', label: 'Lift restriction', text: 'Let the user post again now.' },
  suspend: { title: 'Suspend account', label: 'Suspend account', danger: true, reason: true,
    text: 'The account is signed out everywhere and can’t sign in until you unsuspend it. Its content stays.' },
  unsuspend: { title: 'Unsuspend account', label: 'Unsuspend', text: 'Let the account sign in again (also lifts a ban).' },
  ban: { title: 'Permanently ban account', label: 'Ban permanently', danger: true, reason: true,
    text: 'The account is signed out, its profiles are hidden, and its e-mail address can’t be used to sign up again. Use only for serious or repeated violations.' },
};

export function ReportPage({ id }: { id: string }) {
  const detail = useLoad<ReportDetail>((s) => api('GET', `/reports/${id}`, undefined, s), [id]);
  const { modal, open } = useModal();
  const act = (action: Action, endpoint = `/reports/${id}/action`) => open((close) => action === 'restrict'
    ? <RestrictModal onClose={close} onConfirm={async (reason, days) => {
        await api('POST', endpoint, { action, reason, days, confirm: true });
        toast.ok('User restricted', `For ${days} day${days === 1 ? '' : 's'}. Recorded in Activity Logs.`); detail.reload();
      }} />
    : <ConfirmModal title={ACTION_COPY[action].title} danger={ACTION_COPY[action].danger} reason={ACTION_COPY[action].reason}
        reasonOptional={action === 'dismiss' || action === 'resolve'} typeToConfirm={action === 'ban' ? 'BAN' : undefined}
        confirmLabel={ACTION_COPY[action].label} text={ACTION_COPY[action].text} onClose={close}
        onConfirm={async (reason) => {
          await api('POST', endpoint, { action, reason: reason || undefined, confirm: true });
          toast.ok(ACTION_COPY[action].title, 'Recorded in Activity Logs.'); detail.reload();
        }} />);
  if (detail.error) return <><PageHeader title="Report" back={{ to: '/moderation', label: 'Moderation' }} /><div className="content"><ErrorState error={detail.error} retry={detail.reload} /></div></>;
  if (!detail.data) return <><PageHeader title="Report" back={{ to: '/moderation', label: 'Moderation' }} /><div className="content"><Loading /></div></>;
  const { report: r, target, evidence, history, actions } = detail.data;
  const open_ = ['pending', 'under_review'].includes(r.status);
  const removable = ['user', 'post', 'media', 'review', 'message'].includes(r.targetType);
  return (
    <>
      <PageHeader title={`${CATEGORY_LABELS[r.category] ?? r.category} · ${TYPE_LABELS[r.targetType] ?? r.targetType}`}
                  subtitle={<>Report {r.id} · {fmtDateTime(r.createdAt)} · <ReportStatus value={r.status} /></>}
                  back={{ to: '/moderation', label: 'Moderation' }}
                  actions={target?.publicUrl ? <Button small href={target.publicUrl}>View live <ExternalGlyph /></Button> : undefined} />
      <div className="content">
        <div className="detail">
          <div className="detail__main">
            <section className="panel">
              <div className="panel__head"><div><h2>Reason</h2><p>{r.source === 'auto' ? 'Automatic check (routes to a human — never decides alone)' : 'From the reporter'}</p></div><Priority value={r.priority} /></div>
              <p className="prose">{r.details || 'No comment from the reporter.'}</p>
            </section>
            <section className="panel">
              <div className="panel__head"><div><h2>Reported {TYPE_LABELS[r.targetType]?.toLowerCase() ?? 'item'}</h2><p>{r.targetId}</p></div></div>
              <TargetView detail={detail.data} />
            </section>
            {(r.targetType === 'message' || r.targetType === 'conversation') && (
              <section className="panel">
                <div className="panel__head"><div><h2>Shared messages</h2><p>Only what the reporter agreed to share · access is logged · purged 180 days after closing</p></div></div>
                {evidence.length === 0 ? <p className="cell-muted">No messages were shared (or they were purged after the retention period).</p> : (
                  <ul className="evidence">
                    {evidence.map((e) => (
                      <li key={e.messageId} className={e.isReported ? 'is-reported' : ''}>
                        <div className="evidence__meta"><b>{'username' in e.sender ? `@${e.sender.username}` : e.sender.id}</b><span>{fmtDateTime(e.sentAt)}</span>{e.isReported && <em className="chip">Reported</em>}</div>
                        {e.body && <p className="prose">{e.body}</p>}
                        {e.attachments.map((a, i) => a.url && (
                          a.kind === 'photo' ? <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"><img className="evidence__img" src={a.url} alt="Attachment" /></a>
                          : a.kind === 'video' ? <video key={i} className="evidence__img" src={a.url} controls preload="metadata" />
                          : <audio key={i} src={a.url} controls preload="none" />
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            <section className="panel">
              <div className="panel__head"><div><h2>Moderation history</h2><p>Decisions about this item and this account</p></div></div>
              {actions.length === 0 ? <p className="cell-muted">No decisions yet.</p> : (
                <ul className="history history--3">
                  {actions.map((a) => (
                    <li key={a.id}><span className="cell-muted">{fmtDateTime(a.createdAt)}</span><b>{a.action.replace('_', ' ')}{a.detail?.days ? ` · ${a.detail.days} d` : ''}</b>
                      <span className="cell-muted ellipsis">{a.reason ?? '—'} · {a.adminEmail}</span></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <div className="detail__side">
            <section className="panel">
              <div className="panel__head"><div><h2>Actions</h2><p>Dangerous actions ask for confirmation</p></div></div>
              <div className="action-list">
                {r.status === 'pending' && <Button onClick={() => act('review')}>Take for review</Button>}
                {open_ && <Button onClick={() => act('dismiss')}>Dismiss report</Button>}
                {open_ && <Button onClick={() => act('resolve')}>Mark as resolved</Button>}
                {removable && <Button variant="danger" onClick={() => act('remove_content')}>Remove content</Button>}
                {removable && <Button onClick={() => act('restore_content')}>Restore content</Button>}
                {r.targetUserId && <>
                  <hr />
                  <Button onClick={() => act('warn')}>Warn user</Button>
                  <Button variant="danger" onClick={() => act('restrict')}>Temporarily restrict</Button>
                  <Button onClick={() => act('unrestrict')}>Lift restriction</Button>
                  <Button variant="danger" onClick={() => act('suspend')}>Suspend account</Button>
                  <Button variant="danger" onClick={() => act('ban')}>Permanently ban</Button>
                  <Button onClick={() => act('unsuspend')}>Unsuspend / unban</Button>
                </>}
              </div>
            </section>
            <section className="panel">
              <div className="panel__head"><div><h2>People</h2></div></div>
              <PersonRow label="Reporter" card={r.source === 'auto' ? null : r.reporter} fallback={r.source === 'auto' ? 'Automatic check' : 'Deleted account'} />
              <PersonRow label="Reported user" card={r.reportedUser} fallback="—" />
            </section>
            <section className="panel">
              <div className="panel__head"><div><h2>Earlier reports</h2><p>About this item or this account</p></div></div>
              {history.length === 0 ? <p className="cell-muted">None.</p> : (
                <ul className="mini-list">
                  {history.map((h) => (
                    <li key={h.id}><a href={href(`/moderation/${h.id}`)}>{CATEGORY_LABELS[h.category] ?? h.category}</a>
                      <span className="cell-muted">{fmtDate(h.createdAt)}</span><ReportStatus value={h.status} /></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
      {modal}
    </>
  );
}

function PersonRow({ label, card, fallback }: { label: string; card: (Card & { userId?: string }) | null; fallback: string }) {
  return (
    <div className="person-row">
      <span className="field__label">{label}</span>
      {card && 'username' in card && card.username ? (
        <a className="author" href={card.userId ? href(`/users/${card.userId}`) : undefined}>
          <Avatar url={card.avatarUrl} name={card.displayName} />
          <span className="cell-user__text"><b>{card.displayName}</b><span>@{card.username} · {card.type}</span></span>
        </a>
      ) : <span className="cell-muted">{fallback}</span>}
    </div>
  );
}

function TargetView({ detail }: { detail: ReportDetail }) {
  const t = detail.target;
  if (!t) return <p className="cell-muted">The item no longer exists.</p>;
  if (t.profile) return (
    <div className="stack">
      <div className="author"><Avatar url={t.profile.avatarUrl} name={t.profile.displayName} size={44} />
        <span className="cell-user__text"><b>{t.profile.displayName}</b><span>@{t.profile.username} · {t.profile.type} · <Status value={t.profile.status} /></span></span></div>
      <p className="prose">{t.profile.bio || 'No bio.'}</p>
    </div>
  );
  if (t.post) return (
    <div className="stack">
      <b>{t.post.title}</b><span className="cell-muted">Review: {t.post.reviewStatus} · {t.post.status}</span>
      <p className="prose">{t.post.description}</p>
      {t.post.media.length > 0 && <div className="media-strip">{t.post.media.map((m, i) => (
        <div key={i} className="media-strip__item">{m.kind === 'video' ? <video src={m.url ?? undefined} controls preload="metadata" /> : <img src={m.url ?? undefined} alt="" />}</div>))}</div>}
    </div>
  );
  if (t.media) return (
    <div className="stack">
      <span className="cell-muted">{t.media.kind} · {t.media.purpose} · review: {t.media.reviewStatus}</span>
      {t.media.kind === 'video' ? <video className="evidence__img evidence__img--big" src={t.media.url ?? undefined} poster={t.media.posterUrl ?? undefined} controls preload="metadata" />
        : <img className="evidence__img evidence__img--big" src={t.media.url ?? undefined} alt="Reported media" />}
    </div>
  );
  if (t.review) return (
    <div className="stack">
      <span className="cell-muted">Quality {t.review.quality} · Speed {t.review.speed} · Contact {t.review.contact} · {t.review.reviewStatus}</span>
      <p className="prose">{t.review.comment}</p>
    </div>
  );
  return <p className="cell-muted">See the shared messages below.</p>;
}

export function RestrictModal({ onConfirm, onClose }: { onConfirm: (reason: string, days: number) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Temporarily restrict user" onClose={busy ? () => {} : onClose}>
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { await onConfirm(reason.trim(), Number(days)); onClose(); } catch (err) { setError(String((err as Error).message)); setBusy(false); }
      }}>
        <div className="modal__text">{ACTION_COPY.restrict.text}</div>
        <Field label="Duration">
          <select className="input" value={days} onChange={(e) => setDays(e.target.value)}>
            {[1, 3, 7, 14, 30, 90].map((d) => <option key={d} value={d}>{d} day{d === 1 ? '' : 's'}</option>)}
          </select>
        </Field>
        <Field label="Reason"><textarea className="input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Shown to the user and in Activity Logs" /></Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal__actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="danger" loading={busy} disabled={reason.trim().length < 3}>Restrict user</Button>
        </div>
      </form>
    </Modal>
  );
}
