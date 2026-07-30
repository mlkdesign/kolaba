/* Профиль: данные из формы, свой и чужой профиль */
import { show } from '../core/router.js';
import { PROFILE_REEL_MEDIA, normalizedAuthorPhotos } from '../data/catalog.js';
import { DEFAULT_AVATAR_URL } from '../data/photos.js';
import { bio, profileImages } from '../screens/setup.js';
import { setProfileVideos } from '../ui/photo-viewer.js';
import { countryByCode, flagFor } from '../ui/picker.js';

/* ── Данные из формы уезжают в профиль ── */
const username = document.getElementById('username');
const fullname = document.getElementById('fullname');
const profilePage = document.querySelector('.screen-page[data-screen="profile"]');
const profileAvatar = profilePage.querySelector('.avatar img');
const profileAvatarButton = document.getElementById('profileAvatarButton');
const profileProjectsTab = profilePage.querySelector('.tabbar [data-go="projects"]');
const profileFeedTab = profilePage.querySelector('.tabbar [data-go="feed"]');
const profileMessagesTab = profilePage.querySelector('.tabbar [data-go="messages"]');
const profileNotificationsTab = profilePage.querySelector('.tabbar [data-go="notifications"]');
const profileOwnTab = profilePage.querySelector('.tabbar [data-go="profile"]');
const profileBackButton = profilePage.querySelector('.profile-back-button');
let ownProfileSnapshot = null;
let externalProfileReturnScreen = 'feed';
let currentExternalProfileAuthor = null;
let currentProfilePhotos = [];
let currentProfileIsOwn = true;

function ownProfilePhotos() {
  return profileImages.filter(image => !image.processing && image.src).map(image => image.src);
}

function updateProfileAvatarAvailability() {
  const available = currentProfilePhotos.length > 0;
  profileAvatarButton.classList.toggle('is-viewable', available);
  profileAvatarButton.setAttribute('aria-disabled', String(!available));
}

function syncOwnProfilePhotos() {
  const photos = ownProfilePhotos();
  const firstPhoto = photos[0] || DEFAULT_AVATAR_URL;
  if (!profilePage.classList.contains('is-external-profile')) {
    currentProfilePhotos = photos.length ? photos : [firstPhoto];
    currentProfileIsOwn = true;
    profileAvatar.src = firstPhoto;
    document.querySelectorAll('.tabbar__avatar img').forEach(image => {
      image.src = firstPhoto;
    });
    updateProfileAvatarAvailability();
  }
  if (ownProfileSnapshot) ownProfileSnapshot.avatar = firstPhoto;
}

function setProfileNavigationContext(context = 'profile') {
  profileProjectsTab.classList.toggle('is-active', context === 'projects');
  profileFeedTab.classList.toggle('is-active', context === 'feed');
  profileMessagesTab.classList.toggle('is-active', context === 'messages');
  profileNotificationsTab.classList.toggle('is-active', context === 'notifications');
  profileOwnTab.classList.toggle('is-active', context === 'profile');
}

function captureOwnProfile() {
  return {
    handle: document.getElementById('handleOut').textContent,
    name: document.getElementById('nameOut').textContent,
    location: document.getElementById('locationOut').textContent,
    locationFlag: document.getElementById('locationOutFlag').textContent,
    avatar: profileAvatar.src,
    bio: document.getElementById('bioOut').textContent
  };
}

function resetProfileScrollPosition() {
  const scroller = document.getElementById('profileScroll');
  const reset = () => scroller.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  reset();
  window.requestAnimationFrame(() => {
    reset();
    window.requestAnimationFrame(reset);
  });
}

function openOwnProfile() {
  if (ownProfileSnapshot) {
    document.getElementById('handleOut').textContent = ownProfileSnapshot.handle;
    document.getElementById('nameOut').textContent = ownProfileSnapshot.name;
    document.getElementById('locationOut').textContent = ownProfileSnapshot.location;
    document.getElementById('locationOutFlag').textContent = ownProfileSnapshot.locationFlag;
    document.getElementById('bioOut').textContent = ownProfileSnapshot.bio;
    profileAvatar.src = ownProfileSnapshot.avatar;
    ownProfileSnapshot = null;
  }
  setProfileVideos(PROFILE_REEL_MEDIA);
  profilePage.classList.remove('is-external-profile');
  currentExternalProfileAuthor = null;
  const ownPhotos = ownProfilePhotos();
  currentProfilePhotos = ownPhotos.length ? ownPhotos : [profileAvatar.src || DEFAULT_AVATAR_URL];
  currentProfileIsOwn = true;
  profileAvatar.src = currentProfilePhotos[0];
  updateProfileAvatarAvailability();
  setProfileNavigationContext('profile');
  profilePage.dataset.profileFlag = document.getElementById('locationFlag').textContent;
  show('profile');
}

function openExternalProfile(author, returnScreen = 'feed') {
  if (!profilePage.classList.contains('is-external-profile')) ownProfileSnapshot = captureOwnProfile();
  const handle = author.name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  document.getElementById('handleOut').textContent = `@${handle}`;
  document.getElementById('nameOut').textContent = author.name;
  document.getElementById('locationOut').textContent = `${author.city}, ${countryByCode(author.countryCode)?.name || author.countryCode}`;
  document.getElementById('locationOutFlag').textContent = flagFor(author.countryCode);
  document.getElementById('bioOut').textContent = author.bio || 'UGC creator crafting authentic content for modern brands ✨';
  currentProfilePhotos = normalizedAuthorPhotos(author);
  currentProfileIsOwn = false;
  profileAvatar.src = currentProfilePhotos[0] || author.avatarURL;
  updateProfileAvatarAvailability();
  setProfileVideos(author.videos || PROFILE_REEL_MEDIA);
  profilePage.dataset.profileFlag = flagFor(author.countryCode);
  profilePage.classList.add('is-external-profile');
  currentExternalProfileAuthor = author;
  externalProfileReturnScreen = returnScreen;
  profileBackButton.dataset.back = returnScreen;
  profileBackButton.setAttribute('aria-label', `Back to ${returnScreen}`);
  setProfileNavigationContext(returnScreen);
  const externalFollow = document.getElementById('externalProfileFollow');
  externalFollow.classList.remove('is-following');
  externalFollow.firstChild.textContent = 'Follow ';
  externalFollow.querySelector('img').src = 'assets/icons/FeedPlus.svg';
  show('profile');
  resetProfileScrollPosition();
}

document.getElementById('externalProfileFollow').addEventListener('click', event => {
  const button = event.currentTarget;
  const following = button.classList.toggle('is-following');
  button.firstChild.textContent = following ? 'Following ' : 'Follow ';
  button.querySelector('img').src = following ? 'assets/icons/Check.svg' : 'assets/icons/FeedPlus.svg';
});

document.getElementById('externalProfileMessage').addEventListener('click', () => {
  if (!currentExternalProfileAuthor || typeof window.openMessengerConversationWithProfile !== 'function') return;
  window.openMessengerConversationWithProfile(currentExternalProfileAuthor, externalProfileReturnScreen);
});

let externalProfileEdgeGesture = null;
profilePage.addEventListener('pointerdown', event => {
  const rect = profilePage.getBoundingClientRect();
  if (!profilePage.classList.contains('is-external-profile') || event.clientX - rect.left > 24) return;
  externalProfileEdgeGesture = { x: event.clientX, y: event.clientY };
});
profilePage.addEventListener('pointerup', event => {
  if (!externalProfileEdgeGesture) return;
  const dx = event.clientX - externalProfileEdgeGesture.x;
  const dy = event.clientY - externalProfileEdgeGesture.y;
  externalProfileEdgeGesture = null;
  if (dx > 70 && Math.abs(dx) > Math.abs(dy)) show(externalProfileReturnScreen);
});
profilePage.addEventListener('pointercancel', () => { externalProfileEdgeGesture = null; });

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

export { currentProfileIsOwn, currentProfilePhotos, openExternalProfile, openOwnProfile, profileAvatar, profilePage, syncOwnProfilePhotos };
