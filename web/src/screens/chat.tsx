// chat. — one chat list (no All/Jobs tabs), search across contacts, names and messages, and the conversation.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Card, Conversation, errorText, get, Message, post, uploadFile } from '../api';
import { activeProfile, chatOpen, openSheet, push, refresh, refreshTick, showToast } from '../state';
import { Avatar, clock, Empty, Icon, openViewer, SheetFrame, Spinner, timeAgo, TopBar, useDebounced, useLoad } from '../ui';

export function ChatListScreen() {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const { data, error, loading } = useLoad<{ items: Conversation[] }>((s) => get('/v1/conversations?limit=50', s), [refreshTick.value, activeProfile.value?.id]);
  const search = useLoad<any>((s) => (q.length >= 2 ? get(`/v1/search?q=${encodeURIComponent(q)}&scope=all`, s) : Promise.resolve(null)), [q]);
  const openWith = async (card: Card) => {
    try { const { id } = await post('/v1/conversations', { profileId: card.id }); push('conversation', { id }); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const local = (data?.items ?? []).filter((c) => !q || `${c.partner?.displayName} ${c.partner?.username}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <header class="topbar"><div class="logo-word">chat<i>.</i></div></header>
      <div class="scroll">
        <div class="below-topbar" />
        <div class="pad" style={{ marginBottom: 8 }}>
          <label class="search"><img src={`${import.meta.env.BASE_URL}icons/IconMagnifyingGlass.svg`} alt="" />
            <input placeholder="Search chats, contacts, messages" value={query} onInput={(e) => setQuery(e.currentTarget.value)} /></label>
        </div>
        {q.length >= 2 && search.data && (
          <>
            {search.data.contacts.length > 0 && <div class="section-title">Contacts</div>}
            {search.data.contacts.map((c: Card) => (
              <button class="list-row" onClick={() => openWith(c)}><Avatar card={c} size={44} />
                <div class="grow"><div class="list-row__title">{c.displayName}</div><div class="list-row__sub">{c.location ?? `@${c.username}`}</div></div></button>
            ))}
            {search.data.messages.length > 0 && <div class="section-title">Messages</div>}
            {search.data.messages.map((m: any) => (
              <button class="list-row" onClick={() => push('conversation', { id: m.conversationId })}>
                <Avatar card={m.sender} size={44} />
                <div class="grow"><div class="list-row__title">{m.sender?.displayName}</div><div class="list-row__sub ellipsis">{m.body}</div></div>
                <span class="chat-row__time">{timeAgo(m.createdAt)}</span>
              </button>
            ))}
            {local.length > 0 && <div class="section-title">Chats</div>}
          </>
        )}
        {error ? <Empty title="Couldn't load chats" text={errorText(error)} /> : loading && !data ? <Spinner /> : !local.length && !q ? (
          <Empty title="No messages yet" text="Start a chat from a profile, a job or your contacts." iconName="IconChatText" />
        ) : local.map((c) => <ChatRow c={c} key={c.id} />)}
      </div>
    </>
  );
}

function ChatRow({ c }: { c: Conversation }) {
  const last = c.lastMessage;
  const preview = last ? (last.body || (last.attachments.length ? '📎 Media' : '')) : 'No messages yet';
  return (
    <button class="list-row" onClick={() => push('conversation', { id: c.id })}>
      <Avatar card={c.partner} size={52} />
      <div class="grow">
        <div class="row" style={{ gap: 6 }}>
          <span class="list-row__title ellipsis grow">{c.partner?.displayName ?? 'Unknown'}</span>
          <span class="chat-row__time">{timeAgo(c.activityAt)}</span>
        </div>
        {c.relatedJobTitle && <div class="list-row__sub ellipsis" style={{ color: 'var(--accent)' }}>💼 {c.relatedJobTitle}</div>}
        <div class="row" style={{ gap: 6, marginTop: 2 }}>
          <span class={`chat-row__preview ellipsis grow ${c.unreadCount ? 'is-unread' : ''}`}>{last?.isOutgoing ? 'You: ' : ''}{preview}</span>
          {c.unreadCount > 0 && <span class={`unread ${c.muted ? 'is-muted' : ''}`}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>}
          {!c.unreadCount && last?.isOutgoing && <span class="muted" style={{ fontSize: 12 }}>{last.isReadByOther ? '✓✓' : '✓'}</span>}
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
  const newest = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const markRead = () => post(`/v1/conversations/${id}/read`).catch(() => {});
  const loadNewer = async () => {
    try {
      const page = await get(`/v1/conversations/${id}/messages?after=${newest.current}&limit=100`);
      if (page.items.length) {
        newest.current = Math.max(newest.current, ...page.items.map((m: Message) => m.createdAt));
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          return [...page.items.filter((m: Message) => !known.has(m.id)), ...prev];
        });
        void markRead();
      } else {
        // Read receipts change without new messages: refresh the last outgoing state cheaply.
        setMeta(page.conversation);
      }
    } catch { /* next poll */ }
  };
  useEffect(() => {
    chatOpen.value = id;
    (async () => {
      try {
        const page = await get(`/v1/conversations/${id}/messages?limit=40`);
        setMessages(page.items); setMeta(page.conversation); setCursor(page.nextCursor);
        newest.current = page.items[0]?.createdAt ?? 0;
        void markRead();
        refresh();
      } catch (e) { setError(errorText(e)); }
    })();
    return () => { chatOpen.value = null; };
  }, [id]);
  // Polling while the chat is on screen (the sync loop also runs faster then).
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void loadNewer(); }, 4000);
    return () => window.clearInterval(timer);
  }, [id]);
  const loadOlder = async () => {
    if (!cursor) return;
    const page = await get(`/v1/conversations/${id}/messages?limit=40&before=${cursor}`);
    setMessages((prev) => [...prev, ...page.items]); setCursor(page.nextCursor);
  };
  const send = async (mediaIds: string[] = []) => {
    const body = text.trim();
    if ((!body && !mediaIds.length) || sending) return;
    setSending(true);
    try {
      const m = await post<Message>(`/v1/conversations/${id}/messages`, { body, mediaIds });
      setMessages((prev) => [m, ...prev]); newest.current = Math.max(newest.current, m.createdAt); setText(''); refresh();
    } catch (e) { showToast(errorText(e), 'error'); } finally { setSending(false); }
  };
  const attach = async (file: File) => {
    try { showToast('Uploading…'); const media = await uploadFile(file, 'chat'); await send([media.id]); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const partner = meta?.partner as Card | undefined;
  const menu = () => openSheet((close) => (
    <SheetFrame title={partner?.displayName} close={close}>
      <button class="menu-item" onClick={() => { close(); partner && push('profile-view', { id: partner.id }); }}><img src={`${import.meta.env.BASE_URL}icons/IconUser.svg`} alt="" />Open profile</button>
      <button class="menu-item" onClick={async () => { close(); await post(`/v1/conversations/${id}/mute`, { muted: !meta?.muted }); setMeta({ ...meta, muted: !meta?.muted }); }}>
        <img src={`${import.meta.env.BASE_URL}icons/IconSpeakerX.svg`} alt="" />{meta?.muted ? 'Unmute' : 'Mute'}</button>
      <button class="menu-item is-danger" onClick={async () => { close(); await post('/v1/reports', { targetType: 'profile', targetId: partner?.id, reason: 'spam' }); showToast('Reported — thank you', 'ok'); }}>
        <img src={`${import.meta.env.BASE_URL}icons/IconShieldWarning.svg`} alt="" />Report</button>
    </SheetFrame>
  ));
  if (error) return <><TopBar title="Chat" /><div class="below-topbar"><Empty title="Chat not available" text={error} /></div></>;
  return (
    <>
      <header class="topbar">
        <button class="glass-btn" aria-label="Back" onClick={() => import('../state').then((s) => s.back())}><Icon name="IconArrowLeft" /></button>
        <button class="row grow" style={{ justifyContent: 'center', minWidth: 0 }} onClick={() => partner && push('profile-view', { id: partner.id })}>
          <Avatar card={partner ?? null} size={34} />
          <div style={{ textAlign: 'left', minWidth: 0 }}>
            <div class="ellipsis" style={{ fontWeight: 600, fontSize: 16 }}>{partner?.displayName ?? '…'}</div>
            <div class="ellipsis muted" style={{ fontSize: 12 }}>{meta?.relatedJobTitle ? `💼 ${meta.relatedJobTitle}` : partner ? `@${partner.username}` : ''}</div>
          </div>
        </button>
        <button class="glass-btn" aria-label="More" onClick={menu}><Icon name="IconDotsThree" /></button>
      </header>
      <div class="messages" ref={list} onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollHeight + el.scrollTop - el.clientHeight < 80) void loadOlder();
      }}>
        {messages.length === 0 && <div class="empty" style={{ margin: 'auto' }}>Say hello 👋</div>}
        {messages.map((m, i) => {
          const next = messages[i + 1];
          const day = new Date(m.createdAt).toDateString();
          const showDay = !next || new Date(next.createdAt).toDateString() !== day;
          return (
            <div key={m.id}>
              {showDay && <div class="day-sep">{new Date(m.createdAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>}
              <div class={`bubble-row ${m.isOutgoing ? 'is-out' : ''}`}>
                <div class="bubble">
                  {m.attachments.map((a) => (
                    <button onClick={() => openViewer(a)}>{a.kind === 'video' ? <video src={a.url ?? undefined} preload="metadata" muted playsInline /> : <img src={a.url ?? ''} alt="" loading="lazy" />}</button>
                  ))}
                  {m.body}
                  <span class="bubble__time">{clock(m.createdAt)}{m.isOutgoing && i === 0 ? (m.isReadByOther ? ' ✓✓' : ' ✓') : ''}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div class="composer">
        <button class="glass-btn" aria-label="Attach" onClick={() => fileInput.current?.click()}><Icon name="IconPaperclip" /></button>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" hidden
          onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void attach(f); e.currentTarget.value = ''; }} />
        <textarea class="composer__field" rows={1} placeholder="Message" value={text} maxLength={4000}
          onInput={(e) => { setText(e.currentTarget.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 120)}px`; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); void send(); } }} />
        <button class="send" aria-label="Send" disabled={!text.trim() || sending} onClick={() => send()}><Icon name="IconShareArrow" size={20} /></button>
      </div>
    </>
  );
}

// Keeps a scroll position stable when content above changes (used by long lists).
export function useKeepScroll(ref: { current: HTMLElement | null }, dep: unknown) {
  const saved = useRef(0);
  useLayoutEffect(() => { if (ref.current) ref.current.scrollTop = saved.current; }, [dep]);
  return () => { if (ref.current) saved.current = ref.current.scrollTop; };
}
