// Content Review — new public photos and videos wait here before anyone else sees them; posts and reviews the
// automatic text check flagged wait here too. Approve publishes; Reject keeps the item hidden and tells its owner why.
import { useState } from 'react';
import { api, query, type Card, type Paged } from '../api';
import { PageHeader } from '../app';
import { useRemembered } from '../router';
import { Avatar, Button, ConfirmModal, Empty, ErrorState, Loading, Pagination, Select, fmtBytes, fmtDateTime, fmtDuration, toast, useLoad, useModal } from '../ui';

interface ReviewMedia {
  id: string; kind: 'photo' | 'video'; purpose: string; url: string | null; posterUrl: string | null; duration: number | null; createdAt: number;
  reviewStatus: string; reviewReason: string | null; autoFlags: Record<string, unknown> | null; bytes: number | null; owner: (Card & { userId?: string }) | null;
}
interface ReviewPost { id: string; title: string; description: string; createdAt: number; owner: Card | null; reviewReason: string | null;
                       autoFlags: { reasons?: string[] } | null; media: { url: string | null; kind: string }[] }
interface ReviewText { id: string; comment: string; createdAt: number; reviewReason: string | null; author: Card | null; recipient: Card | null }

const STATUSES = [{ value: 'pending', label: 'Pending' }, { value: 'flagged', label: 'Flagged' }, { value: 'approved', label: 'Approved' },
                  { value: 'rejected', label: 'Rejected' }, { value: 'removed', label: 'Removed' }];

export function ContentReviewPage() {
  const [type, setType] = useRemembered('review.type', 'media');
  const [status, setStatus] = useRemembered('review.status', 'pending');
  const [kind, setKind] = useRemembered('review.kind', '');
  const [page, setPage] = useRemembered('review.page', 1);
  const [limit, setLimit] = useRemembered('review.limit', 20);
  const list = useLoad<Paged<any> & { videoFrames?: number }>((s) => api('GET', `/content-review${query({ type, status, kind: type === 'media' ? kind : '', page, limit })}`, undefined, s),
                                                               [type, status, kind, page, limit]);
  const { modal, open } = useModal();
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const decide = (id: string, decision: 'approve' | 'reject', what: string) => {
    const run = async (reason: string) => {
      await api('POST', `/content-review/${type}/${id}`, { decision, reason: reason || undefined });
      toast.ok(decision === 'approve' ? 'Approved' : 'Rejected', decision === 'approve' ? 'Now visible in the apps.' : 'The owner was told why.');
      list.reload();
    };
    if (decision === 'approve' && status === 'pending') { run('').catch((e) => toast.error('Couldn’t approve', String(e.message))); return; }
    open((close) => <ConfirmModal title={decision === 'approve' ? `Approve ${what}` : `Reject ${what}`} danger={decision === 'reject'}
      reason={decision === 'reject'} confirmLabel={decision === 'approve' ? 'Approve' : 'Reject'} onClose={close} onConfirm={run}
      text={decision === 'approve' ? `Publish this ${what} in the iOS app and on the web.` : `Keep this ${what} hidden. The owner sees your reason in Notifications. The file stays in storage.`} />);
  };
  return (
    <>
      <PageHeader title="Content Review" subtitle="New public media waits here until a moderator approves it" />
      <div className="content">
        <div className="tabs" role="tablist">
          {[['media', 'Media'], ['posts', 'Flagged posts'], ['reviews', 'Flagged reviews']].map(([v, l]) => (
            <button key={v} role="tab" aria-selected={type === v} className={`tab ${type === v ? 'is-on' : ''}`} onClick={() => { filter(setType)(v!); if (v !== 'media' && status === 'pending') setStatus('flagged'); }}>
              {l}{type === v && list.data ? ` · ${list.data.total}` : ''}
            </button>
          ))}
        </div>
        <div className="toolbar">
          <Select label="Status" value={status} onChange={filter(setStatus)} options={type === 'media' ? STATUSES : STATUSES.filter((s) => s.value !== 'pending')} />
          {type === 'media' && <Select label="Type" value={kind} onChange={filter(setKind)} options={[{ value: '', label: 'All' }, { value: 'photo', label: 'Photos' }, { value: 'video', label: 'Videos' }]} />}
        </div>
        {list.error ? <ErrorState error={list.error} retry={list.reload} /> : !list.data ? <Loading /> :
          list.data.items.length === 0 ? <div className="table"><Empty title="Nothing to review" text="New items appear here as soon as they are uploaded." /></div> : (
          <>
            {type === 'media' && (
              <div className={`review-grid ${list.loading ? 'is-refreshing' : ''}`}>
                {(list.data.items as ReviewMedia[]).map((m) => (
                  <MediaReviewCard key={m.id} m={m} frames={list.data!.videoFrames ?? 6} actionable={status !== 'approved' || true}
                    onApprove={() => decide(m.id, 'approve', m.kind)} onReject={() => decide(m.id, 'reject', m.kind)} status={status} />
                ))}
              </div>
            )}
            {type === 'posts' && (
              <div className="stack">
                {(list.data.items as ReviewPost[]).map((p) => (
                  <section key={p.id} className="panel">
                    <div className="panel__head"><div><h2>{p.title}</h2><p>{p.owner ? `${p.owner.displayName} · @${p.owner.username}` : ''} · {fmtDateTime(p.createdAt)}</p></div></div>
                    {p.autoFlags?.reasons && <p className="flag-note">Automatic check: {p.autoFlags.reasons.join(', ')}</p>}
                    <p className="prose">{p.description}</p>
                    <div className="modal__actions"><Button onClick={() => decide(p.id, 'reject', 'post')} variant="danger">Reject</Button><Button variant="primary" onClick={() => decide(p.id, 'approve', 'post')}>Approve</Button></div>
                  </section>
                ))}
              </div>
            )}
            {type === 'reviews' && (
              <div className="stack">
                {(list.data.items as ReviewText[]).map((r) => (
                  <section key={r.id} className="panel">
                    <div className="panel__head"><div><h2>{r.author ? `@${r.author.username}` : 'Review'} → {r.recipient ? `@${r.recipient.username}` : ''}</h2><p>{fmtDateTime(r.createdAt)}</p></div></div>
                    {r.reviewReason && <p className="flag-note">Automatic check: {r.reviewReason}</p>}
                    <p className="prose">{r.comment}</p>
                    <div className="modal__actions"><Button onClick={() => decide(r.id, 'reject', 'review')} variant="danger">Reject</Button><Button variant="primary" onClick={() => decide(r.id, 'approve', 'review')}>Approve</Button></div>
                  </section>
                ))}
              </div>
            )}
            <div className="table table--bare">
              <Pagination page={page} limit={limit} total={list.data.total} noun="items" onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} />
            </div>
          </>
        )}
      </div>
      {modal}
    </>
  );
}

/** A video's frames for a quick look (evenly spaced; the count comes from REVIEW_VIDEO_FRAMES). It is not a full check:
 *  play the whole video before approving. */
function MediaReviewCard({ m, frames, onApprove, onReject, status }: { m: ReviewMedia; frames: number; actionable: boolean; status: string;
  onApprove: () => void; onReject: () => void }) {
  const [playing, setPlaying] = useState(false);
  const times = m.kind === 'video' && m.duration ? Array.from({ length: frames }, (_, i) => +((m.duration! * (i + 0.5)) / frames).toFixed(2)) : [];
  return (
    <article className={`review-card ${m.reviewStatus === 'flagged' ? 'is-flagged' : ''}`}>
      <div className="review-card__preview">
        {m.kind === 'photo' ? <a href={m.url ?? undefined} target="_blank" rel="noopener noreferrer"><img src={m.url ?? undefined} alt="Uploaded photo" loading="lazy" /></a>
          : playing ? <video src={m.url ?? undefined} poster={m.posterUrl ?? undefined} controls autoPlay />
          : <button className="review-card__play" onClick={() => setPlaying(true)}>{m.posterUrl ? <img src={m.posterUrl} alt="Video poster" /> : null}<span>▶ Play full video{fmtDuration(m.duration) ? ` · ${fmtDuration(m.duration)}` : ''}</span></button>}
      </div>
      {times.length > 0 && (
        <div className="frames" aria-label="Video frames">
          {times.map((t) => <video key={t} src={`${m.url}#t=${t}`} preload="metadata" muted playsInline title={`${t}s`} />)}
        </div>
      )}
      <div className="review-card__body">
        <span className="author"><Avatar url={m.owner?.avatarUrl} name={m.owner?.displayName ?? '?'} size={28} />
          <span className="cell-user__text"><b>{m.owner?.displayName ?? '—'}</b><span>@{m.owner?.username} · {m.purpose} · {fmtBytes(m.bytes)}</span></span></span>
        <span className="cell-muted">{fmtDateTime(m.createdAt)}</span>
        {m.autoFlags && <span className="flag-note">Automatic check: {JSON.stringify(m.autoFlags)}</span>}
        {m.reviewReason && <span className="flag-note">Reason: {m.reviewReason}</span>}
        <div className="review-card__actions">
          {status !== 'rejected' && <Button small variant="danger" onClick={onReject}>Reject</Button>}
          {status !== 'approved' && <Button small variant="primary" onClick={onApprove}>Approve</Button>}
        </div>
      </div>
    </article>
  );
}
