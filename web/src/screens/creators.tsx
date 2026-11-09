// creators. — CreatorsView: Creators | My Contacts (swiped sideways). Creator cards (Figma 996:18922): avatar 48,
// name + PRO, location, rating; bio; a PRO creator's latest works; Message + In contacts / Add contact.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Card, del, errorText, get, Media, Page, post } from '../api';
import { activeProfile, badges, openSheet, push, refresh, refreshTick, showToast } from '../state';
import {
  Subtab, SortButton, pickSheet, openContextMenu, useLongPress, Avatar, Empty, VideoTime, GlassButton, Header, Icon, icon, Logo, openViewer, PageTabs, ProBadge, SheetFrame, Spinner, StarIcon, SwipePages,
  useDebounced, useLoad, usePullToRefresh, useCollapsingHeader, TopBlur,
} from '../ui';

type Kind = 'creator' | 'business';
type Relation = { requestId: string; status: string; profile: Card };

export function CreatorsScreen() {
  const [index, setIndex] = useState(0);
  const [kind, setKind] = useState<Kind>('creator');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 350);
  const reloadRef = useRef<() => Promise<unknown>>();
  const { scroller, Indicator } = usePullToRefresh(() => reloadRef.current?.());
  const { root, changeTab } = useCollapsingHeader({}, scroller);
  const pick = (i: number) => changeTab(index, i, () => setIndex(i));
  const filter = () => openSheet((close) => (
    <SheetFrame title="Show" close={close}>
      {(['creator', 'business'] as Kind[]).map((k) => (
        <button class="menu-item" onClick={() => { setKind(k); setIndex(0); close(); }}>
          <img src={icon(k === 'creator' ? 'IconVideoCamera' : 'IconBriefcase')} alt="" /><span class="grow">{k === 'creator' ? 'Creators' : 'Businesses'}</span>
          {kind === k && <Icon name="IconCheckActive" />}
        </button>
      ))}
    </SheetFrame>
  ));
  return (
    <div class="collapsing" ref={root}>
      <div class="scroll" ref={scroller}>
        <TopBlur sticky />
        <div class="tabs-pin" data-collapse-tabs><PageTabs tabs={[kind === 'creator' ? 'Creators' : 'Businesses', `My Contacts${badges.value.contactRequests ? ` · ${badges.value.contactRequests}` : ''}`]} index={index} onChange={pick} /></div>
        <SwipePages index={index} onChange={pick}>
          <Catalog kind={kind} q={q} register={(fn) => { if (index === 0) reloadRef.current = fn; }} />
          <ContactsList query={q} register={(fn) => { if (index === 1) reloadRef.current = fn; }} />
        </SwipePages>
        <div style={{ height: 'var(--tabbar-clear)' }} />
      </div>
      <Indicator />
      <Header blur={false}
        left={searching ? null : <GlassButton name="IconCreatorsFilter" label="Filter" onClick={filter} />}
        collapsingTitle center={searching ? null : <Logo word="creators" />}
        right={searching ? (
          <div class="row" style={{ width: 370, gap: 8 }}>
            <label class="glass search"><img src={icon('IconMagnifyingGlass')} alt="" />
              <input autoFocus placeholder={index === 1 ? 'Search contacts' : 'Search names, niches, cities'} value={query} onInput={(e) => setQuery(e.currentTarget.value)} /></label>
            <GlassButton name="IconSheetClose" label="Close search" onClick={() => { setSearching(false); setQuery(''); }} />
          </div>
        ) : <GlassButton name="IconMagnifyingGlass" label="Search" onClick={() => setSearching(true)} />}
      />
    </div>
  );
}

type Rel = { relation: 'none' | 'requested' | 'incoming' | 'connected'; requestId?: string };

/** Every profile's contact state for the acting profile, from the three My Contacts lists (one request each). */
function useRelations() {
  const { data, reload, setData } = useLoad<Map<string, Rel>>(async (s) => {
    const [all, inc, sent] = await Promise.all((['all', 'requests', 'sent'] as const).map((f) => get<{ items: Relation[] }>(`/v1/contacts?filter=${f}`, s)));
    const m = new Map<string, Rel>();
    sent.items.forEach((i) => m.set(i.profile.id, { relation: 'requested', requestId: i.requestId }));
    inc.items.forEach((i) => m.set(i.profile.id, { relation: 'incoming', requestId: i.requestId }));
    all.items.forEach((i) => m.set(i.profile.id, { relation: 'connected', requestId: i.requestId }));
    return m;
  }, [refreshTick.value, activeProfile.value?.id]);
  const set = (id: string, rel: Rel) => setData(new Map(data ?? []).set(id, rel));
  return { get: (id: string): Rel => data?.get(id) ?? { relation: 'none' }, set, reload };
}

function Catalog({ kind, q, register }: { kind: Kind; q: string; register: (fn: () => Promise<unknown>) => void }) {
  const [items, setItems] = useState<Card[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sentinel = useRef<HTMLDivElement>(null);
  const contacts = useRelations();
  const load = async (reset: boolean) => {
    setLoading(true);
    try {
      const page = await get<Page<Card & { bio?: string }>>(`/v1/profiles?type=${kind}&q=${encodeURIComponent(q)}&limit=20${!reset && cursor ? `&cursor=${cursor}` : ''}`);
      setItems((prev) => (reset ? page.items : [...prev, ...page.items])); setCursor(page.nextCursor);
    } catch (e) { showToast(errorText(e), 'error'); } finally { setLoading(false); }
  };
  register(() => Promise.all([load(true), contacts.reload()]));
  useEffect(() => { void load(true); }, [kind, q, activeProfile.value?.id]);
  useEffect(() => {
    if (!sentinel.current) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && cursor && !loading) void load(false); }, { rootMargin: '600px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [cursor, loading]);
  const others = items.filter((c) => c.id !== activeProfile.value?.id);
  if (!loading && !others.length) return <Empty title="Nobody found" text="Try another name, niche or city." iconName="IconMagnifyingGlass" />;
  return (
    <div class="ccards">
      {!others.length && loading && [0, 1].map(() => <div class="skeleton" style={{ height: 230, borderRadius: 20 }} />)}
      {others.map((c) => <CreatorCard key={c.id} card={c} rel={contacts.get(c.id)} onRel={(r) => contacts.set(c.id, r)} />)}
      <div ref={sentinel} />
      {loading && others.length > 0 && <Spinner />}
    </div>
  );
}

function CreatorCard({ card, rel, onRel }: { card: Card & { bio?: string }; rel: Rel; onRel: (r: Rel) => void }) {
  const message = async () => {
    try { const { id } = await post('/v1/conversations', { profileId: card.id }); push('conversation', { id }); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const open = () => push('profile-view', { id: card.id });
  return (
    <article class="ccard">
      {card.isPro && <div class={`ccard__glow ${card.type === 'business' ? 'is-business' : ''}`} />}
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <button class="ccard__head" onClick={open}>
          <Avatar card={card} size={48} ring />
          <div class="grow">
            <div class="ccard__name"><span class="ellipsis">{card.displayName}</span><ProBadge card={card} compact /></div>
            <div class="ccard__loc"><span class="ellipsis">{card.location ? `${card.flag ?? ''} ${card.location}` : `@${card.username}`}</span></div>
          </div>
        </button>
        {card.rating && card.reviewsCount ? <div class="ccard__rating">{card.rating.toFixed(1)}<StarIcon size={16} /></div> : null}
      </div>
      {card.bio && <div class="ccard__bio lines-3" onClick={open}>{card.bio}</div>}
      {card.isPro && card.type === 'creator' && <Works id={card.id} />}
      <div class="ccard__actions">
        <button class="btn" onClick={message}>Message</button>
        <ContactButton card={card} rel={rel} onRel={onRel} />
      </div>
    </article>
  );
}

/** CreatorContactButton: Add to contacts → Requested (Cancel request) → In contacts ✓ (Remove contact); Accept request. */
export function ContactButton({ card, rel, onRel }: { card: Card; rel: Rel; onRel: (r: Rel) => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<any>, next: (res: any) => Rel, ok: string) => {
    const before = rel;
    setBusy(true);
    try { const res = await fn(); onRel(next(res)); showToast(ok, 'ok'); refresh(); }
    catch (e) { onRel(before); showToast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const add = () => run(() => post('/v1/contacts/requests', { profileId: card.id }), (r) => ({ relation: r?.relation ?? 'requested', requestId: r?.requestId }), 'Contact request sent');
  if (rel.relation === 'none') return <button class="cbtn is-outlined" disabled={busy} onClick={add}><img src={icon('IconUserPlus')} alt="" />{busy ? 'Sending…' : 'Add to contacts'}</button>;
  if (rel.relation === 'incoming') return <button class="cbtn is-outlined" disabled={busy} onClick={() => run(() => post(`/v1/contacts/requests/${rel.requestId}/accept`), () => ({ relation: 'connected' }), 'Contact added')}><img src={icon('IconUserPlus')} alt="" />Accept request</button>;
  const menu = (e: MouseEvent) => openContextMenu(e.currentTarget as HTMLElement, rel.relation === 'requested'
    ? [{ label: 'Cancel request', icon: 'IconXCircle', danger: true, run: () => void run(() => post(`/v1/contacts/requests/${rel.requestId}/cancel`), () => ({ relation: 'none' }), 'Request cancelled') }]
    : [{ label: 'Remove contact', icon: 'IconUserMinus', danger: true, run: () => void run(() => del(`/v1/contacts/${card.id}`), () => ({ relation: 'none' }), 'Contact removed') }]);
  return rel.relation === 'requested'
    ? <button class="cbtn is-calm" disabled={busy} onClick={menu as any}>Requested</button>
    : <button class="cbtn is-calm is-in" disabled={busy} onClick={menu as any}>In contacts<img src={icon('IconFollowingCheck')} alt="" style={{ width: 20, height: 20 }} /></button>;
}

/** A PRO creator's latest videos, loaded once the card is near the screen. */
function Works({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Media[] | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (!e[0].isIntersecting) return;
      io.disconnect();
      get<{ items: Media[] }>(`/v1/profiles/${id}/media?purpose=portfolio&kind=video`).then((d) => setItems(d.items.slice(0, 8))).catch(() => setItems([]));
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [id]);
  if (items && !items.length) return null;
  return (
    <div class="works" ref={ref} data-hscroll>
      {(items ?? [0, 1, 2]).map((m: any) => (typeof m === 'number' ? <div class="skeleton" style={{ flex: 'none', width: 112, height: 136 }} /> : (
        <button onClick={() => openViewer(m)} aria-label={m.title ?? m.kind}>
          <img src={(m.kind === 'video' ? m.posterUrl : m.url) ?? ''} alt="" loading="lazy" />
          {m.kind === 'video' && <VideoTime media={m} />}
        </button>
      )))}
    </div>
  );
}

type ContactsFilter = 'all' | 'requests' | 'sent';

function ContactsList({ query, initial = 'all', register }: { query: string; initial?: ContactsFilter; register?: (fn: () => Promise<unknown>) => void }) {
  const [filter, setFilter] = useState<ContactsFilter>(initial);
  // The data says which tab it was loaded for: rows of the previous tab never render with this tab's buttons.
  const { data, reload } = useLoad<{ filter: ContactsFilter; items: (Relation & { since: number })[]; counts: Record<string, number> }>(
    async (s) => ({ ...(await get(`/v1/contacts?filter=${filter}`, s)), filter }), [filter, refreshTick.value, activeProfile.value?.id]);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => { if (data?.counts) setCounts(data.counts); }, [data]);
  const ready = data?.filter === filter;
  register?.(() => reload());
  const act = async (requestId: string, action: 'accept' | 'decline' | 'cancel') => {
    try { await post(`/v1/contacts/requests/${requestId}/${action}`); showToast(action === 'accept' ? 'Contact added' : 'Done', 'ok'); reload(); refresh(); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const message = async (card: Card) => {
    try { const { id } = await post('/v1/conversations', { profileId: card.id }); push('conversation', { id }); } catch (e) { showToast(errorText(e), 'error'); }
  };
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const list = (ready ? data!.items : []).filter((i) => !query || `${i.profile.displayName} ${i.profile.username}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (sort === 'name' ? a.profile.displayName.localeCompare(b.profile.displayName) : b.since - a.since));
  return (
    <>
      <div class="seg-chips">
        {(['all', 'requests', 'sent'] as const).map((f) => (
          <Subtab label={{ all: 'All', requests: 'Requests', sent: 'Sent' }[f]} count={counts?.[f] ?? 0} on={filter === f} onClick={() => setFilter(f)} />
        ))}
        <span class="grow" />
        <SortButton onClick={() => pickSheet('Sort contacts', [['recent', 'Recently added'], ['name', 'Name']], sort, setSort)} />
      </div>
      {!ready ? <Spinner /> : !list.length ? (
        query ? <Empty title="No results" /> : <Empty title={{ all: 'No contacts yet', requests: 'No requests', sent: 'No sent requests' }[filter]}
          text={{ all: 'Add creators to your contacts — they appear here once they accept.', requests: 'Contact requests to you appear here.', sent: 'Requests you send wait here until answered.' }[filter]} />
      ) : list.map((i) => (
        <ContactRow key={`${filter}-${i.requestId}`} i={i} filter={filter} act={act} message={message} />
      ))}
    </>
  );
}

function ContactRow({ i, filter, act, message }: { i: Relation; filter: ContactsFilter; act: (id: string, a: 'accept' | 'decline' | 'cancel') => void; message: (c: Card) => void }) {
  const removeContact = async () => {
    try { await del(`/v1/contacts/${i.profile.id}`); showToast('Contact removed', 'ok'); refresh(); } catch (e) { showToast(errorText(e), 'error'); }
  };
  const actions = filter === 'all' ? [{ label: 'Remove contact', icon: 'IconUserMinus', danger: true, run: () => void removeContact() }]
    : filter === 'requests' ? [{ label: 'Accept', icon: 'IconCheckCircle', run: () => act(i.requestId, 'accept') }, { label: 'Decline', icon: 'IconXCircle', danger: true, run: () => act(i.requestId, 'decline') }]
    : [{ label: 'Cancel request', icon: 'IconXCircle', danger: true, run: () => act(i.requestId, 'cancel') }];
  const press = useLongPress((el) => openContextMenu(el, actions));
  return (
        <div class="contact-row" onPointerDown={press.onPointerDown as any} onPointerMove={press.onPointerMove as any} onPointerUp={press.onPointerUp}
          onPointerCancel={press.onPointerCancel} onPointerLeave={press.onPointerLeave} onContextMenu={press.onContextMenu} onClickCapture={(e) => { if (press.consume()) { e.stopPropagation(); e.preventDefault(); } }}>
          <button class="row grow" style={{ gap: 12 }} onClick={() => push('profile-view', { id: i.profile.id })}>
            <Avatar card={i.profile} size={48} />
            <div class="grow">
              <div class="contact-row__name"><span class="ellipsis">{i.profile.displayName}</span><ProBadge card={i.profile} compact /></div>
              <div class="contact-row__sub ellipsis">{i.profile.location ? `${i.profile.flag ?? ''} ${i.profile.location}` : `@${i.profile.username}`}</div>
            </div>
          </button>
          {filter === 'all' && <GlassButton name="IconChatText" label={`Message ${i.profile.displayName}`} onClick={() => message(i.profile)} />}
          {filter === 'requests' && <><button class="btn is-small" onClick={() => act(i.requestId, 'accept')}>Accept</button>
            <button class="btn is-small is-milky" onClick={() => act(i.requestId, 'decline')}>Decline</button></>}
          {filter === 'sent' && <button class="btn is-small is-milky" onClick={() => act(i.requestId, 'cancel')}>Cancel</button>}
        </div>
  );
}

/** My Contacts as its own screen (from notifications and Settings). */
export function ContactsScreen({ filter = 'all' }: { filter?: ContactsFilter }) {
  return (
    <>
      <div class="scroll"><div class="section-top" /><ContactsList query="" initial={filter} /><div style={{ height: 40 }} /></div>
      <Header left={<GlassButton name="IconArrowLeft" label="Back" back onClick={() => import('../state').then((s) => s.back())} />}
        center={<div class="header__title">My Contacts</div>} />
    </>
  );
}
