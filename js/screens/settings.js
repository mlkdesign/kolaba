/* Настройки */
import { show } from '../core/router.js';
import { state } from '../core/state.js';
import { openOwnProfile, syncOwnProfilePhotos } from '../screens/profile.js';
import { PROFILE_IMAGE_LIMIT, openProfileImagePicker, profileImages, removeProfileImage, renderProfileImages } from '../screens/setup.js';
import { pageScrollTop, scrollPageTo } from '../ui/page-scroll.js';
import { countryByCode, flagFor, openPicker } from '../ui/picker.js';

/* Settings: persistent prototype state, grouped list and lightweight subpages. */

const settingsScreen = document.getElementById('settingsScreen');
const settingsMain = document.getElementById('settingsMain');
const settingsSubpage = document.getElementById('settingsSubpage');
const settingsScroll = document.getElementById('settingsScroll');
const settingsTitle = document.getElementById('settingsTitle');
const settingsDialog = document.getElementById('settingsDialog');
const settingsDialogCard = document.getElementById('settingsDialogCard');
const settingsToast = document.getElementById('settingsToast');
const SETTINGS_KEY = 'kolaba.settings.v1';

const SETTINGS_DEFAULTS = {
  email: 'placeholder@mail.com', phone: '+7 *** ** 99', language: 'English',
  profileName: '', profileUsername: '', profileBio: '',
  profileVisibility: 'Public', messagePolicy: 'Everyone', showLocation: true,
  showProfileViews: true, autoplay: true, startWithSound: false, dataSaver: false,
  haptics: true, sounds: true, dndEnabled: false, dndFrom: '22:00', dndTo: '08:00',
  isPro: false, linkedGoogle: true, linkedApple: false, cache: '128 MB', twoFactor: false,
  nationalityCode: 'ID', location: { label: 'Bali, Indonesia', code: 'ID' }, blocked: [],
  notifications: {
    newProposals: true, newMessages: true, likes: true, newFollowers: true,
    projectMatches: true, productUpdates: true
  },
  socials: { telegram: true, whatsapp: false, instagram: false }
};

function loadSettingsState() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      ...SETTINGS_DEFAULTS, ...saved,
      notifications: { ...SETTINGS_DEFAULTS.notifications, ...(saved.notifications || {}) },
      socials: { ...SETTINGS_DEFAULTS.socials, ...(saved.socials || {}) }
    };
  } catch (error) {
    return structuredClone(SETTINGS_DEFAULTS);
  }
}

let settingsState = loadSettingsState();
let settingsSaveTimer;
let settingsMainScrollTop = 0;
let settingsDialogConfirm = null;
let settingsToastTimer;
let settingsEdgeGesture = null;

function persistSettingsNow() {
  window.clearTimeout(settingsSaveTimer);
  settingsState.nationalityCode = state.selectedCountryCode;
  settingsState.location = { ...state.selectedLocation };
  settingsState.isPro = Boolean(state.isProjectsPro);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsState)); } catch (error) {}
}

function scheduleSettingsSave() {
  window.clearTimeout(settingsSaveTimer);
  settingsSaveTimer = window.setTimeout(persistSettingsNow, 500);
}

function settingsEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function settingsIcon() {
  return '';
}

function settingsRow({ label, value = '', icon = 'settings', action = '', toggle = '', hint = '', danger = false, chevron = true }) {
  const tag = action ? 'button' : toggle ? 'label' : 'div';
  const attrs = action ? ` type="button" data-settings-action="${action}"` : '';
  const side = toggle
    ? `<span class="settings-row__side"><span class="settings-switch"><input type="checkbox" data-settings-toggle="${toggle}"${settingsState[toggle] ? ' checked' : ''}><i></i></span></span>`
    : `<span class="settings-row__side">${value !== '' ? `<span class="settings-row__value">${settingsEscape(value)}</span>` : ''}${action && chevron ? '<img class="settings-row__chevron" src="assets/icons/IconChevron.svg" alt="">' : ''}</span>`;
  return `<${tag} class="settings-row${hint ? ' is-tall' : ''}${danger ? ' is-danger' : ''}"${attrs}>${settingsIcon(icon)}<span class="settings-row__copy"><span class="settings-row__label">${settingsEscape(label)}</span>${hint ? `<span class="settings-row__hint">${settingsEscape(hint)}</span>` : ''}</span>${side}</${tag}>`;
}

function settingsSection(title, rows, value = '') {
  const content = Array.isArray(rows) ? rows.join('') : rows;
  return `<section class="settings-section"><div class="settings-section__head"><span>${settingsEscape(title)}</span>${value ? `<em>${settingsEscape(value)}</em>` : ''}</div><div class="settings-rows">${content}</div></section>`;
}

function connectedSocialCount() {
  return Object.values(settingsState.socials).filter(Boolean).length;
}

function enabledNotificationCount() {
  return Object.values(settingsState.notifications).filter(Boolean).length;
}

function shortBio() {
  const value = document.getElementById('bioOut').textContent.trim();
  return value.length > 24 ? `${value.slice(0, 23).trim()}…` : value;
}

function renderSettingsMain(preserveScroll = false) {
  const previous = preserveScroll ? pageScrollTop() : 0;
  settingsState.isPro = Boolean(state.isProjectsPro);
  const name = document.getElementById('nameOut').textContent;
  const rawHandle = document.getElementById('handleOut').textContent.replace(/^@/, '');
  const nationality = countryByCode(state.selectedCountryCode) || countryByCode('ID');
  const proRows = [
    settingsRow({ label: 'Subscription', value: settingsState.isPro ? 'Pro' : 'Free', icon: 'lock', action: 'subscription' }),
    settingsRow({ label: 'Restore purchases', icon: 'lock', action: 'restore', chevron: false })
  ];
  if (settingsState.isPro) {
    proRows.push(settingsRow({ label: 'Manage subscription', value: 'Yearly · renews 1 Apr', icon: 'lock', action: 'manage-pro' }));
    proRows.push(settingsRow({ label: 'Cancel subscription', icon: 'lock', action: 'cancel-pro', danger: true, chevron: false }));
  }
  settingsMain.innerHTML = `
    <section class="settings-section settings-images-section">
      <div class="settings-section__head"><span>Profile images</span><em id="settingsImageCount">${profileImages.length} / 10</em></div>
      <div class="settings-images"><div class="settings-images__strip" id="settingsImagesStrip"></div></div>
    </section>
    ${settingsSection('Profile', [
      settingsRow({ label: 'Name', value: name, icon: 'user', action: 'name' }),
      settingsRow({ label: 'Username', value: `@${rawHandle}`, icon: 'user', action: 'username' }),
      settingsRow({ label: 'Bio', value: shortBio(), icon: 'image', action: 'bio' }),
      settingsRow({ label: 'Nationality', value: `${nationality.flag} ${nationality.name}`, icon: 'location', action: 'nationality' }),
      settingsRow({ label: 'Current location', value: state.selectedLocation.label, icon: 'location', action: 'current-location' }),
      settingsRow({ label: 'Social media', value: `${connectedSocialCount()} connected`, icon: 'social', action: 'socials' })
    ])}
    ${settingsSection('Account', [
      settingsRow({ label: 'Email', value: settingsState.email, icon: 'mail', chevron: false }),
      settingsRow({ label: 'Phone number', value: settingsState.phone, icon: 'mail', action: 'phone' }),
      settingsRow({ label: 'Password & Security', icon: 'key', action: 'security' }),
      settingsRow({ label: 'Linked accounts', value: `Google ${settingsState.linkedGoogle ? '✓' : '–'} / Apple ${settingsState.linkedApple ? '✓' : '–'}`, icon: 'social', action: 'linked' })
    ])}
    ${settingsSection('Kolaba Pro', proRows.join(''))}
    ${settingsSection('Content', [
      settingsRow({ label: 'Autoplay videos', icon: 'play', toggle: 'autoplay' }),
      settingsRow({ label: 'Start with sound', icon: 'play', toggle: 'startWithSound' }),
      settingsRow({ label: 'Data saver', hint: 'Load videos in lower quality on cellular', icon: 'play', toggle: 'dataSaver' })
    ])}
    ${settingsSection('Notifications', [
      settingsRow({ label: 'Notifications', value: `${enabledNotificationCount()} enabled`, icon: 'bell', action: 'notifications' }),
      settingsRow({ label: 'Sounds', icon: 'bell', toggle: 'sounds' }),
      settingsRow({ label: 'Do not disturb', value: settingsState.dndEnabled ? `${settingsState.dndFrom} – ${settingsState.dndTo}` : 'Off', icon: 'bell', action: 'dnd' })
    ])}
    ${settingsSection('Privacy', [
      settingsRow({ label: 'Profile visibility', value: settingsState.profileVisibility, icon: 'eye', action: 'visibility' }),
      settingsRow({ label: 'Show location on profile', icon: 'location', toggle: 'showLocation' }),
      settingsRow({ label: 'Who can message you', value: settingsState.messagePolicy, icon: 'mail', action: 'message-policy' }),
      settingsRow({ label: 'Show profile views', hint: 'Others see that you viewed their profile', icon: 'eye', toggle: 'showProfileViews' }),
      settingsRow({ label: 'Blocked accounts', value: String(settingsState.blocked.length), icon: 'user', action: 'blocked' })
    ])}
    ${settingsSection('App', [
      settingsRow({ label: 'Language', value: settingsState.language, icon: 'app', action: 'language' }),
      settingsRow({ label: 'Appearance', value: 'Dark', hint: 'Light theme is coming soon', icon: 'app', chevron: false }),
      settingsRow({ label: 'Haptics', icon: 'app', toggle: 'haptics' }),
      settingsRow({ label: 'Clear cache', value: settingsState.cache, icon: 'settings', action: 'clear-cache', chevron: false })
    ])}
    ${settingsSection('Support', [
      settingsRow({ label: 'Help center', icon: 'settings', action: 'help' }),
      settingsRow({ label: 'Contact us', icon: 'mail', action: 'contact' }),
      settingsRow({ label: 'Rate kolaba', icon: 'bookmark', action: 'rate' }),
      settingsRow({ label: 'Share kolaba', icon: 'social', action: 'share', chevron: false })
    ])}
    ${settingsSection('About', [
      settingsRow({ label: 'Privacy Policy', icon: 'lock', action: 'privacy-policy' }),
      settingsRow({ label: 'Terms and Conditions', icon: 'lock', action: 'terms' }),
      settingsRow({ label: 'Licenses', icon: 'settings', action: 'licenses' }),
      settingsRow({ label: 'Version', value: '1.0 (1)', icon: 'settings', chevron: false })
    ])}
    <div class="settings-bottom"><button type="button" data-settings-action="logout">Log out</button><button type="button" data-settings-action="delete-account">Delete account</button></div>`;
  renderSettingsProfileImages();
  scrollPageTo(previous, 'auto');
}

function setSettingsImageAsAvatar(id) {
  const index = profileImages.findIndex(image => image.id === id && !image.processing);
  if (index <= 0) return;
  const [item] = profileImages.splice(index, 1);
  profileImages.unshift(item);
  renderProfileImages();
  syncOwnProfilePhotos();
  showSettingsToast('Profile picture updated');
}

function openSettingsImageMenu(id) {
  openSettingsDialog({
    title: 'Profile image', text: 'Use this photo as your profile picture?',
    confirmLabel: 'Set as avatar', onConfirm: () => setSettingsImageAsAvatar(id)
  });
}

function renderSettingsProfileImages() {
  const strip = document.getElementById('settingsImagesStrip');
  const count = document.getElementById('settingsImageCount');
  if (!strip || !count) return;
  count.textContent = `${profileImages.length} / 10`;
  strip.innerHTML = profileImages.map(item => `
    <div class="settings-image-card${item.processing ? ' is-processing' : ''}" data-settings-image-id="${item.id}">
      ${item.src ? `<img src="${item.src}" alt="Profile image">` : ''}
      ${item.processing ? '' : '<button class="settings-image-card__remove" type="button" aria-label="Remove image"></button>'}
    </div>`).join('') + (profileImages.length < PROFILE_IMAGE_LIMIT
      ? '<button class="settings-images__add" type="button"><span aria-hidden="true">+</span><b>Add</b></button>' : '');
  strip.querySelector('.settings-images__add')?.addEventListener('click', openProfileImagePicker);
  strip.querySelectorAll('.settings-image-card').forEach(card => {
    const id = Number(card.dataset.settingsImageId);
    card.querySelector('.settings-image-card__remove')?.addEventListener('click', event => {
      event.stopPropagation();
      removeProfileImage(id, card);
    });
    if (card.classList.contains('is-processing')) return;
    let timer;
    card.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      timer = window.setTimeout(() => openSettingsImageMenu(id), 520);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => card.addEventListener(type, () => window.clearTimeout(timer)));
    card.addEventListener('contextmenu', event => { event.preventDefault(); openSettingsImageMenu(id); });
  });
}
window.renderSettingsProfileImages = renderSettingsProfileImages;

function showSettingsToast(message) {
  window.clearTimeout(settingsToastTimer);
  settingsToast.textContent = message;
  settingsToast.classList.add('is-visible');
  settingsToastTimer = window.setTimeout(() => settingsToast.classList.remove('is-visible'), 2200);
}

function closeSettingsDialog() {
  settingsDialog.classList.remove('is-open');
  settingsDialog.setAttribute('aria-hidden', 'true');
  settingsDialogConfirm = null;
}

function openSettingsDialog({ title, text = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, input = '', onConfirm }) {
  settingsDialogConfirm = onConfirm || null;
  settingsDialogCard.innerHTML = `<h3>${settingsEscape(title)}</h3>${text ? `<p>${settingsEscape(text)}</p>` : ''}${input ? `<input id="settingsDialogInput" placeholder="${settingsEscape(input)}" autocomplete="off">` : ''}<div class="settings-dialog__actions"><button type="button" data-settings-dialog-close>${settingsEscape(cancelLabel)}</button><button type="button" class="${danger ? 'is-danger' : 'is-primary'}" data-settings-dialog-confirm>${settingsEscape(confirmLabel)}</button></div>`;
  settingsDialog.classList.add('is-open');
  settingsDialog.setAttribute('aria-hidden', 'false');
  settingsDialogCard.querySelector('input')?.focus();
}

settingsDialog.addEventListener('click', event => {
  if (event.target.closest('[data-settings-dialog-close]')) return closeSettingsDialog();
  if (!event.target.closest('[data-settings-dialog-confirm]')) return;
  const value = settingsDialogCard.querySelector('input')?.value || '';
  const callback = settingsDialogConfirm;
  closeSettingsDialog();
  callback?.(value);
});

function openSettings() {
  settingsState.isPro = Boolean(state.isProjectsPro || settingsState.isPro);
  if (settingsState.isPro) state.isProjectsPro = true;
  settingsTitle.textContent = 'Settings';
  settingsMain.hidden = false;
  settingsSubpage.hidden = true;
  renderSettingsMain();
  scrollPageTo(0, 'auto');
  show('settings');
}

function closeSettingsSubpage() {
  settingsTitle.textContent = 'Settings';
  settingsSubpage.hidden = true;
  settingsMain.hidden = false;
  renderSettingsMain();
  scrollPageTo(settingsMainScrollTop, 'auto');
  persistSettingsNow();
}

function leaveSettings() {
  if (!settingsSubpage.hidden) return closeSettingsSubpage();
  persistSettingsNow();
  openOwnProfile();
}

document.querySelector('.profile-settings-button').addEventListener('click', openSettings);
document.getElementById('settingsBack').addEventListener('click', leaveSettings);

function beginSettingsSubpage(title, html) {
  if (!settingsMain.hidden) settingsMainScrollTop = pageScrollTop();
  settingsTitle.textContent = title;
  settingsMain.hidden = true;
  settingsSubpage.hidden = false;
  settingsSubpage.className = 'settings-subpage';
  settingsSubpage.innerHTML = html;
  scrollPageTo(0, 'auto');
}

function openSettingsField(action) {
  const fields = {
    name: { title: 'Name', value: document.getElementById('nameOut').textContent, hint: 'This is how your name appears on your profile.' },
    username: { title: 'Username', value: document.getElementById('handleOut').textContent.replace(/^@/, ''), hint: 'Available', prefix: '@' },
    bio: { title: 'Bio', value: document.getElementById('bioOut').textContent, hint: 'Tell brands and creators about yourself.', multiline: true }
  };
  const field = fields[action];
  const control = field.multiline
    ? `<textarea class="settings-form__field" id="settingsEditInput" maxlength="300">${settingsEscape(field.value)}</textarea>`
    : '<input class="settings-form__field" id="settingsEditInput" type="text">';
  beginSettingsSubpage(field.title, `<form class="settings-form" id="settingsEditForm">${control}<p class="settings-form__hint"><span>${settingsEscape(field.hint)}</span>${field.multiline ? `<span class="settings-form__count" id="settingsBioCount">${field.value.length} / 300</span>` : ''}</p><button class="settings-form__save" type="submit" disabled>Save</button></form>`);
  const input = document.getElementById('settingsEditInput');
  if (!field.multiline) input.value = field.value;
  input.focus();
  const save = settingsSubpage.querySelector('.settings-form__save');
  input.addEventListener('input', () => {
    if (field.multiline && input.value.length > 300) input.value = input.value.slice(0, 300);
    document.getElementById('settingsBioCount') && (document.getElementById('settingsBioCount').textContent = `${input.value.length} / 300`);
    save.disabled = input.value.trim() === field.value.trim() || !input.value.trim();
  });
  document.getElementById('settingsEditForm').addEventListener('submit', event => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value || save.disabled) return;
    if (action === 'name') {
      document.getElementById('nameOut').textContent = value;
      document.getElementById('fullname').value = value;
      settingsState.profileName = value;
    } else if (action === 'username') {
      const normalized = value.replace(/^@+/, '');
      document.getElementById('handleOut').textContent = `@${normalized}`;
      document.getElementById('username').value = normalized;
      settingsState.profileUsername = normalized;
    } else {
      document.getElementById('bioOut').textContent = value;
      document.getElementById('bio').value = value;
      document.getElementById('bioCount').textContent = value.length;
      settingsState.profileBio = value;
    }
    scheduleSettingsSave();
    showSettingsToast('Saved');
    closeSettingsSubpage();
  });
}

function openSettingsRadio(title, key, options) {
  beginSettingsSubpage(title, `<div class="settings-rows">${options.map(option => `<button class="settings-row${settingsState[key] === option ? ' is-selected' : ''}" type="button" data-radio-value="${settingsEscape(option)}"><span class="settings-row__copy"><span class="settings-row__label">${settingsEscape(option)}</span></span><span class="settings-radio"></span></button>`).join('')}</div>`);
  settingsSubpage.querySelectorAll('[data-radio-value]').forEach(button => button.addEventListener('click', () => {
    settingsState[key] = button.dataset.radioValue;
    scheduleSettingsSave();
    settingsSubpage.querySelectorAll('[data-radio-value]').forEach(row => row.classList.toggle('is-selected', row === button));
    window.setTimeout(closeSettingsSubpage, 200);
  }));
}

function openNotificationSettings() {
  const labels = { newProposals: 'New proposals', newMessages: 'New messages', likes: 'Likes', newFollowers: 'New followers', projectMatches: 'Project matches', productUpdates: 'Product updates' };
  beginSettingsSubpage('Notifications', `<div class="settings-rows">${Object.entries(labels).map(([key, label]) => `<label class="settings-row">${settingsIcon('bell')}<span class="settings-row__copy"><span class="settings-row__label">${label}</span></span><span class="settings-row__side"><span class="settings-switch"><input type="checkbox" data-notification-toggle="${key}"${settingsState.notifications[key] ? ' checked' : ''}><i></i></span></span></label>`).join('')}</div>`);
  settingsSubpage.querySelectorAll('[data-notification-toggle]').forEach(input => input.addEventListener('change', () => {
    settingsState.notifications[input.dataset.notificationToggle] = input.checked;
    scheduleSettingsSave();
  }));
}

function openSocialSettings() {
  const networks = [['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram']];
  const usernameValue = document.getElementById('handleOut').textContent.replace(/^@/, '') || 'ugc-model228';
  beginSettingsSubpage('Social media', `<div class="settings-rows">${networks.map(([key, label]) => `<button class="settings-row" type="button" data-social-setting="${key}"><span class="settings-row__copy"><span class="settings-row__label">${label}</span></span><span class="settings-row__side"><span class="settings-row__value">${settingsState.socials[key] ? `@${settingsEscape(usernameValue)}` : 'Connect'}</span>${settingsState.socials[key] ? '<span style="color:#ff3b30;font-size:20px">×</span>' : '<img class="settings-row__chevron" src="assets/icons/IconChevron.svg" alt="">'}</span></button>`).join('')}</div>`);
  settingsSubpage.querySelectorAll('[data-social-setting]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.socialSetting;
    settingsState.socials[key] = !settingsState.socials[key];
    const source = document.querySelector(`.social-row[data-social="${key}"]`);
    source?.classList.toggle('is-connected', settingsState.socials[key]);
    if (source) source.querySelector('.social-row__value').textContent = settingsState.socials[key] ? usernameValue : 'Connect';
    scheduleSettingsSave();
    openSocialSettings();
  }));
}

function openLinkedAccounts() {
  beginSettingsSubpage('Linked accounts', `<div class="settings-rows">${['Google', 'Apple'].map(name => { const key = `linked${name}`; return `<button class="settings-row" type="button" data-linked-setting="${key}">${settingsIcon('social')}<span class="settings-row__copy"><span class="settings-row__label">${name}</span></span><span class="settings-row__value">${settingsState[key] ? 'Disconnect' : 'Connect'}</span></button>`; }).join('')}</div>`);
  settingsSubpage.querySelectorAll('[data-linked-setting]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.linkedSetting;
    settingsState[key] = !settingsState[key];
    scheduleSettingsSave();
    openLinkedAccounts();
  }));
}

function openSecuritySettings() {
  beginSettingsSubpage('Password & Security', `<form class="settings-form" id="passwordForm"><input class="settings-form__field" type="password" placeholder="Current password"><input class="settings-form__field" style="margin-top:12px" type="password" placeholder="New password"><input class="settings-form__field" style="margin-top:12px" type="password" placeholder="Confirm new password"><button class="settings-form__save" type="submit">Change password</button></form>${settingsSection('Security', settingsRow({ label: 'Two-factor authentication', icon: 'key', toggle: 'twoFactor' }))}${settingsSection('Active sessions', '<div class="settings-session"><div class="settings-session__copy"><b>iPhone 15 Pro</b><span>Brussels · Current device</span></div></div><div class="settings-session"><div class="settings-session__copy"><b>Safari on Mac</b><span>Brussels · Active now</span></div><button type="button" data-end-session>End session</button></div><div class="settings-session"><div class="settings-session__copy"><b>Chrome on Windows</b><span>Kyiv · 2 days ago</span></div><button type="button" data-end-session>End session</button></div>')}`);
  settingsSubpage.querySelector('[data-settings-toggle]')?.addEventListener('change', event => { settingsState.twoFactor = event.target.checked; scheduleSettingsSave(); });
  settingsSubpage.querySelectorAll('[data-end-session]').forEach(button => button.addEventListener('click', () => { button.closest('.settings-session').remove(); showSettingsToast('Session ended'); }));
  document.getElementById('passwordForm').addEventListener('submit', event => { event.preventDefault(); showSettingsToast('Password updated'); event.currentTarget.reset(); });
}

function openPhoneSettings() {
  beginSettingsSubpage('Phone number', `<form class="settings-form" id="phoneForm"><input class="settings-form__field" id="settingsPhone" value="${settingsEscape(settingsState.phone)}" inputmode="tel"><p class="settings-form__hint">We’ll send a verification code. Any code works in this prototype.</p><button class="settings-form__secondary" id="sendPhoneCode" type="button">Send code</button><input class="settings-form__field" style="margin-top:12px" id="phoneCode" placeholder="Verification code" inputmode="numeric"><button class="settings-form__save" type="submit">Save</button></form>`);
  document.getElementById('sendPhoneCode').addEventListener('click', () => showSettingsToast('Code sent'));
  document.getElementById('phoneForm').addEventListener('submit', event => { event.preventDefault(); settingsState.phone = document.getElementById('settingsPhone').value.trim() || settingsState.phone; scheduleSettingsSave(); closeSettingsSubpage(); });
}

function openDndSettings() {
  beginSettingsSubpage('Do not disturb', `${settingsSection('Schedule', `<label class="settings-row">${settingsIcon('bell')}<span class="settings-row__copy"><span class="settings-row__label">Enable schedule</span></span><span class="settings-row__side"><span class="settings-switch"><input id="dndEnabled" type="checkbox"${settingsState.dndEnabled ? ' checked' : ''}><i></i></span></span></label>`)}<form class="settings-form" id="dndForm"><label class="settings-form__hint">From</label><input class="settings-form__field" id="dndFrom" type="time" value="${settingsState.dndFrom}"><label class="settings-form__hint" style="display:block;margin-top:16px">To</label><input class="settings-form__field" id="dndTo" type="time" value="${settingsState.dndTo}"><button class="settings-form__save" type="submit">Save</button></form>`);
  document.getElementById('dndForm').addEventListener('submit', event => { event.preventDefault(); settingsState.dndEnabled = document.getElementById('dndEnabled').checked; settingsState.dndFrom = document.getElementById('dndFrom').value; settingsState.dndTo = document.getElementById('dndTo').value; scheduleSettingsSave(); closeSettingsSubpage(); });
}

function openBlockedAccounts() {
  const content = settingsState.blocked.length
    ? settingsState.blocked.map((name, index) => `<div class="settings-row"><span class="settings-row__copy"><span class="settings-row__label">${settingsEscape(name)}</span></span><button class="settings-form__secondary" style="width:auto;height:36px;margin:0;padding:0 14px" data-unblock="${index}">Unblock</button></div>`).join('')
    : '<div class="messages-empty"><span>No blocked accounts</span></div>';
  beginSettingsSubpage('Blocked accounts', `<div class="settings-rows">${content}</div>`);
  settingsSubpage.querySelectorAll('[data-unblock]').forEach(button => button.addEventListener('click', () => { settingsState.blocked.splice(Number(button.dataset.unblock), 1); scheduleSettingsSave(); openBlockedAccounts(); }));
}

function openSettingsStub(title) {
  beginSettingsSubpage(title, `<div class="messages-empty"><span>${settingsEscape(title)} is coming soon</span></div>`);
}

function handleSettingsAction(action) {
  if (['name', 'username', 'bio'].includes(action)) return openSettingsField(action);
  if (action === 'nationality') return openPicker('country');
  if (action === 'current-location') return openPicker('location');
  if (action === 'socials') return openSocialSettings();
  if (action === 'phone') return openPhoneSettings();
  if (action === 'security') return openSecuritySettings();
  if (action === 'linked') return openLinkedAccounts();
  if (action === 'notifications') return openNotificationSettings();
  if (action === 'dnd') return openDndSettings();
  if (action === 'visibility') return openSettingsRadio('Profile visibility', 'profileVisibility', ['Public', 'Followers only', 'Private']);
  if (action === 'message-policy') return openSettingsRadio('Who can message you', 'messagePolicy', ['Everyone', 'People you follow', 'Nobody']);
  if (action === 'language') return openSettingsRadio('Language', 'language', ['English', 'Українська', 'Русский', 'Bahasa Indonesia']);
  if (action === 'blocked') return openBlockedAccounts();
  if (action === 'restore') return showSettingsToast('Nothing to restore');
  if (action === 'subscription') {
    persistSettingsNow(); show('projects');
    window.setTimeout(() => document.querySelector('[data-project-paywall]')?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 80);
    return;
  }
  if (action === 'manage-pro') return showSettingsToast('Subscription is managed by your app store');
  if (action === 'cancel-pro') return openSettingsDialog({ title: 'Cancel subscription?', text: 'Your Pro access will remain active until 1 Apr.', confirmLabel: 'Cancel subscription', danger: true, onConfirm: () => { settingsState.isPro = false; state.isProjectsPro = false; persistSettingsNow(); renderSettingsMain(true); } });
  if (action === 'clear-cache') return openSettingsDialog({ title: 'Clear cache?', text: 'Downloaded previews and temporary files will be removed.', confirmLabel: 'Clear', danger: true, onConfirm: () => { settingsState.cache = '0 MB'; scheduleSettingsSave(); renderSettingsMain(true); showSettingsToast('Cache cleared'); } });
  if (action === 'share') {
    const shareData = { title: 'kolaba', text: 'Create and collaborate on kolaba', url: 'https://kolaba.app' };
    if (navigator.share) navigator.share(shareData).catch(() => {});
    else navigator.clipboard?.writeText(shareData.url).then(() => showSettingsToast('Link copied')).catch(() => showSettingsToast('kolaba.app'));
    return;
  }
  if (action === 'logout') return openSettingsDialog({ title: 'Log out?', text: 'You can sign back in at any time.', confirmLabel: 'Log out', danger: true, onConfirm: () => { persistSettingsNow(); show('start'); } });
  if (action === 'delete-account') return openSettingsDialog({ title: 'Delete account?', text: "This can't be undone. Type DELETE to confirm.", input: 'DELETE', confirmLabel: 'Delete', danger: true, onConfirm: value => {
    if (value !== 'DELETE') return showSettingsToast('Type DELETE to confirm');
    try { localStorage.removeItem(SETTINGS_KEY); } catch (error) {}
    settingsState = structuredClone(SETTINGS_DEFAULTS);
    profileImages.splice(0, profileImages.length);
    document.getElementById('fullname').value = '';
    document.getElementById('username').value = '';
    document.getElementById('bio').value = '';
    renderProfileImages();
    syncOwnProfilePhotos();
    show('start');
  } });
  openSettingsStub({ help: 'Help center', contact: 'Contact us', rate: 'Rate kolaba', 'privacy-policy': 'Privacy Policy', terms: 'Terms and Conditions', licenses: 'Licenses' }[action] || 'Settings');
}

settingsMain.addEventListener('click', event => {
  const action = event.target.closest('[data-settings-action]')?.dataset.settingsAction;
  if (action) handleSettingsAction(action);
});

settingsMain.addEventListener('change', event => {
  const toggle = event.target.dataset.settingsToggle;
  if (!toggle) return;
  settingsState[toggle] = event.target.checked;
  scheduleSettingsSave();
});

window.refreshSettingsValues = () => {
  settingsState.nationalityCode = state.selectedCountryCode;
  settingsState.location = { ...state.selectedLocation };
  scheduleSettingsSave();
  if (settingsScreen.classList.contains('is-active') && settingsSubpage.hidden) renderSettingsMain(true);
};

settingsScreen.addEventListener('pointerdown', event => {
  if (event.clientX - settingsScreen.getBoundingClientRect().left <= 24) settingsEdgeGesture = { x: event.clientX, y: event.clientY };
});
settingsScreen.addEventListener('pointerup', event => {
  if (!settingsEdgeGesture) return;
  const dx = event.clientX - settingsEdgeGesture.x;
  const dy = event.clientY - settingsEdgeGesture.y;
  settingsEdgeGesture = null;
  if (dx > 70 && Math.abs(dx) > Math.abs(dy)) leaveSettings();
});
settingsScreen.addEventListener('pointercancel', () => { settingsEdgeGesture = null; });

window.addEventListener('pagehide', persistSettingsNow);

// Apply persisted profile-facing values before the user first opens Settings.
const storedNationality = countryByCode(settingsState.nationalityCode);
if (storedNationality) {
  state.selectedCountryCode = storedNationality.code;
  document.getElementById('countryFlag').textContent = storedNationality.flag;
  document.getElementById('countryValue').textContent = storedNationality.name;
}
if (settingsState.location?.label) {
  state.selectedLocation = { ...settingsState.location };
  document.getElementById('locationFlag').textContent = flagFor(state.selectedLocation.code);
  document.getElementById('locationValue').textContent = state.selectedLocation.label;
  document.getElementById('locationOutFlag').textContent = flagFor(state.selectedLocation.code);
  document.getElementById('locationOut').textContent = state.selectedLocation.label;
}
if (settingsState.profileName) {
  document.getElementById('fullname').value = settingsState.profileName;
  document.getElementById('nameOut').textContent = settingsState.profileName;
}
if (settingsState.profileUsername) {
  document.getElementById('username').value = settingsState.profileUsername;
  document.getElementById('handleOut').textContent = `@${settingsState.profileUsername.replace(/^@+/, '')}`;
}
if (settingsState.profileBio) {
  document.getElementById('bio').value = settingsState.profileBio;
  document.getElementById('bioCount').textContent = settingsState.profileBio.length;
  document.getElementById('bioOut').textContent = settingsState.profileBio;
}
document.querySelectorAll('.social-row[data-social]').forEach(row => {
  const key = row.dataset.social;
  const connected = Boolean(settingsState.socials[key]);
  row.classList.toggle('is-connected', connected);
  if (connected) row.querySelector('.social-row__value').textContent = settingsState.profileUsername || row.dataset.fallback;
});
if (settingsState.isPro) state.isProjectsPro = true;
renderSettingsMain();
