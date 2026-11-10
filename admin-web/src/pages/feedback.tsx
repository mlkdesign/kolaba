// Feedback & Suggestions from the apps — kept apart from reports about prohibited content.
import { useEffect, useState } from 'react';
import { API_URL, api, errorText, getSession, query, type Paged } from '../api';
import { PageHeader } from '../app';
import { useRemembered } from '../router';
import { Button, Empty, ErrorState, Field, Loading, Modal, Pagination, SearchField, Select, fmtDateTime, toast, useDebounced, useLoad, useModal } from '../ui';

interface FeedbackRow {
  id: string; userId: string | null; email: string | null; category: 'suggestion' | 'bug' | 'general' | 'other'; message: string;
  hasAttachment: boolean; attachmentMime: string | null; appVersion: string | null; osVersion: string | null; platform: string | null;
  status: 'open' | 'in_progress' | 'resolved'; adminNote: string | null; createdAt: number; updatedAt: number; resolvedAt: number | null;
}
const CATEGORY: Record<string, string> = { suggestion: 'Suggestion', bug: 'Bug Report', general: 'General Feedback', other: 'Other' };
const STATUS: Record<string, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };
const TABS: [string, string, string][] = [['', '', 'All'], ['suggestion', '', 'Suggestions'], ['bug', '', 'Bugs'], ['general', '', 'General Feedback'],
                                          ['', 'open', 'Open'], ['', 'resolved', 'Resolved']];

const FeedbackStatus = ({ value }: { value: string }) =>
  <span className={`status is-${value === 'resolved' ? 'green' : value === 'open' ? 'amber' : 'muted'}`}><i />{STATUS[value] ?? value}</span>;

export function FeedbackPage() {
  const [tab, setTab] = useRemembered('fb.tab', 0);
  const [search, setSearch] = useRemembered('fb.q', '');
  const [page, setPage] = useRemembered('fb.page', 1);
  const [limit, setLimit] = useRemembered('fb.limit', 20);
  const q = useDebounced(search);
  const [category, status] = TABS[tab]!;
  const list = useLoad<Paged<FeedbackRow> & { open: number }>((s) => api('GET', `/feedback${query({ category, status, q, page, limit })}`, undefined, s),
                                                              [tab, q, page, limit]);
  const { modal, open } = useModal();
  const show = (f: FeedbackRow) => open((close) => <FeedbackModal item={f} onClose={close} onSaved={() => list.reload()} />);
  return (
    <>
      <PageHeader title="Feedback" subtitle={list.data ? `${list.data.open} open · suggestions, bug reports and feedback from the apps` : 'Suggestions, bug reports and feedback from the apps'} />
      <div className="content">
        <div className="tabs" role="tablist">
          {TABS.map(([, , label], i) => (
            <button key={label} role="tab" aria-selected={tab === i} className={`tab ${tab === i ? 'is-on' : ''}`} onClick={() => { setTab(i); setPage(1); }}>
              {label}{tab === i && list.data ? ` · ${list.data.total}` : ''}
            </button>
          ))}
        </div>
        <div className="toolbar"><SearchField value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search text, feedback ID or user ID" /></div>
        <div className="table">
          <div className="table__head table__row feedback-grid"><span>Topic</span><span>Message</span><span>From</span><span>App</span><span>Date</span><span>Status</span></div>
          {list.error ? <ErrorState error={list.error} retry={list.reload} /> : !list.data ? <Loading /> :
            list.data.items.length === 0 ? <Empty title="No feedback" text="Messages sent from Settings → Feedback & Suggestions appear here." /> : (
            <div className={list.loading ? 'is-refreshing' : ''}>
              {list.data.items.map((f) => (
                <div key={f.id} className="table__row feedback-grid is-link" role="button" tabIndex={0} onClick={() => show(f)} onKeyDown={(e) => { if (e.key === 'Enter') show(f); }}>
                  <span className="cell-icon">{CATEGORY[f.category]}{f.hasAttachment && <em className="chip">Screenshot</em>}</span>
                  <span className="cell-muted ellipsis">{f.message}</span>
                  <span className="cell-muted ellipsis">{f.email ?? 'Deleted account'}</span>
                  <span className="cell-muted">{f.appVersion ?? '—'}{f.osVersion ? ` · ${f.osVersion}` : ''}</span>
                  <span className="cell-muted">{fmtDateTime(f.createdAt)}</span>
                  <span><FeedbackStatus value={f.status} /></span>
                </div>
              ))}
            </div>
          )}
          {list.data && list.data.total > 0 && <Pagination page={page} limit={limit} total={list.data.total} noun="messages" onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />}
        </div>
      </div>
      {modal}
    </>
  );
}

function FeedbackModal({ item, onClose, onSaved }: { item: FeedbackRow; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState(item.adminNote ?? '');
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    if (!item.hasAttachment) return;
    let url: string | null = null;
    // The screenshot is fetched with the admin session (never a public link) and shown from memory.
    fetch(`${API_URL}/v1/admin/feedback/${item.id}/attachment`, { headers: { Authorization: `Bearer ${getSession()}` }, cache: 'no-store' })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { url = URL.createObjectURL(b); setImage(url); } }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [item.id, item.hasAttachment]);
  const save = async () => {
    setBusy(true);
    try {
      await api('PATCH', `/feedback/${item.id}`, { status, adminNote: note });
      toast.ok('Feedback updated'); onSaved(); onClose();
    } catch (e) { toast.error('Couldn’t save', errorText(e)); setBusy(false); }
  };
  return (
    <Modal title={CATEGORY[item.category] ?? 'Feedback'} onClose={onClose} width={560}>
      <div className="stack">
        <span className="cell-muted">{item.email ?? 'Deleted account'} · {fmtDateTime(item.createdAt)} · {item.platform ?? '—'} {item.appVersion ?? ''} {item.osVersion ? `· ${item.osVersion}` : ''}</span>
        <p className="prose">{item.message}</p>
        {item.hasAttachment && (image ? <a href={image} target="_blank" rel="noopener noreferrer"><img className="evidence__img evidence__img--big" src={image} alt="Attached screenshot" /></a> : <Loading label="Loading screenshot…" />)}
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as FeedbackRow['status'])}>
            {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Internal note" hint="Only administrators see this."><textarea className="input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="modal__actions"><Button onClick={onClose} disabled={busy}>Close</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></div>
      </div>
    </Modal>
  );
}
