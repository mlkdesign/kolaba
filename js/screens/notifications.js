/* Уведомления и переходы из них */
import { show } from '../core/router.js';
import { state } from '../core/state.js';
import { UNIQUE_VERTICAL_VIDEO_LIBRARY, VIDEO_HOLD_DELAY, compactMetric, generatedProfilePhotos, updateVideoProgress } from '../data/catalog.js';
import { PHOTOS } from '../data/photos.js';
import { openExternalProfile } from '../screens/profile.js';
import { PROJECT_AUTHOR_PROFILES, openProjectDetail, projects, setProjectsTab } from '../screens/projects.js';
import { pageScrollTop, scrollPageTo } from '../ui/page-scroll.js';
import { countryByCode, flagFor } from '../ui/picker.js';
import { play as playVideo } from '../ui/video.js';

/* ── Notifications ── */
const notificationsList = document.getElementById('notificationsList');
const notificationsMenu = document.getElementById('notificationsMenu');
const notificationsRefresh = document.getElementById('notificationsRefresh');
const notificationGroups = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'Last 7 days'],
  ['month', 'Last 30 days']
];
const notificationKinds = [
  'like', 'like', 'like', 'like', 'like', 'like', 'like', 'like', 'like', 'like',
  'follow', 'follow', 'follow', 'follow',
  'profileView', 'profileView', 'profileView', 'profileView',
  'application', 'application'
];
const notificationKindMeta = {
  like: { text: 'Liked your video', icon: 'NotificationHeart.svg', side: 'preview' },
  follow: { text: 'Followed you', icon: 'NotificationPlus.svg', side: 'follow' },
  profileView: { text: 'Viewed your profile', icon: 'NotificationEye.svg', side: 'follow' },
  application: { text: 'Applied to your project', icon: 'NotificationBriefcase.svg', side: '' }
};
const notificationBios = [
  'UGC creator sharing warm lifestyle stories and honest product moments ✨',
  'Fashion, travel and everyday creativity — open to thoughtful brand collaborations.',
  'I make natural vertical content that feels human, useful and beautifully simple.',
  'Food and hospitality creator focused on atmosphere, people and real experiences.'
];
let notificationSequence = 0;
let notifications = [];

function notificationAuthor(index) {
  const source = PROJECT_AUTHOR_PROFILES[index % PROJECT_AUTHOR_PROFILES.length];
  const [city] = source.location.split(', ');
  const videoStart = (index * 5) % UNIQUE_VERTICAL_VIDEO_LIBRARY.length;
  const avatarURL = source.avatar;
  return {
    name: source.name,
    username: source.handle.replace(/^@/, ''),
    city,
    countryCode: source.countryCode,
    avatarURL,
    photos: generatedProfilePhotos(avatarURL, index),
    bio: notificationBios[index % notificationBios.length],
    videos: Array.from({ length: 5 }, (_, offset) => UNIQUE_VERTICAL_VIDEO_LIBRARY[(videoStart + offset) % UNIQUE_VERTICAL_VIDEO_LIBRARY.length])
  };
}

function makeNotification(group = 'today', forceUnread = false) {
  const authorIndex = Math.floor(Math.random() * PROJECT_AUTHOR_PROFILES.length);
  const kind = notificationKinds[Math.floor(Math.random() * notificationKinds.length)];
  const clip = kind === 'like'
    ? UNIQUE_VERTICAL_VIDEO_LIBRARY[Math.floor(Math.random() * UNIQUE_VERTICAL_VIDEO_LIBRARY.length)]
    : null;
  const groupAge = {
    today: 1 + Math.floor(Math.random() * 720),
    yesterday: 1440 + Math.floor(Math.random() * 720),
    week: 2880 + Math.floor(Math.random() * 5 * 1440),
    month: 8 * 1440 + Math.floor(Math.random() * 22 * 1440)
  }[group];
  const ownProjects = projects.filter(project => project.isMine);
  const targetProject = kind === 'application' && ownProjects.length
    ? ownProjects[notificationSequence % ownProjects.length]
    : null;
  return {
    id: `notification-${Date.now()}-${notificationSequence++}`,
    kind,
    author: notificationAuthor(authorIndex),
    createdAt: new Date(Date.now() - groupAge * 60000),
    ageMinutes: groupAge,
    group,
    isRead: !forceUnread,
    isFollowing: Math.random() > .68,
    clip,
    likes: 120 + Math.floor(Math.random() * 15000),
    views: 900 + Math.floor(Math.random() * 120000),
    projectId: targetProject?.id || null,
    projectTitle: targetProject ? targetProject.text.split('\n')[0].replace(/[🌴☀️✨🧴🍵💚🧥📸🌊🏨🏃‍♀️⚡️☕️🤎🐕🌿🕯️🏡💄🍝🍋🕶️🌇]/gu, '').trim() : null
  };
}

function seedNotifications() {
  const total = 25 + Math.floor(Math.random() * 11);
  const todayCount = 6 + Math.floor(Math.random() * 4);
  const yesterdayCount = 4 + Math.floor(Math.random() * 4);
  const weekCount = Math.max(6, Math.floor((total - todayCount - yesterdayCount) * .48));
  const unreadToday = 2 + Math.floor(Math.random() * 3);
  notifications = Array.from({ length: total }, (_, index) => {
    const group = index < todayCount
      ? 'today'
      : index < todayCount + yesterdayCount
        ? 'yesterday'
        : index < todayCount + yesterdayCount + weekCount
          ? 'week'
          : 'month';
    return makeNotification(group, group === 'today' && index < unreadToday);
  }).sort((a, b) => a.ageMinutes - b.ageMinutes);
  if (!notifications.some(item => item.kind === 'application')) {
    const project = projects.find(item => item.isMine);
    if (project && notifications[0]) {
      notifications[0].kind = 'application';
      notifications[0].clip = null;
      notifications[0].projectId = project.id;
      notifications[0].projectTitle = project.text.split('\n')[0].replace(/[🌴☀️✨🧴🍵💚🧥📸🌊🏨🏃‍♀️⚡️☕️🤎🐕🌿🕯️🏡💄🍝🍋🕶️🌇]/gu, '').trim();
    }
  }
}

function notificationTime(item) {
  if (item.group === 'today') {
    if (item.ageMinutes < 60) return `${Math.max(1, item.ageMinutes)} m`;
    return `${Math.max(1, Math.floor(item.ageMinutes / 60))} h`;
  }
  return item.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function notificationSideMarkup(item, meta) {
  if (meta.side === 'preview' && item.clip) {
    return `<button class="notification-preview" type="button" data-notification-preview aria-label="Open video"><img src="${item.clip.posterURL}" alt="" loading="lazy" decoding="async"><span class="notification-preview__play"><img src="assets/icons/ProjectPlay.svg" alt=""></span></button>`;
  }
  if (meta.side === 'follow') {
    return `<button class="notification-follow${item.isFollowing ? ' is-following' : ''}" type="button" data-notification-follow aria-label="${item.isFollowing ? 'Following' : 'Follow'}"><img src="assets/icons/${item.isFollowing ? 'Check' : 'NotificationPlus'}.svg" alt=""></button>`;
  }
  return '';
}

function notificationRowMarkup(item) {
  const meta = notificationKindMeta[item.kind];
  const title = item.kind === 'application'
    ? `<button class="notification-row__author" type="button" data-notification-profile>${item.author.username}</button><span class="notification-row__chevron">›</span><span class="notification-row__project">${item.projectTitle}</span>`
    : `<button class="notification-row__author" type="button" data-notification-profile>${item.author.username}</button>`;
  return `
    <article class="notification-row${item.isRead ? '' : ' is-unread'}" data-notification-id="${item.id}" tabindex="0" role="button">
      <span class="notification-row__unread" aria-hidden="true"></span>
      <button class="notification-row__avatar-button" type="button" data-notification-profile aria-label="Open ${item.author.username} profile"><img class="notification-row__avatar" src="${item.author.avatarURL}" alt="" loading="lazy" decoding="async"></button>
      <div class="notification-row__body">
        <div class="notification-row__title">${title}</div>
        <div class="notification-row__action"><img src="assets/icons/${meta.icon}" alt=""><span class="notification-row__action-text">${meta.text}</span><span class="notification-row__time"> • ${notificationTime(item)}</span></div>
      </div>
      <div class="notification-row__side">${notificationSideMarkup(item, meta)}</div>
    </article>`;
}

function unreadNotificationsCount() {
  return notifications.reduce((count, item) => count + (item.isRead ? 0 : 1), 0);
}

function syncNotificationBadges() {
  const unread = unreadNotificationsCount();
  document.querySelectorAll('[data-notification-badge]').forEach(badge => {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread === 0;
    badge.closest('button')?.classList.toggle('has-badge', unread > 0);
  });
  const todayUnread = notifications.filter(item => item.group === 'today' && !item.isRead).length;
  const todayBadge = notificationsList.querySelector('[data-today-unread]');
  if (todayBadge) {
    todayBadge.textContent = String(todayUnread);
    todayBadge.hidden = todayUnread === 0;
  }
}

function markAllNotificationsRead() {
  const hasUnread = notifications.some(item => !item.isRead);
  notifications.forEach(item => { item.isRead = true; });
  if (hasUnread) renderNotifications();
  else syncNotificationBadges();
}

function renderNotifications() {
  const scrollPosition = pageScrollTop();
  if (!notifications.length) {
    notificationsList.innerHTML = '<div class="notifications-empty"><img src="assets/icons/IconBell.svg" alt=""><span>No notifications yet</span></div>';
  } else {
    notificationsList.innerHTML = notificationGroups.map(([group, label]) => {
      const items = notifications.filter(item => item.group === group);
      if (!items.length) return '';
      const unread = items.filter(item => !item.isRead).length;
      const badge = group === 'today' ? `<span class="notification-section__badge" data-today-unread${unread ? '' : ' hidden'}>${unread}</span>` : '';
      return `<section class="notification-section" data-notification-group="${group}"><h3 class="notification-section__title">${label}${badge}</h3>${items.map(notificationRowMarkup).join('')}</section>`;
    }).join('');
  }
  scrollPageTo(scrollPosition, 'auto');
  notificationsList.querySelectorAll('.notification-row__avatar').forEach((image, index) => {
    image.addEventListener('error', () => { image.src = PHOTOS[index % PHOTOS.length]; }, { once: true });
  });
  notificationsList.querySelectorAll('.notification-preview > img').forEach((image, index) => {
    image.addEventListener('error', () => { image.src = PHOTOS[(index + 2) % PHOTOS.length]; }, { once: true });
  });
  syncNotificationBadges();
}

function markNotificationRead(item, row) {
  if (item.isRead) return;
  item.isRead = true;
  row?.classList.remove('is-unread');
  syncNotificationBadges();
}

function notificationProfileAuthor(item) {
  return { ...item.author, videos: item.author.videos };
}

const notificationClipStage = document.getElementById('notificationClipStage');
const notificationClipVideo = document.getElementById('notificationClipVideo');
const notificationClipLike = document.getElementById('notificationClipLike');
let activeNotificationClip = null;
let notificationClipLiked = false;
let notificationClipLastHold = 0;
const notificationClipHold = { pointerId: null, x: 0, y: 0, timer: null, active: false, wasPlaying: false };

function openNotificationClip(item) {
  if (!item.clip) return;
  activeNotificationClip = item;
  notificationClipLiked = false;
  notificationClipStage.classList.remove('is-ready');
  notificationClipVideo.removeAttribute('poster');
  notificationClipVideo.src = item.clip.videoURL;
  notificationClipVideo.muted = !state.videoSoundEnabled;
  document.getElementById('notificationClipAvatar').src = item.author.avatarURL;
  document.getElementById('notificationClipName').textContent = item.author.username;
  document.getElementById('notificationClipFlag').textContent = flagFor(item.author.countryCode);
  document.getElementById('notificationClipLocation').textContent = `${item.author.city}, ${countryByCode(item.author.countryCode)?.name || item.author.countryCode}`;
  document.getElementById('notificationClipCaption').textContent = item.author.bio;
  notificationClipLike.querySelector('b').textContent = compactMetric(item.likes);
  notificationClipLike.classList.remove('is-liked');
  document.getElementById('notificationClipViews').textContent = compactMetric(item.views);
  show('notificationClip');
  notificationClipVideo.load();
  playVideo(notificationClipVideo);
}

function closeNotificationClip() {
  notificationClipVideo.pause();
  notificationClipVideo.removeAttribute('src');
  notificationClipVideo.load();
  activeNotificationClip = null;
  show('notifications');
}

notificationClipVideo.addEventListener('loadeddata', () => notificationClipStage.classList.add('is-ready'));
notificationClipVideo.addEventListener('error', () => notificationClipStage.classList.add('is-ready'));
notificationClipVideo.addEventListener('timeupdate', () => updateVideoProgress(document.getElementById('notificationClipProgress'), notificationClipVideo));
notificationClipStage.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.target.closest('button')) return;
  notificationClipHold.pointerId = event.pointerId;
  notificationClipHold.x = event.clientX;
  notificationClipHold.y = event.clientY;
  notificationClipHold.active = false;
  notificationClipHold.wasPlaying = false;
  window.clearTimeout(notificationClipHold.timer);
  notificationClipHold.timer = window.setTimeout(() => {
    if (notificationClipHold.pointerId !== event.pointerId) return;
    notificationClipHold.active = true;
    notificationClipHold.wasPlaying = !notificationClipVideo.paused;
    notificationClipVideo.pause();
  }, VIDEO_HOLD_DELAY);
  notificationClipStage.setPointerCapture?.(event.pointerId);
});
notificationClipStage.addEventListener('pointermove', event => {
  if (event.pointerId !== notificationClipHold.pointerId || notificationClipHold.active) return;
  if (Math.hypot(event.clientX - notificationClipHold.x, event.clientY - notificationClipHold.y) > 6) {
    window.clearTimeout(notificationClipHold.timer);
  }
});
function finishNotificationClipHold(event) {
  if (event.pointerId !== notificationClipHold.pointerId) return;
  window.clearTimeout(notificationClipHold.timer);
  const shouldResume = notificationClipHold.active && notificationClipHold.wasPlaying;
  if (notificationClipHold.active) notificationClipLastHold = performance.now();
  notificationClipHold.pointerId = null;
  notificationClipHold.active = false;
  notificationClipHold.wasPlaying = false;
  if (shouldResume) playVideo(notificationClipVideo);
}
notificationClipStage.addEventListener('pointerup', finishNotificationClipHold);
notificationClipStage.addEventListener('pointercancel', finishNotificationClipHold);
notificationClipStage.addEventListener('click', event => {
  if (event.target.closest('button') || performance.now() - notificationClipLastHold < 250) return;
  state.videoSoundEnabled = !state.videoSoundEnabled;
  notificationClipVideo.muted = !state.videoSoundEnabled;
});
notificationClipLike.addEventListener('click', () => {
  if (!activeNotificationClip) return;
  notificationClipLiked = !notificationClipLiked;
  notificationClipLike.classList.toggle('is-liked', notificationClipLiked);
  notificationClipLike.querySelector('b').textContent = compactMetric(activeNotificationClip.likes + (notificationClipLiked ? 1 : 0));
});
document.getElementById('notificationClipBack').addEventListener('click', closeNotificationClip);
document.getElementById('notificationProjectBack').addEventListener('click', () => show('notifications'));

notificationsList.addEventListener('click', event => {
  const row = event.target.closest('.notification-row');
  if (!row) return;
  const item = notifications.find(notification => notification.id === row.dataset.notificationId);
  if (!item) return;
  const followButton = event.target.closest('[data-notification-follow]');
  if (followButton) {
    item.isFollowing = !item.isFollowing;
    followButton.classList.toggle('is-following', item.isFollowing);
    followButton.setAttribute('aria-label', item.isFollowing ? 'Following' : 'Follow');
    followButton.innerHTML = `<img src="assets/icons/${item.isFollowing ? 'Check' : 'NotificationPlus'}.svg" alt="">`;
    followButton.classList.remove('is-bouncing');
    void followButton.offsetWidth;
    followButton.classList.add('is-bouncing');
    return;
  }
  markNotificationRead(item, row);
  if (event.target.closest('[data-notification-preview]')) {
    openNotificationClip(item);
    return;
  }
  if (item.kind === 'application' && !event.target.closest('[data-notification-profile]')) {
    const project = projects.find(candidate => candidate.id === item.projectId && candidate.isMine);
    if (!project) return;
    show('projects');
    setProjectsTab('mine');
    window.requestAnimationFrame(() => openProjectDetail(project));
    return;
  }
  openExternalProfile(notificationProfileAuthor(item), 'notifications');
});

notificationsList.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key) || event.target.closest('button')) return;
  const row = event.target.closest('.notification-row');
  if (!row) return;
  event.preventDefault();
  row.click();
});

function closeNotificationsMenu() {
  notificationsMenu.classList.remove('is-open');
  notificationsMenu.setAttribute('aria-hidden', 'true');
}
document.getElementById('notificationsMore').addEventListener('click', () => {
  notificationsMenu.classList.add('is-open');
  notificationsMenu.setAttribute('aria-hidden', 'false');
});
notificationsMenu.querySelectorAll('[data-notifications-menu-close]').forEach(button => button.addEventListener('click', closeNotificationsMenu));
notificationsMenu.addEventListener('click', event => {
  const action = event.target.closest('[data-notification-action]')?.dataset.notificationAction;
  if (!action) return;
  if (action === 'clear') {
    notifications = [];
    renderNotifications();
  }
  closeNotificationsMenu();
});

let notificationPull = null;
notificationsList.addEventListener('pointerdown', event => {
  if (pageScrollTop() > 0) return;
  notificationPull = { y: event.clientY, distance: 0 };
});
notificationsList.addEventListener('pointermove', event => {
  if (!notificationPull) return;
  notificationPull.distance = Math.max(0, event.clientY - notificationPull.y);
  if (notificationPull.distance > 14) {
    notificationsRefresh.classList.add('is-visible');
    notificationsRefresh.querySelector('span').textContent = notificationPull.distance > 62 ? 'Release to refresh' : 'Pull to refresh';
  }
});
notificationsList.addEventListener('pointerup', () => {
  if (!notificationPull) return;
  const shouldRefresh = notificationPull.distance > 62;
  notificationPull = null;
  if (!shouldRefresh) {
    notificationsRefresh.classList.remove('is-visible');
    return;
  }
  notificationsRefresh.classList.add('is-visible', 'is-loading');
  notificationsRefresh.querySelector('span').textContent = 'Refreshing…';
  window.setTimeout(() => {
    const amount = 2 + Math.floor(Math.random() * 3);
    const fresh = Array.from({ length: amount }, () => makeNotification('today', true));
    notifications = [...fresh, ...notifications];
    renderNotifications();
    scrollPageTo(0, 'auto');
    notificationsRefresh.classList.remove('is-visible', 'is-loading');
  }, 550);
});
notificationsList.addEventListener('pointercancel', () => {
  notificationPull = null;
  notificationsRefresh.classList.remove('is-visible', 'is-loading');
});

seedNotifications();
renderNotifications();

export { markAllNotificationsRead };
