// creators. — CreatorsView: Creators | My Contacts (swiped sideways). Creator cards (Figma 996:18922): avatar 48,
// name + PRO, location, rating; bio; a PRO creator's latest works; Message + In contacts / Add contact.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Card, errorText, get, Media, Page, post } from '../api';
import { activeProfile, badges, openSheet, push, refresh, refreshTick, showToast } from '../state';
import {
  Avatar, Empty, fmtDuration, GlassButton, Header, Icon, icon, Logo, openViewer, PageTabs, ProBadge, SheetFrame, Spinner, StarIcon, SwipePages,
  useDebounced, useLoad, usePullToRefresh,
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
    <>
      <div class="scroll" ref={scroller}>
        <div class="section-top" />
        <PageTabs tabs={[kind === 'creator' ? 'Creators' : 'Businesses', `My Contacts${badges.value.contactRequests ? ` · ${badges.value.contactRequests}` : ''}`]} index={index} onChange={setIndex} />
        <SwipePages index={index} onChange={setIndex}>
          <Catalog kind={kind} q={q} register={(fn) => { if (index === 0) reloadRef.current = fn; }} />
          <ContactsList query={q} register={(fn) => { if (index === 1) reloadRef.current = fn; }} />
        </SwipePages>
        <div style={{ height: 'var(--tabbar-clear)' }} />
      </div>
      <Indicator />
      <Header
        left={searching ? null : <GlassButton name="IconCreatorsFilter" label="Filter" onClick={filter} />}
        center={searching ? null : <Logo word="creators" />}
        right={searching ? (
          <div class="row" style={{ width: 'calc(100vw - 32px)', maxWidth: 'calc(386px - 32px)', gap: 8 }}>
            <label class="glass search"><img src={icon('IconMagnifyingGlass')} alt="" />
              <input autoFocus placeholder={index === 1 ? 'Search contacts' : 'Search names, niches, cities'} value={query} onInput={(e) => setQuery(e.currentTarget.value)} /></label>
            <GlassButton name="IconSheetClose" label="Close search" onClick={() => { setSearching(false); setQuery(''); }} />
          </div>
        ) : <GlassButton name="IconMagnifyingGlass" label="Search" onClick={() => setSearching(true)} />}
      />
    </>
  );
}

function useContactIds() {
  const { data, reload } = useLoad<{ items: Relation[] }>((s) => get('/v1/contacts?filter=all', s), [refreshTick.value, activeProfile.value?.id]);
  return { ids: new Set((data?.items ?? []).map((i) => i.profile.id)), reload };
}

function Catalog({ kind, q, register }: { kind: Kind; q: string; register: (fn: () => Promise<unknown>) => void }) {
  const [items, setItems] = useState<Card[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sentinel = useRef<HTMLDivElement>(null);
  const contacts = useContactIds();
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
      {others.map((c) => <CreatorCard key={c.id} card={c} inContacts={contacts.ids.has(c.id)} onAdded={contacts.reload} />)}
      <div ref={sentinel} />
      {loading && others.length > 0 && <Spinner />}
    </div>
  );
}

function CreatorCard({ card, inContacts, onAdded }: { card: Card & { bio?: string }; inContacts: boolean; onAdded: () => void }) {
  const [requested, setRequested] = useState(false);
  const message = async () => {
    try { const { id } = await post('/v1/conversations', { profileId: card.id }); push('conversation', { id }); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const add = async () => {
    setRequested(true);
    try { await post('/v1/contacts/requests', { profileId: card.id }); showToast('Contact request sent', 'ok'); onAdded(); refresh(); }
    catch (e) { setRequested(false); showToast(errorText(e), 'error'); }
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
            <div class="ccard__loc"><span class="ellipsis">{card.location ? `${card.flag ?? ''} ${card.location}` : card.category ?? `@${card.username}`}</span></div>
          </div>
        </button>
        {card.rating && card.reviewsCount ? <div class="ccard__rating">{card.rating.toFixed(1)}<StarIcon size={16} /></div> : null}
      </div>
      {card.bio && <div class="ccard__bio lines-3" onClick={open}>{card.bio}</div>}
      {card.isPro && card.type === 'creator' && <Works id={card.id} />}
      <div class="ccard__actions">
        <button class="btn" onClick={message}>Message</button>
        {inContacts ? <div class="in-contacts">In contacts<img src={icon('IconCheckCircle')} alt="" /></div>
          : <button class="btn is-outline" disabled={requested} onClick={add}>{requested ? 'Requested' : 'Add contact'}</button>}
      </div>
    </article>
  );
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
          {m.kind === 'video' && <span class="glass mtile__time"><Icon name="IconPlay" size={12} />{m.duration ? fmtDuration(m.duration) : ''}</span>}
        </button>
      )))}
    </div>
  );
}

type ContactsFilter = 'all' | 'requests' | 'sent';

function ContactsList({ query, initial = 'all', register }: { query: string; initial?: ContactsFilter; register?: (fn: () => Promise<unknown>) => void }) {
  const [filter, setFilter] = useState<ContactsFilter>(initial);
  const { data, loading, reload } = useLoad<{ items: (Relation & { since: number })[]; counts: Record<string, number> }>(
    (s) => get(`/v1/contacts?filter=${filter}`, s), [filter, refreshTick.value, activeProfile.value?.id]);
  register?.(() => reload());
  const act = async (requestId: string, action: 'accept' | 'decline' | 'cancel') => {
    try { await post(`/v1/contacts/requests/${requestId}/${action}`); showToast(action === 'accept' ? 'Contact added' : 'Done', 'ok'); reload(); refresh(); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const message = async (card: Card) => {
    try { const { id } = await post('/v1/conversations', { profileId: card.id }); push('conversation', { id }); } catch (e) { showToast(errorText(e), 'error'); }
  };
  const list = (data?.items ?? []).filter((i) => !query || `${i.profile.displayName} ${i.profile.username}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <div class="seg-chips">
        {(['all', 'requests', 'sent'] as const).map((f) => (
          <button class={`mchip ${filter === f ? 'is-on' : ''}`} onClick={() => setFilter(f)}>
            {{ all: 'All', requests: 'Requests', sent: 'Sent' }[f]}{data?.counts?.[f] ? ` ${data.counts[f]}` : ''}
          </button>
        ))}
      </div>
      {loading && !data ? <Spinner /> : !list.length ? (
        <Empty title={{ all: 'No contacts yet', requests: 'No requests', sent: 'No sent requests' }[filter]}
          text={filter === 'all' ? 'Add creators and businesses from their cards or profiles.' : undefined} iconName="IconUserPlus" />
      ) : list.map((i) => (
        <div class="contact-row" key={i.requestId}>
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
      ))}
    </>
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
