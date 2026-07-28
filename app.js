/* Прототип kolaba: экраны приложения внутри мокапа iPhone. */

const PHOTOS = [3, 4, 5, 6, 7].map(n => `assets/photos/photo-${n}.png`);

const WALL_PHOTO_IDS = [
  12432697, 6763564, 6953586, 26527345, 13022480, 9014229,
  965989, 1667088, 1961792, 3737594, 4041392, 3762879,
  415829, 774909, 733872, 1681010, 220453, 1040881,
  1181686, 1239291, 1516680, 1858175, 2379004, 2709388,
  3225889, 3763188, 3769021, 1758144, 4348401, 445109,
  712513, 762080
];

const WALL_PHOTOS = WALL_PHOTO_IDS.map(id =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=320&h=568`
);

/* ── Масштаб: приложение свёрстано в 402×874, экран мокапа меньше ── */
const viewport = document.getElementById('viewport');

function fit() {
  const screen = viewport.parentElement;
  viewport.style.transform = `scale(${screen.clientWidth / 402})`;
}
new ResizeObserver(fit).observe(viewport.parentElement);
fit();

/* ── Переходы между экранами ── */
function show(name) {
  document.querySelectorAll('.screen-page').forEach(page => {
    page.classList.toggle('is-active', page.dataset.screen === name);
  });
  if (name !== 'profileReels') pauseProfileReels();
  if (name === 'profile') window.requestAnimationFrame(() => {
    layoutTabs();
    layoutProfilePages(profileTabNames.indexOf(activeProfileTab), false);
  });
  if (name === 'projects') window.requestAnimationFrame(() => layoutProjectsTabs());
  if (name === 'feed') window.requestAnimationFrame(resumeActiveFeed);
  else window.requestAnimationFrame(pauseFeed);
}

document.addEventListener('click', event => {
  const go = event.target.closest('[data-go]');
  if (go) {
    if (go.dataset.go === 'profile') openOwnProfile();
    else show(go.dataset.go);
  }

  const back = event.target.closest('[data-back]');
  if (back) show(back.dataset.back);
});

document.getElementById('goStart').addEventListener('click', () => show('start'));

// удобно для показа: #auth, #setup1, #setup2, #profile в адресе открывают нужный экран
const screens = ['start', 'auth', 'setup1', 'setup2', 'projects', 'feed', 'profileReels', 'profile'];
const fromHash = () => {
  const name = location.hash.replace('#', '');
  if (screens.includes(name)) show(name);
};
window.addEventListener('hashchange', fromHash);
fromHash();

/* ── Стена фотографий на Start Page ── */
const wall = document.getElementById('wall');
const speeds = [13, 21, 9, 17, 25, 15];

function shuffled(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapWith]] = [copy[swapWith], copy[index]];
  }
  return copy;
}

for (let column = 0; column < 6; column++) {
  // В каждой колонке — свой случайный набор UGC / fashion / product-снимков.
  const columnPhotos = shuffled(WALL_PHOTOS).slice(0, 12);
  const track = document.createElement('div');
  track.className = 'wall__track';
  // дважды: чтобы лента замыкалась без стыка
  [...columnPhotos, ...columnPhotos].forEach(src => {
    const img = new Image();
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    track.appendChild(img);
  });
  track.style.animationDuration = `${(columnPhotos.length * 207.7) / speeds[column]}s`;

  const col = document.createElement('div');
  col.className = 'wall__col' + (column % 2 ? ' wall__col--down' : '');
  col.appendChild(track);
  wall.appendChild(col);
}

/* ── Sign Up / Log In ── */
const authSwitch = document.getElementById('authSwitch');

authSwitch.addEventListener('click', event => {
  const item = event.target.closest('.segmented__item');
  if (!item) return;

  authSwitch.querySelectorAll('.segmented__item').forEach(button => {
    button.classList.toggle('is-active', button === item);
  });
  authSwitch.classList.toggle('is-second', item.dataset.mode === 'Log In');
  document.querySelectorAll('.js-mode').forEach(node => node.textContent = item.dataset.mode);
});

/* ── Показать пароль ── */
const password = document.getElementById('pwd');
const toggle = document.getElementById('pwdToggle');

toggle.addEventListener('click', () => {
  const shown = password.type === 'text';
  password.type = shown ? 'password' : 'text';
  toggle.firstElementChild.src = shown ? 'assets/icons/IconEyeOff.svg' : 'assets/icons/IconEye.svg';
});

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
let selectedCountryCode = 'ID';
let selectedLocation = { label: 'Bali, Indonesia', code: 'ID' };

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
    const check = document.createElement('span');
    check.className = 'picker__check';
    check.textContent = '✓';
    option.appendChild(check);
  }
  option.addEventListener('click', onSelect);
  return option;
}

function setCountry(country) {
  selectedCountryCode = country.code;
  document.getElementById('countryFlag').textContent = country.flag;
  document.getElementById('countryValue').textContent = country.name;
  closePicker();
}

function setLocation(location, close = true) {
  selectedLocation = location;
  document.getElementById('locationFlag').textContent = location.flag || flagFor(location.code);
  document.getElementById('locationValue').textContent = location.label;
  document.getElementById('locationOutFlag').textContent = location.flag || flagFor(location.code);
  document.getElementById('locationOut').textContent = location.label;
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
        country.code === selectedCountryCode,
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
      location.label === selectedLocation.label,
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

/* ── Шаг 2: фотографии профиля, описание и соцсети ── */
const PROFILE_IMAGE_LIMIT = 10;
const profileImagesEmpty = document.getElementById('profileImagesEmpty');
const profileImagesStrip = document.getElementById('profileImagesStrip');
const profileImagesInput = document.getElementById('profileImagesInput');
const profileImageCount = document.getElementById('profileImageCount');
const profileImagesLimit = document.getElementById('profileImagesLimit');
const profileImages = [];
let profileImageId = 0;
let profileImageLimitTimer;

function openProfileImagePicker() {
  if (profileImages.length < PROFILE_IMAGE_LIMIT) profileImagesInput.click();
}

function showProfileImageLimit() {
  window.clearTimeout(profileImageLimitTimer);
  profileImagesLimit.hidden = false;
  profileImageLimitTimer = window.setTimeout(() => {
    profileImagesLimit.hidden = true;
  }, 3200);
}

function removeProfileImage(id, card) {
  const index = profileImages.findIndex(image => image.id === id);
  if (index < 0 || profileImages[index].processing) return;
  profileImages.splice(index, 1);
  profileImageCount.textContent = profileImages.length;
  card.classList.add('is-removing');
  window.setTimeout(renderProfileImages, 250);
}

function createProfileImageCard(item) {
  const card = document.createElement('div');
  card.className = `profile-image-card${item.processing ? ' is-processing' : ''}`;
  card.dataset.imageId = item.id;

  if (item.processing) {
    const spinner = document.createElement('span');
    spinner.className = 'profile-image-card__spinner';
    spinner.setAttribute('aria-label', 'Processing image');
    card.appendChild(spinner);
    return card;
  }

  const image = new Image();
  image.src = item.src;
  image.alt = 'Profile image';
  card.appendChild(image);

  const remove = document.createElement('button');
  remove.className = 'profile-image-card__remove';
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove image');
  remove.addEventListener('click', () => removeProfileImage(item.id, card));
  card.appendChild(remove);
  return card;
}

function renderProfileImages() {
  profileImageCount.textContent = profileImages.length;
  profileImagesEmpty.hidden = profileImages.length > 0;
  profileImagesStrip.hidden = profileImages.length === 0;
  profileImagesStrip.replaceChildren(...profileImages.map(createProfileImageCard));

  if (profileImages.length < PROFILE_IMAGE_LIMIT && profileImages.length > 0) {
    const add = document.createElement('button');
    add.className = 'profile-images__add';
    add.type = 'button';
    add.innerHTML = '<span aria-hidden="true">+</span><b>Add</b>';
    add.addEventListener('click', openProfileImagePicker);
    profileImagesStrip.appendChild(add);
  }
}

function readProfileImage(file, item) {
  const reader = new FileReader();
  const minimumSpinner = new Promise(resolve => window.setTimeout(resolve, 350));
  const fileReady = new Promise((resolve, reject) => {
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', reject);
    reader.readAsDataURL(file);
  });

  Promise.all([fileReady, minimumSpinner]).then(([src]) => {
    const current = profileImages.find(image => image.id === item.id);
    if (!current) return;
    current.src = src;
    current.processing = false;
    const card = profileImagesStrip.querySelector(`[data-image-id="${item.id}"]`);
    if (card) card.replaceWith(createProfileImageCard(current));
  }).catch(() => {
    const index = profileImages.findIndex(image => image.id === item.id);
    if (index >= 0) profileImages.splice(index, 1);
    renderProfileImages();
  });
}

profileImagesEmpty.addEventListener('click', openProfileImagePicker);
profileImagesInput.addEventListener('change', () => {
  const available = PROFILE_IMAGE_LIMIT - profileImages.length;
  const validFiles = [...profileImagesInput.files].filter(file => file.type.startsWith('image/'));
  const acceptedFiles = validFiles.slice(0, available);
  if (validFiles.length > available) showProfileImageLimit();

  const added = acceptedFiles.map(file => {
    const item = { id: ++profileImageId, src: '', processing: true };
    profileImages.push(item);
    return [file, item];
  });
  renderProfileImages();
  added.forEach(([file, item]) => readProfileImage(file, item));
  profileImagesInput.value = '';
});

renderProfileImages();

const bio = document.getElementById('bio');
const bioCount = document.getElementById('bioCount');

bio.addEventListener('input', () => {
  if (bio.value.length > 300) bio.value = bio.value.slice(0, 300);
  bioCount.textContent = bio.value.length;
});

document.querySelectorAll('.social-row[data-social]').forEach(row => {
  row.addEventListener('click', event => {
    const disconnect = event.target.closest('.social-row__action');
    if (row.classList.contains('is-connected')) {
      if (!disconnect) return;
      row.classList.remove('is-connected');
      row.querySelector('.social-row__value').textContent = 'Connect';
      row.setAttribute('aria-label', `Connect ${row.dataset.social}`);
      return;
    }

    const enteredUsername = document.getElementById('username').value.trim().replace(/^@+/, '');
    row.classList.add('is-connected');
    row.querySelector('.social-row__value').textContent = enteredUsername || row.dataset.fallback;
    row.setAttribute('aria-label', `Disconnect ${row.dataset.social}`);
  });
});

/* ── Данные из формы уезжают в профиль ── */
const username = document.getElementById('username');
const fullname = document.getElementById('fullname');
const profilePage = document.querySelector('.screen-page[data-screen="profile"]');
const profileAvatar = profilePage.querySelector('.avatar img');
let ownProfileSnapshot = null;

function captureOwnProfile() {
  return {
    handle: document.getElementById('handleOut').textContent,
    name: document.getElementById('nameOut').textContent,
    location: document.getElementById('locationOut').textContent,
    locationFlag: document.getElementById('locationOutFlag').textContent,
    avatar: profileAvatar.src
  };
}

function openOwnProfile() {
  if (ownProfileSnapshot) {
    document.getElementById('handleOut').textContent = ownProfileSnapshot.handle;
    document.getElementById('nameOut').textContent = ownProfileSnapshot.name;
    document.getElementById('locationOut').textContent = ownProfileSnapshot.location;
    document.getElementById('locationOutFlag').textContent = ownProfileSnapshot.locationFlag;
    profileAvatar.src = ownProfileSnapshot.avatar;
    ownProfileSnapshot = null;
  }
  profilePage.classList.remove('is-external-profile');
  profilePage.dataset.profileFlag = document.getElementById('locationFlag').textContent;
  show('profile');
}

function openExternalProfile(author) {
  if (!profilePage.classList.contains('is-external-profile')) ownProfileSnapshot = captureOwnProfile();
  const handle = author.name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  document.getElementById('handleOut').textContent = `@${handle}`;
  document.getElementById('nameOut').textContent = author.name;
  document.getElementById('locationOut').textContent = `${author.city}, ${countryByCode(author.countryCode)?.name || author.countryCode}`;
  document.getElementById('locationOutFlag').textContent = flagFor(author.countryCode);
  profileAvatar.src = author.avatarURL;
  profilePage.dataset.profileFlag = flagFor(author.countryCode);
  profilePage.classList.add('is-external-profile');
  document.getElementById('profileScroll').scrollTop = 0;
  show('profile');
}

username.addEventListener('input', () => {
  document.getElementById('handleOut').textContent = username.value || '_devochka228';
});
fullname.addEventListener('input', () => {
  document.getElementById('nameOut').textContent = fullname.value || 'Milka Lisa | UGC Bali';
});
bio.addEventListener('input', () => {
  document.getElementById('bioOut').textContent =
    bio.value || 'UGC creator crafting authentic, high-converting content for modern brands ✨ Open to collaborations worldwide 🌍';
});

/* ── 20 фото и 20 видео Pexels в профиле ── */
const PEXELS_PHOTO_IDS = [
  415829, 774909, 733872, 1681010, 220453,
  1040881, 1181686, 1239291, 1516680, 1858175,
  2379004, 2709388, 3225889, 3763188, 3769021,
  1758144, 4348401, 445109, 712513, 762080
];

const PROFILE_PHOTOS = PEXELS_PHOTO_IDS.map((id, index) => ({
  image: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=480&h=480`,
  fullImage: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200`,
  source: `https://www.pexels.com/photo/${id}/`,
  alt: `Pexels photo ${index + 1}`,
  kind: 'photo'
}));

const PEXELS_VIDEOS = [
  [8423879, 'pexels-photo-8423879.jpeg'],
  [7514462, 'pexels-photo-7514462.jpeg'],
  [4110277, 'pexels-photo-4110277.jpeg'],
  [7482042, 'pexels-photo-7482042.jpeg'],
  [7514467, 'pexels-photo-7514467.jpeg'],
  [4994033, 'pexels-photo-4994033.jpeg'],
  [4361066, 'pexels-photo-4361066.jpeg'],
  [8423931, 'pexels-photo-8423931.jpeg'],
  [6596089, 'pexels-photo-6596089.jpeg'],
  [5544430, 'pexels-photo-5544430.jpeg'],
  [6332245, 'man-video-recording-vlog-vlogger-6332245.jpeg'],
  [13929590, 'adult-beautiful-blond-body-13929590.jpeg'],
  [13929585, 'adult-bag-beautiful-city-13929585.jpeg'],
  [8423876, 'pexels-photo-8423876.jpeg'],
  [4911932, 'amazon-review-artistic-make-up-black-blogger-black-girl-4911932.jpeg'],
  [6347110, 'pexels-photo-6347110.jpeg'],
  [8993409, 'blog-business-call-camera-8993409.jpeg'],
  [6347109, 'pexels-photo-6347109.jpeg'],
  [8371252, 'adolescent-adult-beautiful-beauty-blogger-8371252.jpeg'],
  [6347118, 'pexels-photo-6347118.jpeg']
];

// Один общий набор для плиток профиля и полноэкранного просмотра.
// Используем преимущественно SD-версии, чтобы ролики быстро запускались на телефоне.
const PROFILE_REEL_MEDIA = [
  {
    id: '6377374',
    videoURL: 'https://videos.pexels.com/video-files/6377374/6377374-sd_506_960_30fps.mp4',
    posterURL: 'https://images.pexels.com/photos/12432697/pexels-photo-12432697.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=720&h=1280'
  },
  {
    id: '8363829',
    videoURL: 'https://videos.pexels.com/video-files/8363829/8363829-hd_1080_1920_30fps.mp4',
    posterURL: 'https://images.pexels.com/photos/6763564/pexels-photo-6763564.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=720&h=1280'
  },
  {
    id: '9986239',
    videoURL: 'https://videos.pexels.com/video-files/9986239/9986239-sd_640_338_25fps.mp4',
    posterURL: 'https://images.pexels.com/photos/965989/pexels-photo-965989.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=720&h=1280'
  },
  {
    id: '2848072',
    videoURL: 'https://videos.pexels.com/video-files/2848072/2848072-sd_640_360_30fps.mp4',
    posterURL: 'https://images.pexels.com/photos/4041392/pexels-photo-4041392.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=720&h=1280'
  },
  {
    id: '7802455',
    videoURL: 'https://videos.pexels.com/video-files/7802455/7802455-sd_640_338_25fps.mp4',
    posterURL: 'https://images.pexels.com/photos/3762879/pexels-photo-3762879.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=720&h=1280'
  }
];

const compactMetric = number => number >= 1000
  ? `${(number / 1000).toFixed(number >= 10000 ? 0 : 1).replace('.0', '')}k`
  : String(number);

function updateVideoProgress(element, video) {
  if (!element || !video) return;
  const progress = Number.isFinite(video.duration) && video.duration > 0
    ? Math.max(0, Math.min(1, video.currentTime / video.duration))
    : 0;
  element.style.transform = `scaleX(${progress})`;
}

function mediaStats(index, kind) {
  const seed = kind === 'video' ? 1709 : 941;
  return {
    views: compactMetric(((index + 3) * seed) % 23800 + 120),
    likes: compactMetric(((index + 5) * (seed % 173)) % 2300 + 18)
  };
}

const mediaViewer = document.getElementById('mediaViewer');
const mediaViewerImage = document.getElementById('mediaViewerImage');
const mediaViewerBackdrop = document.getElementById('mediaViewerBackdrop');
let viewerClearTimer;
let viewerPhotoIndex = 0;
let viewerPointerStart = null;

function showViewerPhoto(index) {
  viewerPhotoIndex = (index + PROFILE_PHOTOS.length) % PROFILE_PHOTOS.length;
  const photo = PROFILE_PHOTOS[viewerPhotoIndex];
  mediaViewerImage.src = photo.fullImage || photo.image;
  mediaViewerImage.alt = photo.alt;
}

function openPhoto(index) {
  window.clearTimeout(viewerClearTimer);
  showViewerPhoto(index);
  mediaViewer.classList.add('is-open');
  mediaViewer.setAttribute('aria-hidden', 'false');
}

function closePhoto() {
  mediaViewer.classList.remove('is-open');
  mediaViewer.setAttribute('aria-hidden', 'true');
  viewerClearTimer = window.setTimeout(() => {
    mediaViewerImage.src = '';
    mediaViewerImage.alt = '';
  }, 240);
}

mediaViewerBackdrop.addEventListener('click', closePhoto);
mediaViewerImage.addEventListener('pointerdown', event => {
  viewerPointerStart = event.clientX;
  mediaViewerImage.setPointerCapture?.(event.pointerId);
});
mediaViewerImage.addEventListener('pointerup', event => {
  if (viewerPointerStart === null) return;
  const distance = event.clientX - viewerPointerStart;
  viewerPointerStart = null;
  if (Math.abs(distance) < 42) return;
  showViewerPhoto(viewerPhotoIndex + (distance < 0 ? 1 : -1));
});
mediaViewerImage.addEventListener('pointercancel', () => { viewerPointerStart = null; });
document.addEventListener('keydown', event => {
  if (!mediaViewer.classList.contains('is-open')) return;
  if (event.key === 'Escape') closePhoto();
  if (event.key === 'ArrowLeft') showViewerPhoto(viewerPhotoIndex - 1);
  if (event.key === 'ArrowRight') showViewerPhoto(viewerPhotoIndex + 1);
});

function appendMediaCard(container, { image, fullImage, source, kind }, index) {
  const stats = mediaStats(index, kind);
  const figure = document.createElement('figure');
  const interactive = document.createElement('button');
  const alt = kind === 'video' ? `Pexels video ${index + 1}` : `Pexels photo ${index + 1}`;

  if (kind === 'video') {
    interactive.type = 'button';
    interactive.setAttribute('aria-label', `Open profile video ${index + 1}`);
    interactive.addEventListener('click', () => openProfileReels(index % 5));
  } else {
    interactive.type = 'button';
    interactive.setAttribute('aria-label', `Open photo ${index + 1}`);
    interactive.addEventListener('click', () => openPhoto(index));
  }

  const preview = new Image();
  preview.src = image;
  preview.alt = alt;
  preview.loading = 'lazy';
  preview.referrerPolicy = 'no-referrer';
  interactive.appendChild(preview);

  const caption = document.createElement('figcaption');
  caption.innerHTML = `
    <span><img src="assets/icons/IconEye.svg" alt="">${stats.views}</span>
    <span>♥ ${stats.likes}</span>`;
  interactive.appendChild(caption);
  figure.appendChild(interactive);
  container.appendChild(figure);
}

const grid = document.getElementById('grid');
PROFILE_PHOTOS.forEach((photo, index) => appendMediaCard(grid, photo, index));

const videoGrid = document.getElementById('videoGrid');
PROFILE_REEL_MEDIA.forEach((clip, index) => appendMediaCard(videoGrid, {
  image: clip.posterURL,
  kind: 'video'
}, index));

/* ── Вкладки Video / Photos ── */
const tabs = document.getElementById('tabs');
const tabsLine = document.getElementById('tabsLine');
const pager = document.getElementById('pager');
const profileTabNames = ['video', 'photos'];
let activeProfileTab = 'video';
let profilePagerGesture = null;
let profilePagerLastSwipe = 0;

function layoutTabs(progress = profileTabNames.indexOf(activeProfileTab)) {
  const buttons = [...tabs.querySelectorAll('.tabs__item')];
  const lowerIndex = Math.max(0, Math.min(buttons.length - 1, Math.floor(progress)));
  const upperIndex = Math.max(0, Math.min(buttons.length - 1, Math.ceil(progress)));
  const amount = Math.max(0, Math.min(1, progress - lowerIndex));
  const lower = buttons[lowerIndex];
  const upper = buttons[upperIndex];
  if (!lower || !upper) return;
  tabsLine.style.width = `${lower.offsetWidth + (upper.offsetWidth - lower.offsetWidth) * amount}px`;
  tabsLine.style.transform = `translateX(${lower.offsetLeft + (upper.offsetLeft - lower.offsetLeft) * amount}px)`;
}

function layoutProfilePages(progress = profileTabNames.indexOf(activeProfileTab), animated = true) {
  const pages = [...pager.querySelectorAll('.pager__page')];
  pages.forEach((page, index) => {
    page.style.transition = animated ? '' : 'none';
    page.style.transform = `translate3d(${(index - progress) * 100}%,0,0)`;
  });
  const targetIndex = Math.max(0, Math.min(pages.length - 1, Math.round(progress)));
  const targetPage = pages[targetIndex];
  if (targetPage) pager.style.height = `${targetPage.scrollHeight}px`;
}

function setProfileTab(tab) {
  if (!profileTabNames.includes(tab)) return;
  activeProfileTab = tab;
  pager.querySelectorAll('.pager__page').forEach(page => {
    page.classList.toggle('is-active', page.dataset.page === tab);
  });
  tabs.querySelectorAll('.tabs__item').forEach(button => button.classList.toggle('is-active', button.dataset.tab === tab));
  tabsLine.style.transition = '';
  layoutProfilePages(profileTabNames.indexOf(tab), true);
  layoutTabs();
}

tabs.addEventListener('click', event => {
  const item = event.target.closest('.tabs__item');
  if (item) setProfileTab(item.dataset.tab);
});

pager.addEventListener('pointerdown', event => {
  profilePagerGesture = { x: event.clientX, y: event.clientY };
});
pager.addEventListener('pointermove', event => {
  if (!profilePagerGesture) return;
  const dx = event.clientX - profilePagerGesture.x;
  const dy = event.clientY - profilePagerGesture.y;
  if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 8) return;
  const progress = Math.max(0, Math.min(1, profileTabNames.indexOf(activeProfileTab) - dx / 402));
  tabsLine.style.transition = 'none';
  layoutTabs(progress);
  layoutProfilePages(progress, false);
});
pager.addEventListener('pointerup', event => {
  if (!profilePagerGesture) return;
  const dx = event.clientX - profilePagerGesture.x;
  const dy = event.clientY - profilePagerGesture.y;
  profilePagerGesture = null;
  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
    profilePagerLastSwipe = Date.now();
    const direction = dx < 0 ? 1 : -1;
    setProfileTab(profileTabNames[Math.max(0, Math.min(1, profileTabNames.indexOf(activeProfileTab) + direction))]);
  } else {
    tabsLine.style.transition = '';
    layoutTabs();
    layoutProfilePages(profileTabNames.indexOf(activeProfileTab), true);
  }
});
pager.addEventListener('pointercancel', () => {
  profilePagerGesture = null;
  tabsLine.style.transition = '';
  layoutTabs();
  layoutProfilePages(profileTabNames.indexOf(activeProfileTab), true);
});
pager.addEventListener('click', event => {
  if (Date.now() - profilePagerLastSwipe < 350) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

window.addEventListener('resize', () => {
  layoutTabs();
  layoutProfilePages(profileTabNames.indexOf(activeProfileTab), false);
});
window.addEventListener('load', () => {
  layoutTabs();
  layoutProfilePages(profileTabNames.indexOf(activeProfileTab), false);
});
window.requestAnimationFrame(() => layoutProfilePages(0, false));

/* ── Projects: локальная лента вымышленных заказов ── */
const PROJECT_AUTHORS = [
  ['Amelia Carter', 'amelia.creates', 'Lisbon, Portugal', 'women/44'],
  ['Noah Williams', 'noahvisuals', 'London, United Kingdom', 'men/32'],
  ['Sofia Laurent', 'sofiaugc', 'Paris, France', 'women/65'],
  ['Luca Moretti', 'luca.frames', 'Milan, Italy', 'men/52'],
  ['Maya Thompson', 'mayamakes', 'New York, USA', 'women/26'],
  ['Elias Becker', 'elias.studio', 'Berlin, Germany', 'men/41'],
  ['Nora Jensen', 'nordicnora', 'Copenhagen, Denmark', 'women/12'],
  ['Leo van Dijk', 'leovandijk', 'Amsterdam, Netherlands', 'men/75'],
  ['Ines Martins', 'inesonfilm', 'Porto, Portugal', 'women/29'],
  ['Adam Kowalski', 'adam.social', 'Warsaw, Poland', 'men/22'],
  ['Lina Haddad', 'linacreates', 'Dubai, UAE', 'women/79'],
  ['Mateo Silva', 'mateo.content', 'Barcelona, Spain', 'men/11'],
  ['Hana Kim', 'hanamotion', 'Seoul, South Korea', 'women/49'],
  ['Oscar Lind', 'oscarugc', 'Stockholm, Sweden', 'men/85'],
  ['Emma Wilson', 'emmadebrief', 'Sydney, Australia', 'women/33'],
  ['Samira Noor', 'samira.noor', 'Marrakesh, Morocco', 'women/8']
];
const PROJECT_COUNTRY_CODES = {
  Portugal: 'PT', 'United Kingdom': 'GB', France: 'FR', Italy: 'IT', USA: 'US',
  Germany: 'DE', Denmark: 'DK', Netherlands: 'NL', Poland: 'PL', UAE: 'AE',
  Spain: 'ES', 'South Korea': 'KR', Sweden: 'SE', Australia: 'AU', Morocco: 'MA'
};
const PROJECT_AUTHOR_PROFILES = PROJECT_AUTHORS.map(([name, handle, location, portrait]) => ({
  name, handle: `@${handle}`, location,
  countryCode: PROJECT_COUNTRY_CODES[location.split(', ').at(-1)] || '',
  avatar: `https://randomuser.me/api/portraits/${portrait}.jpg`
}));

const PROJECT_TEXTS = [
  'Looking for a UGC model for a fun and creative shoot at our villa 🌴☀️\nWe’re creating content for social media campaigns, so you should feel natural in front of the camera.\n📅 Flexible dates\n💵 Paid opportunity',
  'Skincare creator wanted for a clean morning-routine video ✨🧴\nWe will send the full product set and a simple brief. Natural light and an authentic voice are a must.\n🎬 3 short vertical videos',
  'Launching a new matcha brand and looking for creators who love cozy lifestyle content 🍵💚\nShow us your favorite slow-morning ritual. Paid collaboration plus a product box.',
  'Fashion label seeking two creators for a street-style campaign in the city 🧥📸\nConfident movement, bold styling and a playful personality. Styling and moodboard provided.',
  'Need a travel creator to capture a boutique hotel weekend 🌊🏨\nDeliverables: room tour, breakfast reel and 5 lifestyle photos. Stay and travel budget included.',
  'We’re filming a playful fitness app launch and need energetic on-camera talent 🏃‍♀️⚡️\nOne half-day studio shoot. No professional sports background required.',
  'Coffee shop looking for a local creator to tell our story ☕️🤎\nWe want warm, candid content featuring the people, pastries and atmosphere of our space.',
  'Seeking a pet creator for a new sustainable accessories collection 🐕🌿\nYour dog should be comfortable outdoors and around a small production team.',
  'Minimal homeware campaign — looking for creators with bright, calm interiors 🕯️🏡\nFilm a natural unboxing and one styling transformation. Products are yours to keep.',
  'Beauty studio needs a model and creator for a soft-glam tutorial 💄✨\nWe provide the artist, studio and full creative direction. Paid usage for three months.',
  'Looking for a foodie creator to cover our new seasonal menu 🍝🍋\nBring your own point of view — honest reactions and charming detail shots are welcome.',
  'Join our summer eyewear launch in a rooftop studio 🕶️🌇\nWe’re after relaxed, premium-looking reels with a little humor. Half-day paid shoot.'
];

const PROJECT_MEDIA_IDS = [
  12432697, 6763564, 6953586, 26527345, 13022480, 9014229,
  965989, 1667088, 1961792, 3737594, 4041392, 3762879,
  415829, 774909, 733872, 1681010, 220453, 1040881,
  1181686, 1239291, 1516680, 1858175, 2379004, 2709388
];
const PROJECT_MEDIA = PROJECT_MEDIA_IDS.map((id, index) => ({
  preview: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=240&h=250`,
  isVideo: index % 4 === 2,
  duration: ['0:15', '0:22', '0:09', '0:18'][index % 4]
}));

let projectSequence = 0;
function makeProject(index, options = {}) {
  const author = options.isMine
    ? { name: 'Milka Lisa', handle: '_devochka228', location: ['Bali, Indonesia', 'Jakarta, Indonesia', 'Ubud, Indonesia'][index % 3], countryCode: 'ID', avatar: 'assets/photos/photo-4.png' }
    : PROJECT_AUTHOR_PROFILES[index % PROJECT_AUTHOR_PROFILES.length];
  const posted = new Date(Date.now() - (Math.floor(Math.random() * 14 * 24 * 60) * 60000));
  const date = posted.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = posted.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return {
    id: `project-${Date.now()}-${projectSequence++}`,
    author,
    postedAt: `${date}, ${time}`,
    location: author.location,
    text: PROJECT_TEXTS[index % PROJECT_TEXTS.length],
    media: shuffled(PROJECT_MEDIA).slice(0, 3 + Math.floor(Math.random() * 4)),
    responses: Math.floor(Math.random() * 41),
    views: Math.floor(Math.random() * 4991) + 10,
    isSaved: Boolean(options.isSaved),
    isMine: Boolean(options.isMine)
  };
}

const projectAuthorOrder = shuffled([...Array(PROJECT_AUTHOR_PROFILES.length).keys()]);
let projects = [...Array(15)].map((_, index) => makeProject(projectAuthorOrder[index], {
  isMine: index < 3,
  isSaved: [4, 8, 12].includes(index)
}));
projects = shuffled(projects);

const projectsScreen = document.querySelector('[data-screen="projects"]');
const projectsTabs = document.getElementById('projectsTabs');
const projectsTabsLine = document.getElementById('projectsTabsLine');
const projectsPager = document.getElementById('projectsPager');
const projectsSearch = document.getElementById('projectsSearch');
const projectsSearchInput = document.getElementById('projectsSearchInput');
const projectsOverlay = document.getElementById('projectsOverlay');
const projectsSheet = document.getElementById('projectsSheet');
const projectDetail = document.getElementById('projectDetail');
const projectsRefresh = document.getElementById('projectsRefresh');
const projectTabNames = ['all', 'mine', 'saved'];
const projectScrollPositions = { all: 0, mine: 0, saved: 0 };
let activeProjectTab = 'all';

function layoutProjectsTabs(progress = projectTabNames.indexOf(activeProjectTab)) {
  if (!projectsTabs || !projectsTabsLine) return;
  const buttons = [...projectsTabs.querySelectorAll('[data-project-tab]')];
  const lowerIndex = Math.max(0, Math.min(buttons.length - 1, Math.floor(progress)));
  const upperIndex = Math.max(0, Math.min(buttons.length - 1, Math.ceil(progress)));
  const amount = Math.max(0, Math.min(1, progress - lowerIndex));
  const lower = buttons[lowerIndex];
  const upper = buttons[upperIndex];
  const left = lower.offsetLeft + (upper.offsetLeft - lower.offsetLeft) * amount;
  const width = lower.offsetWidth + (upper.offsetWidth - lower.offsetWidth) * amount;
  projectsTabsLine.style.width = `${width}px`;
  projectsTabsLine.style.transform = `translateX(${left}px)`;
}

function layoutProjectPages(progress = projectTabNames.indexOf(activeProjectTab), animated = true) {
  const pages = [...projectsPager.querySelectorAll('[data-project-page]')];
  pages.forEach((page, index) => {
    page.style.transition = animated ? '' : 'none';
    page.style.transform = `translateX(${(index - progress) * 100}%)`;
  });
}

function projectCardMarkup(project) {
  const attachments = project.media.map(media => `
    <button class="project-attachment" type="button" aria-label="${media.isVideo ? 'Video' : 'Photo'} attachment">
      <img src="${media.preview}" alt="" loading="lazy" decoding="async">
      ${media.isVideo ? `<span class="project-video-play"><img src="assets/icons/ProjectPlay.svg" alt=""></span><span class="project-duration">${media.duration}</span>` : ''}
    </button>`).join('');
  return `
    <article class="project-card" data-project-id="${project.id}">
      <div class="project-author">
        <img class="project-author__avatar" src="${project.author.avatar}" alt="${project.author.name}" loading="lazy">
        <div class="project-author__identity"><b>${project.author.name}</b><span class="project-author__location"><i aria-hidden="true">${flagFor(project.author.countryCode) || '🌍'}</i>${project.location}</span></div>
        <time class="project-author__date">${project.postedAt}</time>
        <button class="project-more" type="button" data-project-menu aria-label="Project actions"><img src="assets/icons/ThreeDots.svg" alt=""></button>
      </div>
      <p class="project-description">${project.text}</p>
      <div class="project-media">${attachments}</div>
      <div class="project-divider"></div>
      <div class="project-footer">
        <div class="project-metrics">
          <span class="project-metric"><img src="assets/icons/ProjectUser.svg" alt=""><span>${project.responses}</span></span>
          <span class="project-metric"><img src="assets/icons/ProjectEye.svg" alt=""><span>${compactMetric(project.views)}</span></span>
        </div>
        <button class="project-save${project.isSaved ? ' is-saved' : ''}" type="button" aria-label="${project.isSaved ? 'Remove from saved' : 'Save project'}">
          <img src="assets/icons/${project.isSaved ? 'ProjectBookmarkFilled' : 'ProjectBookmark'}.svg" alt="">
        </button>
        <button class="project-view" type="button">View <span>›</span></button>
      </div>
    </article>`;
}

function matchingProjects(tab) {
  const query = projectsSearchInput.value.trim().toLocaleLowerCase();
  return projects.filter(project => {
    if (tab === 'mine' && !project.isMine) return false;
    if (tab === 'saved' && !project.isSaved) return false;
    return !query || `${project.text} ${project.location} ${project.author.name} ${project.author.handle}`.toLocaleLowerCase().includes(query);
  });
}

function renderProjects() {
  projectTabNames.forEach(tab => {
    const list = document.getElementById(`projects${tab[0].toUpperCase()}${tab.slice(1)}`);
    const filtered = matchingProjects(tab);
    if (!filtered.length) {
      const label = tab === 'saved' && !projectsSearchInput.value ? 'Nothing saved yet' : 'No projects found';
      list.innerHTML = `<div class="projects-empty"><img src="assets/icons/ProjectBookmark.svg" alt=""><span>${label}</span></div>`;
    } else {
      list.innerHTML = filtered.map(projectCardMarkup).join('');
      list.querySelectorAll('.project-author__avatar').forEach(image => image.addEventListener('error', () => { image.src = 'assets/photos/photo-4.png'; }, { once: true }));
    }
  });
}

function setProjectsTab(tab) {
  if (!projectTabNames.includes(tab)) return;
  const currentPage = projectsPager.querySelector(`[data-project-page="${activeProjectTab}"]`);
  if (currentPage) projectScrollPositions[activeProjectTab] = currentPage.scrollTop;
  activeProjectTab = tab;
  projectsTabs.querySelectorAll('[data-project-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.projectTab === tab));
  projectsPager.querySelectorAll('[data-project-page]').forEach(page => page.classList.toggle('is-active', page.dataset.projectPage === tab));
  const nextPage = projectsPager.querySelector(`[data-project-page="${tab}"]`);
  if (nextPage) nextPage.scrollTop = projectScrollPositions[tab];
  projectsTabsLine.style.transition = '';
  layoutProjectPages(projectTabNames.indexOf(tab), true);
  layoutProjectsTabs();
}

projectsTabs.addEventListener('click', event => {
  const button = event.target.closest('[data-project-tab]');
  if (button) setProjectsTab(button.dataset.projectTab);
});

function openProjectsSheet(content) {
  projectsSheet.innerHTML = content;
  projectsOverlay.classList.add('is-open');
  projectsOverlay.setAttribute('aria-hidden', 'false');
}
function closeProjectsSheet() {
  projectsOverlay.classList.remove('is-open');
  projectsOverlay.setAttribute('aria-hidden', 'true');
}
projectsOverlay.addEventListener('click', event => {
  if (event.target.closest('[data-project-overlay-close], .projects-sheet__close, [data-project-action]')) closeProjectsSheet();
});

document.getElementById('newProjectButton').addEventListener('click', () => openProjectsSheet(`
  <h3 class="projects-sheet__title">New project</h3>
  <p class="projects-sheet__copy">Coming soon</p>
  <button class="projects-sheet__close" type="button">Close</button>`));

document.getElementById('projectsSearchButton').addEventListener('click', () => {
  projectsSearch.hidden = false;
  projectsScreen.classList.add('is-searching');
  projectsSearchInput.focus();
});
document.getElementById('projectsSearchClose').addEventListener('click', () => {
  projectsSearchInput.value = '';
  projectsSearch.hidden = true;
  projectsScreen.classList.remove('is-searching');
  renderProjects();
});
projectsSearchInput.addEventListener('input', renderProjects);

projectsPager.addEventListener('click', event => {
  const card = event.target.closest('.project-card');
  if (!card) return;
  const project = projects.find(item => item.id === card.dataset.projectId);
  if (!project) return;
  const save = event.target.closest('.project-save');
  if (save) {
    project.isSaved = !project.isSaved;
    save.classList.add('is-bouncing');
    window.setTimeout(renderProjects, 180);
    return;
  }
  if (event.target.closest('[data-project-menu]')) {
    openProjectsSheet(`
      <button type="button" data-project-action="share">Share</button>
      <button type="button" data-project-action="report">Report</button>
      <button type="button" data-project-action="hide">Hide</button>
      <button class="projects-sheet__close" type="button">Cancel</button>`);
    return;
  }
  const description = event.target.closest('.project-description');
  if (description) {
    description.classList.toggle('is-expanded');
    return;
  }
  if (event.target.closest('.project-view')) {
    projectDetail.classList.add('is-open');
    projectDetail.setAttribute('aria-hidden', 'false');
  }
});
document.getElementById('projectDetailBack').addEventListener('click', () => {
  projectDetail.classList.remove('is-open');
  projectDetail.setAttribute('aria-hidden', 'true');
});

let projectGesture = null;
projectsPager.addEventListener('pointerdown', event => {
  if (event.target.closest('.project-media, button, input')) return;
  const page = event.target.closest('.projects-page');
  projectGesture = { x: event.clientX, y: event.clientY, page, pulling: Boolean(page && page.scrollTop <= 0) };
});
projectsPager.addEventListener('pointermove', event => {
  if (!projectGesture) return;
  const dx = event.clientX - projectGesture.x;
  const dy = event.clientY - projectGesture.y;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
    const index = projectTabNames.indexOf(activeProjectTab);
    const progress = Math.max(0, Math.min(2, index - dx / 402));
    projectsTabsLine.style.transition = 'none';
    layoutProjectsTabs(progress);
    layoutProjectPages(progress, false);
  } else if (projectGesture.pulling && dy > 14) {
    projectsRefresh.classList.add('is-visible');
    projectsRefresh.querySelector('span').textContent = dy > 62 ? 'Release to refresh' : 'Pull to refresh';
  }
});
projectsPager.addEventListener('pointerup', event => {
  if (!projectGesture) return;
  const dx = event.clientX - projectGesture.x;
  const dy = event.clientY - projectGesture.y;
  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
    const direction = dx < 0 ? 1 : -1;
    setProjectsTab(projectTabNames[Math.max(0, Math.min(2, projectTabNames.indexOf(activeProjectTab) + direction))]);
  } else {
    projectsTabsLine.style.transition = '';
    layoutProjectPages(projectTabNames.indexOf(activeProjectTab), true);
    layoutProjectsTabs();
  }
  if (projectGesture.pulling && dy > 62 && Math.abs(dy) > Math.abs(dx)) {
    projectsRefresh.classList.add('is-loading', 'is-visible');
    projectsRefresh.querySelector('span').textContent = 'Refreshing…';
    window.setTimeout(() => {
      const extraCount = 3 + Math.floor(Math.random() * 3);
      const extras = [...Array(extraCount)].map((_, index) => makeProject(Math.floor(Math.random() * PROJECT_AUTHOR_PROFILES.length) + index));
      projects = [...extras, ...projects];
      renderProjects();
      projectsRefresh.classList.remove('is-loading', 'is-visible');
    }, 650);
  } else {
    projectsRefresh.classList.remove('is-visible');
  }
  projectGesture = null;
});
projectsPager.addEventListener('pointercancel', () => {
  projectGesture = null;
  projectsRefresh.classList.remove('is-visible');
  projectsTabsLine.style.transition = '';
  layoutProjectPages(projectTabNames.indexOf(activeProjectTab), true);
  layoutProjectsTabs();
});

window.addEventListener('resize', () => layoutProjectsTabs());
renderProjects();

/* ── Полноэкранная вертикальная лента видео ── */
const FEED_CATALOG = [
  ['6377374', 'https://videos.pexels.com/video-files/6377374/6377374-sd_506_960_30fps.mp4'],
  ['8363829', 'https://videos.pexels.com/video-files/8363829/8363829-hd_1080_1920_30fps.mp4'],
  ['6060027', 'https://videos.pexels.com/video-files/6060027/6060027-uhd_2160_3840_25fps.mp4'],
  ['7141501', 'https://videos.pexels.com/video-files/7141501/7141501-uhd_2160_4096_30fps.mp4'],
  ['3298011', 'https://videos.pexels.com/video-files/3298011/3298011-uhd_2160_4096_25fps.mp4'],
  ['9986239', 'https://videos.pexels.com/video-files/9986239/9986239-sd_640_338_25fps.mp4'],
  ['3196600', 'https://videos.pexels.com/video-files/3196600/3196600-hd_1280_720_25fps.mp4'],
  ['3173312', 'https://videos.pexels.com/video-files/3173312/3173312-hd_1280_720_30fps.mp4'],
  ['1409899', 'https://videos.pexels.com/video-files/1409899/1409899-hd_1280_720_25fps.mp4'],
  ['2848072', 'https://videos.pexels.com/video-files/2848072/2848072-sd_640_360_30fps.mp4'],
  ['7802455', 'https://videos.pexels.com/video-files/7802455/7802455-sd_640_338_25fps.mp4'],
  ['2818546', 'https://videos.pexels.com/video-files/2818546/2818546-sd_640_360_24fps.mp4'],
  ['3765952', 'https://videos.pexels.com/video-files/3765952/3765952-sd_640_360_24fps.mp4'],
  ['5595130', 'https://videos.pexels.com/video-files/5595130/5595130-sd_640_360_30fps.mp4'],
  ['7481859', 'https://videos.pexels.com/video-files/7481859/7481859-sd_640_338_25fps.mp4'],
  ['4431695', 'https://videos.pexels.com/video-files/4431695/4431695-hd_1920_1080_30fps.mp4'],
  ['2397239', 'https://videos.pexels.com/video-files/2397239/2397239-sd_960_506_24fps.mp4'],
  ['14952031', 'https://videos.pexels.com/video-files/14952031/14952031-sd_960_540_30fps.mp4'],
  ['4540332', 'https://videos.pexels.com/video-files/4540332/4540332-hd_1920_1080_25fps.mp4']
].map(([id, videoURL], index) => ({
  id,
  videoURL,
  posterURL: `https://images.pexels.com/photos/${WALL_PHOTO_IDS[index % WALL_PHOTO_IDS.length]}/pexels-photo-${WALL_PHOTO_IDS[index % WALL_PHOTO_IDS.length]}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=720&h=1280`
}));

/* ── Горизонтальная лента роликов, открываемая из профиля ── */
const profileReelStage = document.getElementById('profileReelStage');
const profileReelClips = document.getElementById('profileReelClips');
const profileReelPosition = document.getElementById('profileReelPosition');
const profileReelLike = document.getElementById('profileReelLike');
const profileReelMenu = document.getElementById('profileReelMenu');
const profileReelProgress = document.getElementById('profileReelProgress');
const profileReelData = PROFILE_REEL_MEDIA.map((video, index) => ({
  ...video,
  likes: Math.floor(Math.random() * 14951) + 50,
  views: Math.floor(Math.random() * 119801) + 200,
  liked: false,
  viewedSession: false,
  index
}));
let profileReelIndex = 0;
let profileReelFollowing = false;
let profileReelExpanded = false;
let profileReelLastGesture = 0;

function pauseProfileReels() {
  window.clearTimeout(window.__profileReelViewTimer);
  document.querySelectorAll('#profileReelClips video').forEach(video => video.pause());
}

function renderProfileReelPosition(progress = profileReelIndex) {
  if (profileReelPosition.children.length !== 5) {
    profileReelPosition.replaceChildren();
    for (let index = 0; index < 5; index++) profileReelPosition.appendChild(document.createElement('i'));
  }
  [...profileReelPosition.children].forEach((segment, index) => {
    const influence = Math.max(0, 1 - Math.abs(progress - index));
    segment.style.width = `${12 + 16 * influence}px`;
    segment.style.backgroundColor = `rgba(255, 255, 255, ${.35 + .65 * influence})`;
  });
}

function updateProfileReelOverlay() {
  const clip = profileReelData[profileReelIndex];
  profileReelLike.classList.toggle('is-liked', clip.liked);
  profileReelLike.querySelector('b').textContent = compactMetric(clip.likes);
  document.getElementById('profileReelViews').textContent = compactMetric(clip.views);
}

function ensureProfileReelMedia(index) {
  profileReelClips.querySelectorAll('video').forEach((video, videoIndex) => {
    video.preload = videoIndex === index ? 'auto' : 'metadata';
    if (!video.hasAttribute('src')) {
      video.src = video.dataset.src;
      video.load();
    }
  });
}

function scheduleProfileReelView(video, index) {
  window.clearTimeout(window.__profileReelViewTimer);
  const clip = profileReelData[index];
  if (clip.viewedSession) return;
  window.__profileReelViewTimer = window.setTimeout(() => {
    if (profileReelIndex !== index || video.paused || !document.querySelector('[data-screen="profileReels"]')?.classList.contains('is-active')) return;
    clip.viewedSession = true;
    clip.views += 1;
    updateProfileReelOverlay();
  }, 1000);
}

function playProfileReel(reset = false) {
  const video = profileReelClips.querySelectorAll('video')[profileReelIndex];
  if (!video) return;
  if (reset && Number.isFinite(video.duration)) video.currentTime = 0;
  video.play().catch(() => {});
  profileReelStage.classList.remove('is-paused');
  scheduleProfileReelView(video, profileReelIndex);
}

function activateProfileReel(index, reset = true) {
  const nextIndex = Math.max(0, Math.min(4, index));
  const previousVideo = profileReelClips.querySelectorAll('video')[profileReelIndex];
  if (previousVideo && profileReelIndex !== nextIndex) {
    previousVideo.pause();
    if (Number.isFinite(previousVideo.duration)) previousVideo.currentTime = 0;
  }
  profileReelIndex = nextIndex;
  profileReelClips.style.transform = `translateX(${-nextIndex * 100}%)`;
  ensureProfileReelMedia(nextIndex);
  updateProfileReelOverlay();
  updateVideoProgress(profileReelProgress, profileReelClips.querySelectorAll('video')[nextIndex]);
  renderProfileReelPosition(nextIndex);
  playProfileReel(reset);
}

function closeProfileReels() {
  pauseProfileReels();
  profileReelStage.style.transform = '';
  profileReelStage.style.opacity = '';
  show('profile');
}

function openProfileReels(index = 0) {
  const currentAvatar = profileAvatar.src;
  document.getElementById('profileReelAvatar').src = currentAvatar;
  document.querySelector('[data-screen="profileReels"] .tabbar__avatar img').src = currentAvatar;
  document.getElementById('profileReelName').textContent = document.getElementById('nameOut').textContent;
  document.getElementById('profileReelLocation').textContent = document.getElementById('locationOut').textContent;
  document.getElementById('profileReelFlag').textContent = profilePage.dataset.profileFlag || document.getElementById('locationFlag').textContent || '🌍';
  document.getElementById('profileReelCaption').textContent = document.getElementById('bioOut').textContent;
  profileReelExpanded = false;
  document.getElementById('profileReelCaption').classList.remove('is-expanded');
  show('profileReels');
  activateProfileReel(index, true);
}

profileReelClips.innerHTML = profileReelData.map(clip => `
  <div class="profile-reel-clip" data-reel-index="${clip.index}">
    <video class="feed-video" muted loop playsinline preload="none" data-src="${clip.videoURL}"></video>
    <span class="feed-loading" aria-hidden="true"></span>
  </div>`).join('');

profileReelClips.querySelectorAll('video').forEach((video, index) => {
  const page = video.closest('.profile-reel-clip');
  video.addEventListener('loadeddata', () => page.classList.add('is-ready'));
  video.addEventListener('playing', () => {
    if (index === profileReelIndex) scheduleProfileReelView(video, index);
  });
  video.addEventListener('timeupdate', () => {
    if (index === profileReelIndex) updateVideoProgress(profileReelProgress, video);
  });
  video.addEventListener('error', () => page.classList.add('is-ready', 'is-video-error'));
});

profileReelLike.addEventListener('click', () => {
  const clip = profileReelData[profileReelIndex];
  clip.liked = !clip.liked;
  clip.likes += clip.liked ? 1 : -1;
  updateProfileReelOverlay();
  profileReelLike.classList.remove('is-bouncing');
  void profileReelLike.offsetWidth;
  profileReelLike.classList.add('is-bouncing');
});

document.getElementById('profileReelFollow').addEventListener('click', event => {
  profileReelFollowing = !profileReelFollowing;
  event.currentTarget.classList.toggle('is-following', profileReelFollowing);
});

document.getElementById('profileReelCaption').addEventListener('click', event => {
  event.stopPropagation();
  profileReelExpanded = !profileReelExpanded;
  event.currentTarget.classList.toggle('is-expanded', profileReelExpanded);
});

document.getElementById('profileReelMore').addEventListener('click', () => {
  profileReelMenu.classList.add('is-open');
  profileReelMenu.setAttribute('aria-hidden', 'false');
});
profileReelMenu.querySelectorAll('[data-profile-reel-menu-close]').forEach(button => button.addEventListener('click', () => {
  profileReelMenu.classList.remove('is-open');
  profileReelMenu.setAttribute('aria-hidden', 'true');
}));
profileReelMenu.querySelector('.feed-menu__sheet').addEventListener('click', event => {
  if (event.target.closest('button')) {
    profileReelMenu.classList.remove('is-open');
    profileReelMenu.setAttribute('aria-hidden', 'true');
  }
});
document.querySelectorAll('[data-profile-reels-close]').forEach(button => button.addEventListener('click', closeProfileReels));

const profileReelGesture = { pointerId: null, axis: null, startX: 0, startY: 0, deltaX: 0, deltaY: 0 };
profileReelStage.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.target.closest('button')) return;
  profileReelGesture.pointerId = event.pointerId;
  profileReelGesture.axis = null;
  profileReelGesture.startX = event.clientX;
  profileReelGesture.startY = event.clientY;
  profileReelGesture.deltaX = 0;
  profileReelGesture.deltaY = 0;
  profileReelStage.setPointerCapture?.(event.pointerId);
});
profileReelStage.addEventListener('pointermove', event => {
  if (event.pointerId !== profileReelGesture.pointerId) return;
  const deltaX = event.clientX - profileReelGesture.startX;
  const deltaY = event.clientY - profileReelGesture.startY;
  if (!profileReelGesture.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 6) {
    profileReelGesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
    profileReelClips.classList.toggle('is-dragging', profileReelGesture.axis === 'horizontal');
    pauseProfileReels();
  }
  if (!profileReelGesture.axis) return;
  event.preventDefault();
  profileReelLastGesture = performance.now();
  profileReelGesture.deltaX = deltaX;
  profileReelGesture.deltaY = deltaY;
  if (profileReelGesture.axis === 'horizontal') {
    const width = profileReelStage.clientWidth;
    const offset = Math.max(-4 * width, Math.min(0, -profileReelIndex * width + deltaX));
    profileReelClips.style.transform = `translateX(${offset}px)`;
    renderProfileReelPosition(-offset / (width || 1));
  } else {
    profileReelStage.style.transform = `translateY(${deltaY}px)`;
    profileReelStage.style.opacity = String(Math.max(.45, 1 - Math.abs(deltaY) / 420));
  }
});

function finishProfileReelGesture(event) {
  if (event.pointerId !== profileReelGesture.pointerId) return;
  const { axis, deltaX, deltaY } = profileReelGesture;
  profileReelGesture.pointerId = null;
  profileReelGesture.axis = null;
  profileReelClips.classList.remove('is-dragging');
  if (axis === 'vertical' && Math.abs(deltaY) >= 70) {
    closeProfileReels();
    return;
  }
  profileReelStage.style.transform = '';
  profileReelStage.style.opacity = '';
  if (axis === 'horizontal') {
    activateProfileReel(profileReelIndex + (Math.abs(deltaX) >= 50 ? (deltaX < 0 ? 1 : -1) : 0), true);
  } else {
    playProfileReel(false);
  }
}
profileReelStage.addEventListener('pointerup', finishProfileReelGesture);
profileReelStage.addEventListener('pointercancel', finishProfileReelGesture);

let profileReelTapTimer;
profileReelStage.addEventListener('click', event => {
  if (event.target.closest('button') || performance.now() - profileReelLastGesture < 220) return;
  const video = profileReelClips.querySelectorAll('video')[profileReelIndex];
  if (event.detail >= 2) {
    window.clearTimeout(profileReelTapTimer);
    const clip = profileReelData[profileReelIndex];
    if (!clip.liked) {
      clip.liked = true;
      clip.likes += 1;
      updateProfileReelOverlay();
    }
    const heart = document.getElementById('profileReelHeart');
    heart.classList.remove('is-visible');
    void heart.offsetWidth;
    heart.classList.add('is-visible');
    return;
  }
  profileReelTapTimer = window.setTimeout(() => {
    if (video.paused) {
      video.play().catch(() => {});
      profileReelStage.classList.remove('is-paused');
    } else {
      video.pause();
      profileReelStage.classList.add('is-paused');
    }
  }, 230);
});

renderProfileReelPosition(0);

const FALLBACK_AUTHORS = [
  ['Milka Lisa', 'women/44', 'UA', 'Kharkiv'], ['Sofia Martin', 'women/32', 'ES', 'Barcelona'],
  ['Maya Wilson', 'women/68', 'US', 'Los Angeles'], ['Lina Moreau', 'women/47', 'FR', 'Paris'],
  ['Amara Okafor', 'women/65', 'NG', 'Lagos'], ['Emma de Vries', 'women/28', 'NL', 'Amsterdam'],
  ['Yuna Kim', 'women/57', 'KR', 'Seoul'], ['Chiara Rossi', 'women/23', 'IT', 'Milan'],
  ['Nora Fischer', 'women/11', 'DE', 'Berlin'], ['Aisha Khan', 'women/79', 'GB', 'London'],
  ['Lucas Silva', 'men/32', 'BR', 'São Paulo'], ['Noah Dubois', 'men/45', 'FR', 'Nice'],
  ['Mateo García', 'men/52', 'ES', 'Madrid'], ['Ethan Brooks', 'men/22', 'US', 'New York'],
  ['Leo Janssens', 'men/36', 'BE', 'Brussels'], ['Oliver Chen', 'men/51', 'SG', 'Singapore'],
  ['Aya Tanaka', 'women/50', 'JP', 'Tokyo'], ['Zara Ahmed', 'women/71', 'AE', 'Dubai'],
  ['Ana Costa', 'women/15', 'PT', 'Lisbon'], ['Freya Larsen', 'women/36', 'DK', 'Copenhagen'],
  ['Elena Popescu', 'women/52', 'RO', 'Bucharest'], ['Mila Novak', 'women/8', 'CZ', 'Prague'],
  ['Liam Taylor', 'men/15', 'AU', 'Sydney'], ['Adam Nowak', 'men/61', 'PL', 'Warsaw']
].map(([name, portrait, countryCode, city]) => ({
  name,
  avatarURL: `https://randomuser.me/api/portraits/${portrait}.jpg`,
  countryCode,
  city
}));

const FEED_CAPTIONS = [
  'White castle in Chiang Mai. My first UGC travel video — still obsessed with this light ✨',
  'Morning routine shot for a skincare brand. Natural light makes every detail feel honest.',
  'Behind the scenes from yesterday’s fashion shoot. Three outfits, one tiny studio, endless ideas.',
  'Testing a new beauty concept with soft textures and a clean editorial mood.',
  'A quick city story created entirely on my phone. Simple, fast and made for social.',
  'Golden hour, a great outfit and ten minutes to capture the whole campaign.',
  'Product close-ups that feel tactile, warm and genuinely part of everyday life.',
  'Come with me while I turn a quiet morning into a lifestyle campaign.',
  'Travel content should make you feel the place before you even arrive.',
  'New reel for a local café — warm tones, movement and a little bit of chaos.',
  'Creating an authentic unboxing without making it feel like an ad.',
  'Today’s challenge: one location, one look and five completely different hooks.',
  'Beauty UGC with real skin, soft daylight and no heavy filters.',
  'A tiny behind-the-scenes look at how I plan and shoot a brand story.',
  'Street style in motion. Shot handheld to keep the energy spontaneous.',
  'Slow morning, good coffee and a new campaign coming together frame by frame.',
  'Trying a more cinematic approach for this everyday lifestyle product.',
  'From moodboard to final shot — this is the part of creating I love most.',
  'A weekend travel diary made for vertical screens and short attention spans.',
  'The best branded content still feels like a recommendation from a friend.'
];

const feed = document.getElementById('feed');
const feedPosition = document.getElementById('feedPosition');
const feedMenu = document.getElementById('feedMenu');
const FEED_CLIPS_PER_PROFILE = 5;
const feedProfiles = [];
let activeFeedIndex = 0;
let feedProfileSequence = 0;
let feedViewTimer;

function makeFeedClip(video, profileIndex, clipIndex) {
  return {
    id: `clip-${profileIndex}-${clipIndex}-${video.id}`,
    ...video,
    likes: Math.floor(Math.random() * 14951) + 50,
    views: Math.floor(Math.random() * 119801) + 200,
    liked: false,
    paused: false,
    viewedSession: false
  };
}

function makeFeedProfile(author, caption) {
  const profileIndex = feedProfileSequence++;
  const videos = shuffled(FEED_CATALOG).slice(0, FEED_CLIPS_PER_PROFILE);
  return {
    id: `feed-profile-${profileIndex}`,
    author,
    caption,
    clips: videos.map((video, clipIndex) => makeFeedClip(video, profileIndex, clipIndex)),
    activeClipIndex: 0,
    following: false,
    expanded: false,
    scrollEndTimer: null,
    lastScrollAt: 0,
    lastGestureAt: 0,
    isDragging: false
  };
}

function updateFeedAuthor(card, profile) {
  const { author } = profile;
  const avatar = card.querySelector('.feed-avatar');
  avatar.src = author.avatarURL;
  avatar.alt = author.name;
  card.querySelector('.feed-avatar-button').setAttribute('aria-label', `Open ${author.name} profile`);
  card.querySelector('.feed-author b').textContent = author.name;
  card.querySelector('.feed-flag').textContent = flagFor(author.countryCode);
  card.querySelector('.feed-city').textContent = `${author.city}, ${countryByCode(author.countryCode)?.name || author.countryCode}`;
}

function renderFeedPosition(progress = 0) {
  if (feedPosition.children.length !== FEED_CLIPS_PER_PROFILE) {
    feedPosition.replaceChildren();
    for (let index = 0; index < FEED_CLIPS_PER_PROFILE; index++) feedPosition.appendChild(document.createElement('i'));
  }

  [...feedPosition.children].forEach((segment, index) => {
    const influence = Math.max(0, 1 - Math.abs(progress - index));
    segment.style.width = `${12 + 16 * influence}px`;
    segment.style.backgroundColor = `rgba(255, 255, 255, ${.35 + .65 * influence})`;
  });
}

function updateFeedClipOverlay(profile, card, clipIndex = profile.activeClipIndex) {
  const clip = profile.clips[clipIndex];
  const button = card.querySelector('.feed-like');
  button.classList.toggle('is-liked', clip.liked);
  button.querySelector('b').textContent = compactMetric(clip.likes);
  card.querySelector('.feed-views span').textContent = compactMetric(clip.views);
}

function setFeedLiked(profile, card, liked, burst = false) {
  const clip = profile.clips[profile.activeClipIndex];
  if (clip.liked === liked && !burst) return;
  if (clip.liked !== liked) clip.likes += liked ? 1 : -1;
  clip.liked = liked;
  updateFeedClipOverlay(profile, card);
  const button = card.querySelector('.feed-like');
  button.classList.remove('is-bouncing');
  void button.offsetWidth;
  button.classList.add('is-bouncing');
  if (burst) {
    const heart = card.querySelector('.feed-heart-burst');
    heart.classList.remove('is-visible');
    void heart.offsetWidth;
    heart.classList.add('is-visible');
  }
}

function scheduleFeedView(profile, card, clipIndex, video) {
  window.clearTimeout(feedViewTimer);
  const clip = profile.clips[clipIndex];
  if (clip.viewedSession) return;
  feedViewTimer = window.setTimeout(() => {
    const isCurrentProfile = feedProfiles[activeFeedIndex] === profile;
    if (!isCurrentProfile || profile.activeClipIndex !== clipIndex || video.paused) return;
    clip.viewedSession = true;
    clip.views += 1;
    updateFeedClipOverlay(profile, card);
  }, 1000);
}

function pauseCardVideos(card, reset = false) {
  if (!card) return;
  card.querySelectorAll('.feed-video').forEach(video => {
    video.pause();
    if (reset && Number.isFinite(video.duration)) video.currentTime = 0;
  });
}

function ensureFeedMedia(profileIndex, clipIndex) {
  feed.querySelectorAll('.feed-card').forEach((card, cardIndex) => {
    card.querySelectorAll('.feed-video').forEach((video, videoIndex) => {
      const shouldKeep = cardIndex === profileIndex && Math.abs(videoIndex - clipIndex) <= 1;
      const clip = card.querySelectorAll('.feed-clip')[videoIndex];
      if (shouldKeep && !video.src) {
        video.src = video.dataset.src;
        video.preload = videoIndex === clipIndex ? 'auto' : 'metadata';
        video.load();
      } else if (!shouldKeep && video.src) {
        video.pause();
        video.removeAttribute('src');
        video.preload = 'none';
        video.load();
        clip.classList.remove('is-ready');
      }
    });
  });
}

function playActiveFeedClip(profile, card, reset = false) {
  const video = card.querySelectorAll('.feed-video')[profile.activeClipIndex];
  const clip = profile.clips[profile.activeClipIndex];
  if (!document.querySelector('[data-screen="feed"]')?.classList.contains('is-active') || clip.paused) return;
  if (reset && Number.isFinite(video.duration)) video.currentTime = 0;
  video.play().catch(() => {});
  scheduleFeedView(profile, card, profile.activeClipIndex, video);
}

function activateFeedClip(profile, card, nextIndex) {
  const clipIndex = Math.max(0, Math.min(FEED_CLIPS_PER_PROFILE - 1, nextIndex));
  const previousIndex = profile.activeClipIndex;
  if (previousIndex !== clipIndex) {
    const previousVideo = card.querySelectorAll('.feed-video')[previousIndex];
    previousVideo.pause();
    if (Number.isFinite(previousVideo.duration)) previousVideo.currentTime = 0;
  }
  window.clearTimeout(feedViewTimer);
  profile.activeClipIndex = clipIndex;
  updateFeedClipOverlay(profile, card);
  renderFeedPosition(clipIndex);
  ensureFeedMedia(activeFeedIndex, clipIndex);
  updateVideoProgress(card.querySelector('.feed-progress i'), card.querySelectorAll('.feed-video')[clipIndex]);
  card.classList.toggle('is-paused', profile.clips[clipIndex].paused);
  playActiveFeedClip(profile, card, previousIndex !== clipIndex);
}

function settleHorizontalFeed(profile, card) {
  window.clearTimeout(profile.scrollEndTimer);
  profile.scrollEndTimer = null;
  const scroller = card.querySelector('.feed-clips');
  const width = scroller.clientWidth || 1;
  const nextIndex = Math.round(scroller.scrollLeft / width);
  scroller.scrollTo({ left: nextIndex * width, behavior: 'smooth' });
  activateFeedClip(profile, card, nextIndex);
}

function createFeedCard(profile) {
  const card = document.createElement('article');
  card.className = 'feed-card';
  card.dataset.feedId = profile.id;
  const clips = profile.clips.map((clip, index) => `
    <div class="feed-clip" data-clip-index="${index}">
      <video class="feed-video" muted loop playsinline preload="none" data-src="${clip.videoURL}"></video>
      <span class="feed-loading" aria-hidden="true"></span>
    </div>`).join('');
  card.innerHTML = `
    <div class="feed-clips" aria-label="${FEED_CLIPS_PER_PROFILE} videos by ${profile.author.name}">${clips}</div>
    <span class="feed-play-indicator" aria-hidden="true"></span>
    <span class="feed-heart-burst" aria-hidden="true"></span>
    <div class="feed-progress" aria-hidden="true"><i></i></div>
    <div class="feed-content">
      <div class="feed-author-row">
        <button class="feed-avatar-button" type="button" aria-label="Open ${profile.author.name} profile">
          <img class="feed-avatar" src="${profile.author.avatarURL}" alt="${profile.author.name}">
        </button>
        <div class="feed-author">
          <b>${profile.author.name}</b>
          <span class="feed-place"><span class="feed-flag">${flagFor(profile.author.countryCode)}</span><span class="feed-city">${profile.author.city}, ${countryByCode(profile.author.countryCode)?.name || profile.author.countryCode}</span></span>
        </div>
        <div class="feed-actions">
          <button class="feed-like glass" type="button" aria-label="Like"><span class="feed-like__icon"></span><b>${compactMetric(profile.clips[0].likes)}</b></button>
          <button class="feed-follow" type="button" aria-label="Follow"><img src="assets/icons/FeedPlus.svg" alt=""><span class="feed-follow__check">✓</span></button>
        </div>
      </div>
      <p class="feed-caption">${profile.caption}</p>
      <div class="feed-bottom-row">
        <button class="feed-views glass" type="button" aria-label="Views"><img src="assets/icons/FeedEye.svg" alt=""><span>${compactMetric(profile.clips[0].views)}</span></button>
        <button class="feed-more glass" type="button" aria-label="More actions"><img src="assets/icons/ThreeDots.svg" alt=""></button>
      </div>
    </div>`;

  card.querySelectorAll('.feed-video').forEach((video, clipIndex) => {
    const clipPage = video.closest('.feed-clip');
    video.addEventListener('loadeddata', () => clipPage.classList.add('is-ready'));
    video.addEventListener('playing', () => {
      if (profile.activeClipIndex === clipIndex) {
        card.classList.remove('is-paused');
        scheduleFeedView(profile, card, clipIndex, video);
      }
    });
    video.addEventListener('timeupdate', () => {
      if (profile.activeClipIndex === clipIndex) updateVideoProgress(card.querySelector('.feed-progress i'), video);
    });
    video.addEventListener('error', () => clipPage.classList.add('is-ready', 'is-video-error'));
  });

  const scroller = card.querySelector('.feed-clips');
  scroller.addEventListener('scroll', () => {
    profile.lastScrollAt = performance.now();
    window.clearTimeout(feedViewTimer);
    pauseCardVideos(card);
    if (feedProfiles[activeFeedIndex] === profile) {
      renderFeedPosition(scroller.scrollLeft / (scroller.clientWidth || 1));
    }
    if (profile.isDragging) return;
    window.clearTimeout(profile.scrollEndTimer);
    profile.scrollEndTimer = window.setTimeout(() => settleHorizontalFeed(profile, card), 110);
  }, { passive: true });
  scroller.addEventListener('scrollend', () => {
    if (!profile.isDragging) settleHorizontalFeed(profile, card);
  });

  const gesture = { pointerId: null, axis: null, startX: 0, startY: 0, scrollX: 0, scrollY: 0 };
  card.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.target.closest('button')) return;
    gesture.pointerId = event.pointerId;
    gesture.axis = null;
    gesture.startX = event.clientX;
    gesture.startY = event.clientY;
    gesture.scrollX = scroller.scrollLeft;
    gesture.scrollY = feed.scrollTop;
    profile.isDragging = true;
    card.setPointerCapture?.(event.pointerId);
  });
  card.addEventListener('pointermove', event => {
    if (event.pointerId !== gesture.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 6) {
      gesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
      scroller.classList.toggle('is-dragging', gesture.axis === 'horizontal');
    }
    if (!gesture.axis) return;
    event.preventDefault();
    profile.lastGestureAt = performance.now();
    if (gesture.axis === 'horizontal') {
      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      scroller.scrollLeft = Math.max(0, Math.min(maxScroll, gesture.scrollX - deltaX));
    } else {
      const maxScroll = feed.scrollHeight - feed.clientHeight;
      feed.scrollTop = Math.max(0, Math.min(maxScroll, gesture.scrollY - deltaY));
    }
  });

  const finishGesture = event => {
    if (event.pointerId !== gesture.pointerId) return;
    const axis = gesture.axis;
    gesture.pointerId = null;
    gesture.axis = null;
    profile.isDragging = false;
    scroller.classList.remove('is-dragging');
    if (axis === 'horizontal') {
      settleHorizontalFeed(profile, card);
    } else if (axis === 'vertical') {
      const cardHeight = card.clientHeight || 874;
      const targetIndex = Math.max(0, Math.min(feedProfiles.length - 1, Math.round(feed.scrollTop / cardHeight)));
      feed.scrollTo({ top: targetIndex * cardHeight, behavior: 'smooth' });
    }
  };
  card.addEventListener('pointerup', finishGesture);
  card.addEventListener('pointercancel', finishGesture);

  card.querySelector('.feed-avatar').addEventListener('error', event => {
    event.currentTarget.src = 'assets/photos/photo-4.png';
  }, { once: true });

  card.querySelector('.feed-avatar-button').addEventListener('click', event => {
    event.stopPropagation();
    openExternalProfile(profile.author);
  });

  card.querySelector('.feed-like').addEventListener('click', () => {
    const clip = profile.clips[profile.activeClipIndex];
    setFeedLiked(profile, card, !clip.liked);
  });

  card.querySelector('.feed-follow').addEventListener('click', event => {
    profile.following = !profile.following;
    event.currentTarget.classList.toggle('is-following', profile.following);
    event.currentTarget.setAttribute('aria-label', profile.following ? 'Following' : 'Follow');
  });

  card.querySelector('.feed-caption').addEventListener('click', event => {
    event.stopPropagation();
    profile.expanded = !profile.expanded;
    event.currentTarget.classList.toggle('is-expanded', profile.expanded);
  });

  card.querySelector('.feed-more').addEventListener('click', () => {
    feedMenu.classList.add('is-open');
    feedMenu.setAttribute('aria-hidden', 'false');
  });

  let singleTapTimer;
  card.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    if (performance.now() - Math.max(profile.lastScrollAt, profile.lastGestureAt) < 220) return;
    const video = card.querySelectorAll('.feed-video')[profile.activeClipIndex];
    const clip = profile.clips[profile.activeClipIndex];
    if (event.detail >= 2) {
      window.clearTimeout(singleTapTimer);
      setFeedLiked(profile, card, true, true);
      return;
    }
    singleTapTimer = window.setTimeout(() => {
      if (video.paused) {
        clip.paused = false;
        video.play().catch(() => {});
        card.classList.remove('is-paused');
      } else {
        clip.paused = true;
        video.pause();
        card.classList.add('is-paused');
      }
    }, 230);
  });

  return card;
}

function appendFeedBatch(amount = 10) {
  const authors = shuffled(FALLBACK_AUTHORS);
  const captions = shuffled(FEED_CAPTIONS);
  let previousAuthor = feedProfiles.at(-1)?.author.name;

  for (let index = 0; index < amount; index++) {
    let author = authors[index % authors.length];
    if (author.name === previousAuthor) author = authors[(index + 1) % authors.length];
    previousAuthor = author.name;
    const profile = makeFeedProfile(author, captions[index % captions.length]);
    feedProfiles.push(profile);
    const card = createFeedCard(profile);
    feed.appendChild(card);
    feedObserver.observe(card);
  }
  renderFeedPosition(feedProfiles[activeFeedIndex]?.activeClipIndex || 0);
}

function activateFeedIndex(index) {
  if (index < 0 || index >= feedProfiles.length) return;
  const changedProfile = index !== activeFeedIndex;
  const previousProfile = feedProfiles[activeFeedIndex];
  if (changedProfile && previousProfile) {
    previousProfile.expanded = false;
    const previousCard = feed.querySelector(`[data-feed-id="${previousProfile.id}"]`);
    previousCard?.querySelector('.feed-caption')?.classList.remove('is-expanded');
    pauseCardVideos(previousCard, true);
  }

  activeFeedIndex = index;
  const profile = feedProfiles[index];
  const card = feed.querySelector(`[data-feed-id="${profile.id}"]`);
  if (changedProfile) {
    profile.activeClipIndex = 0;
    profile.expanded = false;
    card.querySelector('.feed-caption').classList.remove('is-expanded');
    card.querySelector('.feed-clips').scrollTo({ left: 0, behavior: 'auto' });
  }
  ensureFeedMedia(index, profile.activeClipIndex);
  updateFeedClipOverlay(profile, card);
  updateVideoProgress(card.querySelector('.feed-progress i'), card.querySelectorAll('.feed-video')[profile.activeClipIndex]);
  renderFeedPosition(profile.activeClipIndex);

  feed.querySelectorAll('.feed-card').forEach((card, cardIndex) => {
    if (cardIndex !== index) pauseCardVideos(card, true);
  });
  playActiveFeedClip(profile, card, changedProfile);

  if (index >= feedProfiles.length - 3) appendFeedBatch(10);
}

const feedObserver = new IntersectionObserver(entries => {
  const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible || visible.intersectionRatio < .65) return;
  const cards = [...feed.querySelectorAll('.feed-card')];
  activateFeedIndex(cards.indexOf(visible.target));
}, { root: feed, threshold: [.65, .8, 1] });

function pauseFeed() {
  if (!feed) return;
  window.clearTimeout(feedViewTimer);
  feed.querySelectorAll('video').forEach(video => video.pause());
}

function resumeActiveFeed() {
  if (!feed || !feedProfiles.length) return;
  activateFeedIndex(activeFeedIndex);
}

function closeFeedMenu() {
  feedMenu.classList.remove('is-open');
  feedMenu.setAttribute('aria-hidden', 'true');
}

feedMenu.querySelectorAll('[data-feed-menu-close]').forEach(button => button.addEventListener('click', closeFeedMenu));
feedMenu.querySelector('.feed-menu__sheet').addEventListener('click', event => {
  if (event.target.closest('button')) closeFeedMenu();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseFeed();
  else if (document.querySelector('[data-screen="feed"]')?.classList.contains('is-active')) resumeActiveFeed();
});

appendFeedBatch(20);

// Random User дополняет статический каталог; при ошибке уже отрисованные fallback-авторы остаются.
fetch('https://randomuser.me/api/?results=30&inc=name,picture,nat,location')
  .then(response => response.ok ? response.json() : Promise.reject(new Error('Random User unavailable')))
  .then(data => {
    const authors = data.results.map(person => ({
      name: `${person.name.first} ${person.name.last}`,
      avatarURL: person.picture.large,
      countryCode: person.nat,
      city: person.location.city
    }));
    if (!authors.length) return;
    feedProfiles.slice(0, 20).forEach((profile, index) => {
      profile.author = authors[index % authors.length];
      const card = feed.querySelector(`[data-feed-id="${profile.id}"]`);
      if (card) updateFeedAuthor(card, profile);
    });
  })
  .catch(() => {});
