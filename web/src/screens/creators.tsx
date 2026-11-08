// creators. — the catalog (creators, and businesses) with server search; My Contacts: All · Requests · Sent.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Card, errorText, get, Page, post } from '../api';
import { activeProfile, badges, push, refresh, refreshTick, showToast } from '../state';
import { Avatar, Empty, flagLocation, gradientFor, Icon, initials, ProBadge, RatingInline, Spinner, TopBar, useDebounced, useLoad } from '../ui';

export function CreatorsScreen() {
  const [kind, setKind] = useState<'creator' | 'business'>('creator');
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 350);
  const [items, setItems] = useState<Card[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sentinel = useRef<HTMLDivElement>(null);
  const load = async (reset: boolean) => {
    setLoading(true);
    try {
      const page = await get<Page<Card>>(`/v1/profiles?type=${kind}&q=${encodeURIComponent(q)}&limit=24${!reset && cursor ? `&cursor=${cursor}` : ''}`);
      setItems((prev) => (reset ? page.items : [...prev, ...page.items])); setCursor(page.nextCursor);
    } catch (e) { showToast(errorText(e), 'error'); } finally { setLoading(false); }
  };
  useEffect(() => { void load(true); }, [kind, q]);
  useEffect(() => {
    if (!sentinel.current) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && cursor && !loading) void load(false); }, { rootMargin: '500px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [cursor, loading]);
  const others = items.filter((c) => c.id !== activeProfile.value?.id);
  return (
    <>
      <header class="topbar">
        <div class="logo-word">creators<i>.</i></div>
        <button class="glass-btn" aria-label="My contacts" onClick={() => push('contacts', {})}>
          <Icon name="IconUser" />{badges.value.contactRequests > 0 && <span class="badge">{badges.value.contactRequests}</span>}
        </button>
      </header>
      <div class="scroll">
        <div class="below-topbar" />
        <div class="pad row" style={{ marginBottom: 12 }}>
          <label class="search"><img src={`${import.meta.env.BASE_URL}icons/IconMagnifyingGlass.svg`} alt="" />
            <input placeholder={kind === 'creator' ? 'Search creators, niches, cities' : 'Search businesses'} value={query} onInput={(e) => setQuery(e.currentTarget.value)} /></label>
        </div>
        <div class="pad chips" style={{ marginBottom: 14 }}>
          <button class={`chip ${kind === 'creator' ? 'is-on' : ''}`} onClick={() => setKind('creator')}>Creators</button>
          <button class={`chip ${kind === 'business' ? 'is-on' : ''}`} onClick={() => setKind('business')}>Businesses</button>
        </div>
        {!loading && !others.length ? <Empty title="Nobody found" text="Try another name, niche or city." iconName="IconMagnifyingGlass" /> : (
          <div class="creator-grid">
            {others.map((c) => (
              <button class="creator-card" key={c.id} onClick={() => push('profile-view', { id: c.id })}>
                {c.avatarUrl ? <img src={c.avatarUrl} alt="" loading="lazy" /> : <div class="monogram" style={{ background: gradientFor(c.displayName) }}>{initials(c.displayName)}</div>}
                <div class="creator-card__info">
                  <div class="creator-card__name ellipsis">{c.displayName} <ProBadge card={c} /></div>
                  <div class="creator-card__meta ellipsis">{flagLocation(c) ?? c.category}</div>
                  <div style={{ marginTop: 4 }}><RatingInline rating={c.rating} count={c.reviewsCount} /></div>
                </div>
              </button>
            ))}
          </div>
        )}
        <div ref={sentinel} />
        {loading && <Spinner />}
      </div>
    </>
  );
}

type ContactsFilter = 'all' | 'requests' | 'sent';

export function ContactsScreen({ filter: initial = 'all' }: { filter?: ContactsFilter }) {
  const [filter, setFilter] = useState<ContactsFilter>(initial);
  const [query, setQuery] = useState('');
  const { data, loading, reload } = useLoad<{ items: { requestId: string; status: string; since: number; profile: Card }[]; counts: Record<string, number> }>(
    (s) => get(`/v1/contacts?filter=${filter}`, s), [filter, refreshTick.value, activeProfile.value?.id]);
  const act = async (requestId: string, action: 'accept' | 'decline' | 'cancel') => {
    try { await post(`/v1/contacts/requests/${requestId}/${action}`); showToast(action === 'accept' ? 'Contact added' : 'Done', 'ok'); reload(); refresh(); }
    catch (e) { showToast(errorText(e), 'error'); }
  };
  const list = (data?.items ?? []).filter((i) => !query || `${i.profile.displayName} ${i.profile.username}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <TopBar title="My Contacts" />
      <div class="scroll">
        <div class="below-topbar" />
        <nav class="seg sticky">
          {(['all', 'requests', 'sent'] as const).map((f) => (
            <button class={`seg__tab ${filter === f ? 'is-active' : ''}`} onClick={() => setFilter(f)}>
              {{ all: 'All', requests: 'Requests', sent: 'Sent' }[f]} <span class="seg__count">{data?.counts?.[f] ?? ''}</span>
            </button>
          ))}
        </nav>
        <div class="pad" style={{ margin: '12px 0' }}>
          <label class="search"><img src={`${import.meta.env.BASE_URL}icons/IconMagnifyingGlass.svg`} alt="" />
            <input placeholder="Search contacts" value={query} onInput={(e) => setQuery(e.currentTarget.value)} /></label>
        </div>
        {loading && !data ? <Spinner /> : !list.length ? (
          <Empty title={{ all: 'No contacts yet', requests: 'No requests', sent: 'No sent requests' }[filter]}
            text={filter === 'all' ? 'Add creators and businesses from their profiles.' : undefined} iconName="IconUserPlus" />
        ) : list.map((i) => (
          <div class="list-row" key={i.requestId}>
            <button class="row grow" style={{ textAlign: 'left' }} onClick={() => push('profile-view', { id: i.profile.id })}>
              <Avatar card={i.profile} size={46} />
              <div class="grow">
                <div class="list-row__title ellipsis">{i.profile.displayName} <ProBadge card={i.profile} /></div>
                <div class="list-row__sub ellipsis">{flagLocation(i.profile) ?? `@${i.profile.username}`}</div>
                <RatingInline rating={i.profile.rating} count={i.profile.reviewsCount} />
              </div>
            </button>
            {filter === 'requests' && <><button class="btn small" onClick={() => act(i.requestId, 'accept')}>Accept</button>
              <button class="btn small secondary" onClick={() => act(i.requestId, 'decline')}>Decline</button></>}
            {filter === 'sent' && <button class="btn small secondary" onClick={() => act(i.requestId, 'cancel')}>Cancel</button>}
          </div>
        ))}
      </div>
    </>
  );
}
