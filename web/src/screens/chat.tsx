// chat. — MessagesView (one list of chats, search across contacts and messages) and ChatView (bubbles with tails, the
// time outside the bubble, day separators "Yesterday 22:06", the glass composer).
import { useEffect, useRef, useState } from 'preact/hooks';
import { Card, Conversation, del, errorText, get, Message, post, uploadFile } from '../api';
import { activeProfile, back, badges, chatOpen, openSheet, push, refresh, refreshTick, showToast } from '../state';
import {
  alertDialog, openContextMenu, useLongPress, Icon, Avatar, BackButton, chatTime, clock, daySeparator, Empty, GlassButton, Header, HeaderTitle, icon, Logo, openViewer, ProBadge, SheetFrame, Spinner,
  useDebounced, useLoad, usePullToRefresh, useCollapsingHeader,
} from '../ui';

export function ChatListScreen() {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const { data, error, loading, reload, setData } = useLoad<{ items: Conversation[] }>((s) => get('/v1/conversations?limit=50', s), [refreshTick.value, activeProfile.value?.id]);
  const search = useLoad<any>((s) => (q.length >= 2 ? get(`/v1/search?q=${encodeURIComponent(q)}&scope=all`, s) : Promise.resolve(null)), [q]);
  const { scroller, Indicator } = usePullToRefresh(() => reload());
  const { root } = useCollapsingHeader({}, scroller);
  const openWith = async (card: Card) => {
    try { const { id } = await post('/v1/conversations', { profileId: card.id }); push('conversation', { id }); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const markAll = async () => {
    const unread = (data?.items ?? []).filter((c) => c.unreadCount > 0);
    if (!unread.length) { showToast('Everything is read'); return; }
    await Promise.all(unread.map((c) => post(`/v1/conversations/${c.id}/read`).catch(() => {})));
    setData({ items: data!.items.map((c) => ({ ...c, unreadCount: 0 })) });
    badges.value = { ...badges.value, conversations: 0 };
    refresh();
  };
  const menu = () => openSheet((close) => (
    <SheetFrame title="Chats" close={close}>
      <button class="menu-item" onClick={() => { close(); void markAll(); }}><img src={icon('IconCheckCircle')} alt="" />Mark all as read</button>
      <button class="menu-item" onClick={() => { close(); push('contacts', {}); }}><img src={icon('IconUser')} alt="" />My Contacts</button>
    </SheetFrame>
  ));
  const local = (data?.items ?? []).filter((c) => !q || `${c.partner?.displayName} ${c.partner?.username} ${c.relatedJobTitle ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div class="collapsing" ref={root}>
      <div class="scroll" ref={scroller}>
        <div class="section-top" />
        {q.length >= 2 && search.data && (
          <>
            {search.data.contacts.length > 0 && <div class="section-label" style={{ marginTop: 0 }}>Contacts</div>}
            {search.data.contacts.length > 0 && (
              <div class="socials" data-hscroll style={{ margin: 0, paddingBottom: 8 }}>
                {search.data.contacts.map((c: Card) => (
                  <button class="social" style={{ width: 64 }} onClick={() => openWith(c)}><Avatar card={c} size={56} /><span class="ellipsis" style={{ width: 64, textAlign: 'center', fontSize: 12 }}>{c.displayName}</span></button>
                ))}
              </div>
            )}
            {search.data.messages.length > 0 && <div class="section-label">Messages</div>}
            <div class="chats">
              {search.data.messages.map((m: any) => (
                <button class="chat-row" onClick={() => push('conversation', { id: m.conversationId })}>
                  <Avatar card={m.sender} size={48} />
                  <div class="grow"><div class="chat-row__top"><span class="chat-row__name ellipsis">{m.sender?.displayName}</span><span class="chat-row__time">{chatTime(m.createdAt)}</span></div>
                    <div class="chat-row__preview lines-2">{m.body}</div></div>
                </button>
              ))}
            </div>
            {local.length > 0 && <div class="section-label">Chats</div>}
          </>
        )}
        {error ? <Empty title="Couldn't load chats" text={errorText(error)} /> : loading && !data ? <Spinner /> : !local.length && !q ? (
          <Empty title="No messages yet" text="Start a chat from a profile, a job or your contacts." iconName="IconChatText" />
        ) : <div class="chats">{local.map((c) => <ChatRow c={c} key={c.id}
          onChange={(next) => setData({ items: data!.items.flatMap((x) => (x.id !== c.id ? [x] : next ? [next] : [])) })} />)}</div>}
        <div style={{ height: 'var(--tabbar-clear)' }} />
      </div>
      <Indicator />
      <Header
        left={searching ? null : <GlassButton name="IconDotsThree" label="Chats menu" onClick={menu} />}
        collapsingTitle center={searching ? null : <Logo word="chat" />}
        right={searching ? (
          <div class="row" style={{ width: 370, gap: 8 }}>
            <label class="glass search"><img src={icon('IconMagnifyingGlass')} alt="" />
              <input autoFocus placeholder="Search chats, contacts, messages" value={query} onInput={(e) => setQuery(e.currentTarget.value)} /></label>
            <GlassButton name="IconSheetClose" label="Close search" onClick={() => { setSearching(false); setQuery(''); }} />
          </div>
        ) : <GlassButton name="IconMagnifyingGlass" label="Search" onClick={() => setSearching(true)} />}
      />
    </div>
  );
}

/** A chat row; held (500 ms) it offers the iOS menu — Mute / Unmute, Mark as read, Delete chat (for this profile only:
 *  the other side keeps the conversation). Every action goes to the server first; the list follows its answer. */
function ChatRow({ c, onChange }: { c: Conversation; onChange: (next: Conversation | null) => void }) {
  const name = c.relatedJobTitle ?? c.partner?.displayName ?? 'this chat';
  const run = async (fn: () => Promise<unknown>, next: Conversation | null, ok?: string) => {
    try { await fn(); onChange(next); refresh(); if (ok) showToast(ok, 'ok'); } catch (e) { showToast(errorText(e), 'error'); }
  };
  const press = useLongPress((el) => openContextMenu(el, [
    { label: c.muted ? 'Unmute chat' : 'Mute chat', icon: 'IconSpeakerX', run: () => void run(() => post(`/v1/conversations/${c.id}/mute`, { muted: !c.muted }), { ...c, muted: !c.muted }) },
    ...(c.unreadCount > 0 ? [{ label: 'Mark as read', icon: 'IconCheckCircle', run: () => void run(() => post(`/v1/conversations/${c.id}/read`), { ...c, unreadCount: 0 }) }] : []),
    { label: 'Delete chat', icon: 'IconTrash', danger: true, run: () => alertDialog(`Delete chat with ${name}?`,
      'The chat and its messages disappear for you. The other person keeps their copy.', 'Delete chat',
      () => run(() => del(`/v1/conversations/${c.id}`), null, 'Chat deleted')) },
  ]));
  const last = c.lastMessage;
  const preview = last ? (last.body || (last.attachments.length ? 'Photo' : '')) : 'No messages yet';
  const job = !!c.relatedJobId;
  return (
    <button class="chat-row" onPointerDown={press.onPointerDown as any} onPointerMove={press.onPointerMove as any} onPointerUp={press.onPointerUp}
      onPointerCancel={press.onPointerCancel} onPointerLeave={press.onPointerLeave} onContextMenu={press.onContextMenu}
      onClick={press.click(() => push('conversation', { id: c.id }))}>
      <span class="chat-row__avatar">
        <Avatar card={c.partner} size={64} rounded={job} />
      </span>
      <div class="grow" style={{ paddingTop: 2 }}>
        <div class="chat-row__top">
          {job && <span class="chat-row__job" style={{ position: 'static', border: 0, flex: 'none' }}><img src={icon('IconBriefcase')} alt="" /></span>}
          <span class="chat-row__name ellipsis">{job ? c.relatedJobTitle : c.partner?.displayName ?? 'Unknown'}</span>
          {!job && <ProBadge card={c.partner} compact />}
          {c.muted && <img class="mute-icon" src={icon('IconSpeakerX')} alt="Muted" />}
          <span class="chat-row__time">
            {last?.isOutgoing && <Tick read={!!last.isReadByOther} />}
            {chatTime(c.activityAt)}
          </span>
        </div>
        <div class="chat-row__bottom">
          <div class={`chat-row__preview lines-2 grow ${c.unreadCount ? 'is-unread' : ''}`}>{job && c.partner ? `${c.partner.displayName}: ` : ''}{preview}</div>
          {c.unreadCount > 0 && <span class={`unread-count ${c.muted ? 'is-muted' : ''}`}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>}
        </div>
      </div>
    </button>
  );
}

export function ConversationScreen({ id }: { id: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const newest = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const markRead = () => post(`/v1/conversations/${id}/read`).catch(() => {});
  const loadNewer = async () => {
    try {
      const page = await get(`/v1/conversations/${id}/messages?after=${newest.current}&limit=100`);
      if (page.items.length) {
        newest.current = Math.max(newest.current, ...page.items.map((m: Message) => m.createdAt));
        setMessages((prev) => { const known = new Set(prev.map((m) => m.id)); return [...page.items.filter((m: Message) => !known.has(m.id)), ...prev]; });
        void markRead();
      } else setMeta(page.conversation);
    } catch { /* next poll */ }
  };
  useEffect(() => {
    chatOpen.value = id;
    (async () => {
      try {
        const page = await get(`/v1/conversations/${id}/messages?limit=40`);
        setMessages(page.items); setMeta(page.conversation); setCursor(page.nextCursor);
        newest.current = page.items[0]?.createdAt ?? 0;
        void markRead(); refresh();
      } catch (e) { setError(errorText(e)); } finally { setLoaded(true); }
    })();
    return () => { chatOpen.value = null; };
  }, [id]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void loadNewer(); }, 4000);
    return () => window.clearInterval(timer);
  }, [id]);
  const loadOlder = async () => {
    if (!cursor) return;
    const c = cursor; setCursor(null);
    const page = await get(`/v1/conversations/${id}/messages?limit=40&before=${c}`);
    setMessages((prev) => [...prev, ...page.items]); setCursor(page.nextCursor);
  };
  const send = async (mediaIds: string[] = []) => {
    const body = text.trim();
    if ((!body && !mediaIds.length) || sending) return;
    setSending(true);
    try {
      const m = await post<Message>(`/v1/conversations/${id}/messages`, { body, mediaIds });
      setMessages((prev) => [m, ...prev]); newest.current = Math.max(newest.current, m.createdAt); setText('');
      if (field.current) field.current.style.height = '';
      refresh();
    } catch (e) { showToast(errorText(e), 'error'); } finally { setSending(false); }
  };
  const attach = async (file: File) => {
    try { showToast('Uploading…'); const media = await uploadFile(file, 'chat'); await send([media.id]); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const partner = meta?.partner as Card | undefined;
  const menu = () => openSheet((close) => (
    <SheetFrame title={partner?.displayName} close={close}>
      <button class="menu-item" onClick={() => { close(); partner && push('profile-view', { id: partner.id }); }}><img src={icon('IconUser')} alt="" />Open profile</button>
      {meta?.relatedJobId && <button class="menu-item" onClick={() => { close(); push('job', { id: meta.relatedJobId }); }}><img src={icon('IconBriefcase')} alt="" />Open job</button>}
      <button class="menu-item" onClick={async () => { close(); await post(`/v1/conversations/${id}/mute`, { muted: !meta?.muted }); setMeta({ ...meta, muted: !meta?.muted }); }}>
        <img src={icon('IconSpeakerX')} alt="" />{meta?.muted ? 'Unmute' : 'Mute'}</button>
      <button class="menu-item is-danger" onClick={async () => { close(); await post('/v1/reports', { targetType: 'profile', targetId: partner?.id, reason: 'spam' }); showToast('Reported — thank you', 'ok'); }}>
        <img src={icon('IconShieldWarning')} alt="" />Report</button>
    </SheetFrame>
  ));
  const [finding, setFinding] = useState(false);
  const [term, setTerm] = useState('');
  const [hit, setHit] = useState(0);
  const hits = term.trim().length >= 2 ? messages.filter((m) => m.body.toLowerCase().includes(term.trim().toLowerCase())) : [];
  useEffect(() => {
    const m = hits[hit];
    if (m) document.querySelector(`[data-msg="${m.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [term, hit]);
  if (error) return <><Header left={<BackButton />} /><div class="section-top"><Empty title="Chat not available" text={error} /></div></>;
  const lastOutgoing = messages.find((m) => m.isOutgoing)?.id;
  return (
    <div class="convo">
      <div class="messages" onScroll={(e) => { const el = e.currentTarget; if (el.scrollHeight + el.scrollTop - el.clientHeight < 120) void loadOlder(); }}>
        {loaded && messages.length === 0 && <div class="empty" style={{ margin: 'auto' }}>Say hello 👋</div>}
        {!loaded && <Spinner />}
        {messages.map((m, i) => {
          const older = messages[i + 1];
          const newer = messages[i - 1];
          const showDay = !older || m.createdAt - older.createdAt > 3_600_000 || new Date(older.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          // The tail on the last bubble of a run from one side.
          const tail = !newer || newer.isOutgoing !== m.isOutgoing || newer.createdAt - m.createdAt > 120_000;
          return (
            <div key={m.id} data-msg={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {showDay && <div class="day-sep">{daySeparator(m.createdAt)}</div>}
              <div class={`bubble-row ${m.isOutgoing ? 'is-out' : ''}`}>
                <div class={`bubble ${tail ? 'has-tail' : ''}`}>
                  {m.attachments.map((a) => (
                    <button class="bubble__media" onClick={() => openViewer(a)}>{a.kind === 'video' ? <video src={a.url ?? undefined} poster={a.posterUrl ?? undefined} preload="metadata" muted playsInline /> : <img src={a.url ?? ''} alt="" loading="lazy" />}</button>
                  ))}
                  {m.body && <span class="bubble__text">{finding && term.trim().length >= 2 ? highlight(m.body, term.trim()) : m.body}</span>}
                </div>
                <span class="bubble-time">
                  {m.isOutgoing && <Tick read={!!m.isReadByOther || m.id !== lastOutgoing} />}
                  {clock(m.createdAt)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div class="composer">
        <GlassButton name="IconPaperclip" label="Attach" onClick={() => fileInput.current?.click()} />
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" hidden
          onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void attach(f); e.currentTarget.value = ''; }} />
        <textarea ref={field} class="glass composer__field" rows={1} placeholder="Message" value={text} maxLength={4000} aria-label="Message"
          onInput={(e) => { setText(e.currentTarget.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 92)}px`; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); void send(); } }} />
        <GlassButton name="IconArrowLeft" label="Send" disabled={!text.trim() || sending} onClick={() => send()} />
      </div>
      <Header left={<BackButton onClick={() => back()} />}
        center={finding ? null : <button onClick={() => partner && push('profile-view', { id: partner.id })} style={{ textAlign: 'center' }}>
          <HeaderTitle title={meta?.relatedJobTitle ?? partner?.displayName ?? '…'} sub={meta?.relatedJobTitle ? partner?.displayName : partner ? partner.username : undefined} /></button>}
        right={finding ? (
          <div class="row" style={{ width: 310, gap: 8 }}>
            <label class="glass search"><img src={icon('IconMagnifyingGlass')} alt="" />
              <input autoFocus placeholder="Search in chat" value={term} onInput={(e) => { setTerm(e.currentTarget.value); setHit(0); }} aria-label="Search in chat" />
              {hits.length > 0 && <span class="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{hit + 1} of {hits.length}</span>}
              {hits.length > 1 && <button aria-label="Older match" onClick={() => setHit((hit + 1) % hits.length)}><Icon name="IconCaretDown" size={14} /></button>}
            </label>
            <GlassButton name="IconSheetClose" label="Close search" onClick={() => { setFinding(false); setTerm(''); }} />
          </div>
        ) : <div class="glass glass-pill"><button aria-label="Find in chat" onClick={() => setFinding(true)}><img src={icon('IconMagnifyingGlass')} alt="" /></button>
          <button aria-label="More" onClick={menu}><img src={icon('IconDotsThree')} alt="" /></button></div>} />
    </div>
  );
}

/** The sent / read check: grey while sent, pink once read. */
const Tick = ({ read }: { read: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" role="img" aria-label={read ? 'Read' : 'Sent'}>
    <path d="M2.5 7.5l3 3 6-7" stroke={read ? 'var(--pink)' : 'rgba(236,237,239,.5)'} stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

/** The search term marked inside a bubble. */
function highlight(text: string, term: string) {
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark class="find-mark">{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>;
}
