/* Шторка выбора страны и текущего местоположения */
import { state } from '../core/state.js';

/* ── Выбор страны и текущего местоположения ── */
const COUNTRY_CODES = `
  AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
  BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
  CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
  DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
  GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
  HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
  KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
  MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
  NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
  QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
  TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
  VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW
`.trim().split(/\s+/);

const countryNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

const FALLBACK_COUNTRY_NAMES = {
  BE: 'Belgium', DE: 'Germany', ES: 'Spain', FR: 'France', GB: 'United Kingdom',
  ID: 'Indonesia', IT: 'Italy', NL: 'Netherlands', PT: 'Portugal', RU: 'Russia',
  UA: 'Ukraine', US: 'United States', XK: 'Kosovo'
};

const flagFor = code => code && code.length === 2
  ? [...code.toUpperCase()].map(letter => String.fromCodePoint(127397 + letter.charCodeAt())).join('')
  : '🌍';

const COUNTRIES = COUNTRY_CODES.map(code => ({
  code,
  name: countryNames?.of(code) || FALLBACK_COUNTRY_NAMES[code] || code,
  flag: flagFor(code)
})).sort((a, b) => a.name.localeCompare(b.name, 'en'));

const countryByCode = code => COUNTRIES.find(country => country.code === code);

// Популярные города хранятся локально: подсказки мгновенные и не отправляют ввод пользователя наружу.
const CITIES = [
  ['Amsterdam', 'NL', 52.3676, 4.9041], ['Athens', 'GR', 37.9838, 23.7275],
  ['Bali', 'ID', -8.4095, 115.1889], ['Bangkok', 'TH', 13.7563, 100.5018],
  ['Barcelona', 'ES', 41.3874, 2.1686], ['Beijing', 'CN', 39.9042, 116.4074],
  ['Belgrade', 'RS', 44.7866, 20.4489], ['Berlin', 'DE', 52.5200, 13.4050],
  ['Bogotá', 'CO', 4.7110, -74.0721], ['Bratislava', 'SK', 48.1486, 17.1077],
  ['Brussels', 'BE', 50.8503, 4.3517], ['Bucharest', 'RO', 44.4268, 26.1025],
  ['Budapest', 'HU', 47.4979, 19.0402], ['Buenos Aires', 'AR', -34.6037, -58.3816],
  ['Cairo', 'EG', 30.0444, 31.2357], ['Cape Town', 'ZA', -33.9249, 18.4241],
  ['Chicago', 'US', 41.8781, -87.6298], ['Copenhagen', 'DK', 55.6761, 12.5683],
  ['Delhi', 'IN', 28.6139, 77.2090], ['Denpasar', 'ID', -8.6705, 115.2126],
  ['Doha', 'QA', 25.2854, 51.5310], ['Dubai', 'AE', 25.2048, 55.2708],
  ['Dublin', 'IE', 53.3498, -6.2603], ['Edinburgh', 'GB', 55.9533, -3.1883],
  ['Florence', 'IT', 43.7696, 11.2558], ['Geneva', 'CH', 46.2044, 6.1432],
  ['Helsinki', 'FI', 60.1699, 24.9384], ['Hong Kong', 'HK', 22.3193, 114.1694],
  ['Istanbul', 'TR', 41.0082, 28.9784], ['Jakarta', 'ID', -6.2088, 106.8456],
  ['Kyiv', 'UA', 50.4501, 30.5234], ['Lagos', 'NG', 6.5244, 3.3792],
  ['Lisbon', 'PT', 38.7223, -9.1393], ['London', 'GB', 51.5072, -0.1276],
  ['Los Angeles', 'US', 34.0522, -118.2437], ['Madrid', 'ES', 40.4168, -3.7038],
  ['Manila', 'PH', 14.5995, 120.9842], ['Melbourne', 'AU', -37.8136, 144.9631],
  ['Mexico City', 'MX', 19.4326, -99.1332], ['Miami', 'US', 25.7617, -80.1918],
  ['Milan', 'IT', 45.4642, 9.1900], ['Montreal', 'CA', 45.5019, -73.5674],
  ['Moscow', 'RU', 55.7558, 37.6173], ['Mumbai', 'IN', 19.0760, 72.8777],
  ['Munich', 'DE', 48.1351, 11.5820], ['New York', 'US', 40.7128, -74.0060],
  ['Nice', 'FR', 43.7102, 7.2620], ['Oslo', 'NO', 59.9139, 10.7522],
  ['Paris', 'FR', 48.8566, 2.3522], ['Prague', 'CZ', 50.0755, 14.4378],
  ['Rio de Janeiro', 'BR', -22.9068, -43.1729], ['Riyadh', 'SA', 24.7136, 46.6753],
  ['Rome', 'IT', 41.9028, 12.4964], ['San Francisco', 'US', 37.7749, -122.4194],
  ['São Paulo', 'BR', -23.5505, -46.6333], ['Seoul', 'KR', 37.5665, 126.9780],
  ['Shanghai', 'CN', 31.2304, 121.4737], ['Singapore', 'SG', 1.3521, 103.8198],
  ['Stockholm', 'SE', 59.3293, 18.0686], ['Sydney', 'AU', -33.8688, 151.2093],
  ['Tallinn', 'EE', 59.4370, 24.7536], ['Tbilisi', 'GE', 41.7151, 44.8271],
  ['Tel Aviv', 'IL', 32.0853, 34.7818], ['Tokyo', 'JP', 35.6762, 139.6503],
  ['Toronto', 'CA', 43.6532, -79.3832], ['Valencia', 'ES', 39.4699, -0.3763],
  ['Vancouver', 'CA', 49.2827, -123.1207], ['Venice', 'IT', 45.4408, 12.3155],
  ['Vienna', 'AT', 48.2082, 16.3738], ['Vilnius', 'LT', 54.6872, 25.2797],
  ['Warsaw', 'PL', 52.2297, 21.0122], ['Zagreb', 'HR', 45.8150, 15.9819],
  ['Zurich', 'CH', 47.3769, 8.5417]
].map(([city, code, lat, lon]) => ({ city, code, lat, lon }));

const picker = document.getElementById('profilePicker');
const pickerTitle = document.getElementById('pickerTitle');
const pickerSearch = document.getElementById('pickerSearch');
const pickerLabel = document.getElementById('pickerLabel');
const pickerList = document.getElementById('pickerList');
const useDeviceLocation = document.getElementById('useDeviceLocation');
const geoStatus = document.getElementById('geoStatus');
const pickerAttribution = document.getElementById('pickerAttribution');
let pickerMode = 'country';

const normalize = value => value.toLocaleLowerCase('en').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function locationOption(city) {
  const country = countryByCode(city.code);
  return {
    label: `${city.city}, ${country?.name || city.code}`,
    sublabel: country?.name || city.code,
    code: city.code,
    flag: country?.flag || flagFor(city.code),
    city: city.city
  };
}

function createPickerOption(item, selected, onSelect) {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'picker__option';
  option.setAttribute('role', 'option');
  option.setAttribute('aria-selected', String(selected));

  const flag = document.createElement('span');
  flag.className = 'picker__option-flag';
  flag.textContent = item.flag;

  const copy = document.createElement('span');
  copy.className = 'picker__option-copy';
  const title = document.createElement('b');
  title.textContent = item.label;
  copy.appendChild(title);
  if (item.sublabel && item.sublabel !== item.label) {
    const subtitle = document.createElement('em');
    subtitle.textContent = item.sublabel;
    copy.appendChild(subtitle);
  }

  option.append(flag, copy);
  if (selected) {
    const check = document.createElement('img');
    check.className = 'picker__check';
    check.src = 'assets/icons/Check.svg';
    check.alt = '';
    option.appendChild(check);
  }
  option.addEventListener('click', onSelect);
  return option;
}

function setCountry(country) {
  state.selectedCountryCode = country.code;
  document.getElementById('countryFlag').textContent = country.flag;
  document.getElementById('countryValue').textContent = country.name;
  window.refreshSettingsValues?.();
  closePicker();
}

function setLocation(location, close = true) {
  state.selectedLocation = location;
  document.getElementById('locationFlag').textContent = location.flag || flagFor(location.code);
  document.getElementById('locationValue').textContent = location.label;
  document.getElementById('locationOutFlag').textContent = location.flag || flagFor(location.code);
  document.getElementById('locationOut').textContent = location.label;
  window.refreshSettingsValues?.();
  if (close) closePicker();
}

function renderPicker() {
  const query = normalize(pickerSearch.value.trim());
  pickerList.replaceChildren();

  if (pickerMode === 'country') {
    const matches = COUNTRIES.filter(country => normalize(country.name).includes(query));
    pickerLabel.textContent = query ? `${matches.length} countries found` : 'All countries';
    matches.forEach(country => {
      pickerList.appendChild(createPickerOption(
        { label: country.name, code: country.code, flag: country.flag },
        country.code === state.selectedCountryCode,
        () => setCountry(country)
      ));
    });
    if (!matches.length) pickerList.innerHTML = '<p class="picker__empty">No countries found.<br>Try another spelling.</p>';
    return;
  }

  const cityMatches = CITIES
    .filter(city => {
      const country = countryByCode(city.code);
      return normalize(`${city.city} ${country?.name || ''}`).includes(query);
    })
    .slice(0, query ? 40 : 18)
    .map(locationOption);

  const countryMatches = query
    ? COUNTRIES.filter(country => normalize(country.name).includes(query)).slice(0, 20).map(country => ({
        label: country.name, sublabel: 'Country', code: country.code, flag: country.flag
      }))
    : [];

  const matches = [...cityMatches, ...countryMatches].filter((item, index, all) =>
    all.findIndex(candidate => candidate.label === item.label) === index
  );

  pickerLabel.textContent = query ? 'Suggestions' : 'Popular locations';
  matches.forEach(location => {
    pickerList.appendChild(createPickerOption(
      location,
      location.label === state.selectedLocation.label,
      () => setLocation(location)
    ));
  });

  if (!matches.length) {
    pickerList.innerHTML = '<p class="picker__empty">No matching city or country.<br>Try a nearby major city.</p>';
  }
}

function openPicker(mode) {
  pickerMode = mode;
  pickerTitle.textContent = mode === 'country' ? 'Select nationality' : 'Current location';
  pickerSearch.placeholder = mode === 'country' ? 'Search country' : 'Search city or country';
  pickerSearch.value = '';
  useDeviceLocation.hidden = mode !== 'location';
  pickerAttribution.hidden = true;
  geoStatus.textContent = navigator.geolocation ? 'Location permission required' : 'Not supported by this device';
  renderPicker();
  picker.classList.add('is-open');
  picker.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => pickerSearch.focus({ preventScroll: true }), 260);
}

function closePicker() {
  picker.classList.remove('is-open');
  picker.setAttribute('aria-hidden', 'true');
  pickerSearch.blur();
}

document.getElementById('countryRow').addEventListener('click', () => openPicker('country'));
document.getElementById('locationRow').addEventListener('click', () => openPicker('location'));
picker.querySelectorAll('[data-picker-close]').forEach(button => button.addEventListener('click', closePicker));
pickerSearch.addEventListener('input', renderPicker);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && picker.classList.contains('is-open')) closePicker();
});

function nearestCity(latitude, longitude) {
  const distance = city => {
    const latDistance = (city.lat - latitude) * Math.PI / 180;
    const lonDistance = (city.lon - longitude) * Math.PI / 180;
    const a = Math.sin(latDistance / 2) ** 2
      + Math.cos(latitude * Math.PI / 180) * Math.cos(city.lat * Math.PI / 180) * Math.sin(lonDistance / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };
  return CITIES.reduce((closest, city) => distance(city) < distance(closest) ? city : closest);
}

const reverseCache = new Map();
let lastReverseRequestAt = 0;

async function reverseGeocode(latitude, longitude) {
  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  if (reverseCache.has(cacheKey)) {
    pickerAttribution.hidden = false;
    return reverseCache.get(cacheKey);
  }

  const rateLimitDelay = Math.max(0, 1000 - (Date.now() - lastReverseRequestAt));
  if (rateLimitDelay) await new Promise(resolve => window.setTimeout(resolve, rateLimitDelay));
  lastReverseRequestAt = Date.now();

  const params = new URLSearchParams({
    format: 'jsonv2', lat: String(latitude), lon: String(longitude),
    zoom: '12', addressdetails: '1', 'accept-language': 'en'
  });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { Accept: 'application/json' }, signal: controller.signal
    });
    if (!response.ok) throw new Error('Reverse geocoding failed');
    const result = await response.json();
    const address = result.address || {};
    const city = address.city || address.town || address.village || address.municipality || address.county;
    const country = address.country;
    const code = address.country_code?.toUpperCase();
    if (!country) throw new Error('Country not found');
    pickerAttribution.hidden = false;
    const location = {
      label: city && city !== country ? `${city}, ${country}` : country,
      code,
      flag: flagFor(code)
    };
    reverseCache.set(cacheKey, location);
    return location;
  } finally {
    window.clearTimeout(timeout);
  }
}

useDeviceLocation.addEventListener('click', () => {
  if (!navigator.geolocation || useDeviceLocation.classList.contains('is-loading')) return;
  useDeviceLocation.classList.add('is-loading');
  useDeviceLocation.disabled = true;
  geoStatus.textContent = 'Determining your location…';

  navigator.geolocation.getCurrentPosition(async position => {
    const { latitude, longitude } = position.coords;
    let location;
    try {
      location = await reverseGeocode(latitude, longitude);
    } catch (error) {
      location = locationOption(nearestCity(latitude, longitude));
    }
    setLocation(location, false);
    geoStatus.textContent = location.label;
    useDeviceLocation.classList.remove('is-loading');
    useDeviceLocation.disabled = false;
    window.setTimeout(closePicker, 550);
  }, error => {
    geoStatus.textContent = error.code === error.PERMISSION_DENIED
      ? 'Location access was denied'
      : 'Could not determine location';
    useDeviceLocation.classList.remove('is-loading');
    useDeviceLocation.disabled = false;
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
});

export { countryByCode, flagFor, openPicker };
