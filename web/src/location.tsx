// One location field (iOS KolabaPlace + LocationPickerSheet, ProjectCatalogs.KolabaCountries): a country as
// "Ukraine, all cities" or a city as "Kharkiv, Ukraine". The sheet searches countries (in English, Ukrainian and
// Russian names, any word's start) and their big cities, plus a typed city for a found country; before a search it
// shows recently used places or the suggested countries. Stored on the profile as country + countryCode + city.
import { useState } from 'preact/hooks';
import { openSheet } from './state';
import { icon, Icon, SheetFrame } from './ui';

export interface Place { countryCode: string; city: string | null }

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const names = (lang: string) => { try { return new Intl.DisplayNames([lang], { type: 'region' }); } catch { return null; } };
const EN = names('en'); const UK = names('uk'); const RU = names('ru');
/** Every ISO 3166-1 alpha-2 region the browser can name (no "XX" placeholders). */
export const COUNTRY_CODES: string[] = (() => {
  const out: string[] = [];
  for (const a of LETTERS) for (const b of LETTERS) {
    const code = a + b;
    const name = EN?.of(code);
    if (name && name !== code && !/^Unknown/i.test(name)) out.push(code);
  }
  return out.filter((c) => !['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ'].includes(c));
})();

export const countryName = (code: string) => EN?.of(code.toUpperCase()) ?? code;
export const flagOf = (code: string) => code.toUpperCase().replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));
/** "Ukraine, all cities" · "Kharkiv, Ukraine" (KolabaPlace.title). */
export const placeTitle = (p: Place) => (p.city ? `${p.city}, ${countryName(p.countryCode)}` : `${countryName(p.countryCode)}, all cities`);

const MAJOR_CITIES: Record<string, string[]> = {
  UA: ['Kyiv', 'Lviv', 'Odesa', 'Dnipro', 'Kharkiv'], ID: ['Bali', 'Jakarta', 'Bandung', 'Surabaya', 'Yogyakarta'],
  PL: ['Warsaw', 'Kraków', 'Wrocław', 'Gdańsk', 'Poznań'], ES: ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Málaga'],
  DE: ['Berlin', 'Munich', 'Hamburg', 'Cologne', 'Frankfurt'], FR: ['Paris', 'Marseille', 'Lyon', 'Nice', 'Bordeaux'],
  IT: ['Rome', 'Milan', 'Naples', 'Florence', 'Venice'], PT: ['Lisbon', 'Porto', 'Faro', 'Braga', 'Funchal'],
  GB: ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Liverpool'], US: ['New York', 'Los Angeles', 'Miami', 'Chicago', 'San Francisco'],
  TR: ['Istanbul', 'Antalya', 'Izmir', 'Ankara', 'Bodrum'], AE: ['Dubai', 'Abu Dhabi', 'Sharjah'],
  TH: ['Bangkok', 'Phuket', 'Chiang Mai', 'Pattaya', 'Koh Samui'], GE: ['Tbilisi', 'Batumi', 'Kutaisi'], KR: ['Seoul', 'Busan', 'Incheon'],
};
const SUGGESTED = ['ID', 'UA', 'PL', 'ES', 'AE', 'TH'];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const startsWord = (name: string, q: string) => { const n = fold(name); return n.startsWith(q) || n.split(/[\s-]+/).some((w) => w.startsWith(q)); };

/** The country codes matching a name or the start of one of its words, in English, Ukrainian or Russian. */
export function searchCountries(query: string) {
  const q = fold(query.trim());
  if (!q) return [];
  return COUNTRY_CODES.filter((c) => [EN?.of(c), UK?.of(c), RU?.of(c)].some((n) => n && startsWord(n, q)));
}

/** The code of a country named exactly (any of the three languages). */
export function codeNamed(name: string | null | undefined) {
  if (!name) return null;
  const n = fold(name.trim());
  return COUNTRY_CODES.find((c) => [EN?.of(c), UK?.of(c), RU?.of(c)].some((x) => x && fold(x) === n)) ?? null;
}

const RECENT_KEY = 'kolaba.recentPlaces';
const recent = (): Place[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } };
const remember = (p: Place) => {
  const list = [p, ...recent().filter((x) => x.countryCode !== p.countryCode || x.city !== p.city)].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private mode */ }
};

/** Search results: "Country — All cities" first (three countries at most), then their big cities, then cities
 *  named like the query anywhere in the list, then the typed text as a city of the first country found
 *  ("Kharkiv, Ukraine" from "kharkiv, ukr" or a city not in the list). */
function results(query: string): Place[] {
  const [cityPart, countryPart] = query.split(',').map((s) => s.trim());
  const q = fold(cityPart ?? '');
  const countries = searchCountries(countryPart ?? cityPart ?? '').slice(0, 3);
  const out: Place[] = countryPart ? [] : countries.map((c) => ({ countryCode: c, city: null }));
  for (const c of countries) for (const city of MAJOR_CITIES[c] ?? []) if (!countryPart || startsWord(city, q)) out.push({ countryCode: c, city });
  if (q) for (const [c, cities] of Object.entries(MAJOR_CITIES)) for (const city of cities) {
    if (startsWord(city, q) && !out.some((p) => p.countryCode === c && p.city === city)) out.push({ countryCode: c, city });
  }
  if (countryPart && cityPart && countries[0] && !out.some((p) => p.city && fold(p.city) === q)) {
    out.unshift({ countryCode: countries[0], city: cityPart.replace(/^./, (ch) => ch.toUpperCase()) });
  }
  return out;
}

function LocationSheet({ selected, onSelect, close }: { selected: Place | null; onSelect: (p: Place | null) => void; close: () => void }) {
  const [query, setQuery] = useState('');
  const list = query.trim() ? results(query) : (recent().length ? recent() : SUGGESTED.map((c) => ({ countryCode: c, city: null })));
  const same = (p: Place) => !!selected && p.countryCode === selected.countryCode && (p.city ?? '') === (selected.city ?? '');
  const choose = (p: Place) => { remember(p); onSelect(p); close(); };
  return (
    <SheetFrame title="Locations" close={close}>
      <label class="glass search" style={{ margin: '0 0 12px', width: '100%' }}>
        <img src={icon('IconMagnifyingGlass')} alt="" />
        <input autoFocus placeholder="Search countries and cities" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      </label>
      {!query.trim() && <div class="sel-title">{recent().length ? 'Recently used' : 'Suggested'}</div>}
      {list.map((p) => (
        <button class="menu-item" role="option" aria-selected={same(p)} onClick={() => choose(p)}>
          <span style={{ width: 24, textAlign: 'center' }}>{flagOf(p.countryCode)}</span>
          <span class="grow ellipsis">{p.city ? placeTitle(p) : `${countryName(p.countryCode)} — All cities`}</span>
          {same(p) && <Icon name="IconCheckActive" />}
        </button>
      ))}
      {query.trim() && !list.length && <div class="muted" style={{ padding: '12px 4px', fontSize: 14 }}>No places found yet. Try “City, Country”.</div>}
      {selected && !query.trim() && (
        <button class="menu-item is-danger" onClick={() => { onSelect(null); close(); }}><Icon name="IconXCircle" />Clear location</button>
      )}
    </SheetFrame>
  );
}

export function openLocationPicker(selected: Place | null, onSelect: (p: Place | null) => void) {
  openSheet((close) => <LocationSheet selected={selected} onSelect={onSelect} close={close} />, { tall: true });
}

/** The form's one Location field (a button styled as the input). */
export function LocationField({ value, onChange, placeholder = 'Your location' }: { value: Place | null; onChange: (p: Place | null) => void; placeholder?: string }) {
  return (
    <button type="button" class="field is-button" onClick={() => openLocationPicker(value, onChange)} aria-label={value ? `Location: ${placeTitle(value)}` : placeholder}>
      <img src={icon('IconMapPin')} alt="" />
      <span class={`grow ellipsis ${value ? '' : 'field__placeholder'}`}>{value ? `${flagOf(value.countryCode)} ${placeTitle(value)}` : placeholder}</span>
      <img src={icon('IconCaretRight')} alt="" style={{ width: 14, height: 14, opacity: .5 }} />
    </button>
  );
}

/** The API's fields for a place (country in English, its code, the city or null). */
export const placeFields = (p: Place | null) => (p ? { country: countryName(p.countryCode), countryCode: p.countryCode, city: p.city } : { country: null, countryCode: null, city: null });
/** A profile's stored place back as a Place (older rows may have only names). */
export const placeOf = (r: { countryCode?: string | null; country?: string | null; city?: string | null }): Place | null => {
  const code = r.countryCode ?? codeNamed(r.country);
  return code ? { countryCode: code.toUpperCase(), city: r.city || null } : null;
};
