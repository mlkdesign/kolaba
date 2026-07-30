/* Полноэкранный просмотрщик фотографий профиля */
import { PROFILE_PHOTOS, PROFILE_REEL_MEDIA, mediaStats, openPhoto } from '../data/catalog.js';
import { openProfileReels, resetProfileReelData } from '../screens/feed.js';
import { currentProfileIsOwn, currentProfilePhotos, syncOwnProfilePhotos } from '../screens/profile.js';
import { profileImages, renderProfileImages } from '../screens/setup.js';

/* Кнопку аватара берём из DOM напрямую: этот модуль и screens/profile.js
   ссылаются друг на друга, а импортированную константу нельзя прочитать,
   пока модуль-владелец ещё выполняется. */
const profileAvatarButton = document.getElementById('profileAvatarButton');

/* ── Просмотрщик фотографий профиля ── */
const profilePhotoViewer = document.getElementById('profilePhotoViewer');
const profilePhotoBackdrop = document.getElementById('profilePhotoBackdrop');
const profilePhotoStage = document.getElementById('profilePhotoStage');
const profilePhotoImageShell = document.getElementById('profilePhotoImageShell');
const profilePhotoImage = document.getElementById('profilePhotoImage');
const profilePhotoCounter = document.getElementById('profilePhotoCounter');
const profilePhotoThumbs = document.getElementById('profilePhotoThumbs');
const profilePhotoClose = document.getElementById('profilePhotoClose');
const profilePhotoMore = document.getElementById('profilePhotoMore');
const profilePhotoMenu = document.getElementById('profilePhotoMenu');
const profilePhotoMenuSheet = document.getElementById('profilePhotoMenuSheet');
let profilePhotoIndex = 0;
let profilePhotoViewerPhotos = [];
let profilePhotoViewerOwn = false;
let profilePhotoZoomed = false;
let profilePhotoClearTimer;
let profilePhotoGesture = null;
let profilePhotoLastTap = 0;
let profilePhotoClosing = false;
let profilePhotoSuppressTap = false;

/* Раньше приложение рисовалось в 402px и масштабировалось трансформом, поэтому
   пороги жестов приходилось делить на масштаб. Теперь координаты события уже
   в тех же пикселях, что и вёрстка. */

function setProfilePhotoZoom(zoomed, clientX, clientY) {
  profilePhotoZoomed = zoomed;
  if (zoomed && Number.isFinite(clientX) && Number.isFinite(clientY)) {
    const rect = profilePhotoStage.getBoundingClientRect();
    const originX = Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100));
    const originY = Math.max(0, Math.min(100, (clientY - rect.top) / rect.height * 100));
    profilePhotoImage.style.transformOrigin = `${originX}% ${originY}%`;
  } else {
    profilePhotoImage.style.transformOrigin = '50% 50%';
  }
  profilePhotoImage.classList.toggle('is-zoomed', zoomed);
  profilePhotoImage.style.transform = `scale(${zoomed ? 2 : 1})`;
  profilePhotoStage.classList.toggle('is-zoomed', zoomed);
}

function centerActiveProfileThumb(animated = true) {
  const active = profilePhotoThumbs.querySelector('.is-active');
  if (!active) return;
  const target = active.offsetLeft + active.offsetWidth / 2 - profilePhotoThumbs.clientWidth / 2;
  profilePhotoThumbs.scrollTo({ left: target, behavior: animated ? 'smooth' : 'auto' });
}

function renderProfilePhotoThumbs() {
  profilePhotoThumbs.replaceChildren();
  profilePhotoViewer.classList.toggle('has-thumbs', profilePhotoViewerPhotos.length > 1);
  if (profilePhotoViewerPhotos.length <= 1) return;
  profilePhotoViewerPhotos.forEach((src, index) => {
    const button = document.createElement('button');
    button.className = `profile-photo-viewer__thumb${index === profilePhotoIndex ? ' is-active' : ''}`;
    button.type = 'button';
    button.setAttribute('aria-label', `Open photo ${index + 1}`);
    const image = new Image();
    image.src = src;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    button.appendChild(image);
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (index === profilePhotoIndex) return;
      showProfileViewerPhoto(index, index > profilePhotoIndex ? 1 : -1);
    });
    profilePhotoThumbs.appendChild(button);
  });
}

function showProfileViewerPhoto(index, direction = 0) {
  if (!profilePhotoViewerPhotos.length) return;
  const nextIndex = Math.max(0, Math.min(profilePhotoViewerPhotos.length - 1, index));
  const changed = nextIndex !== profilePhotoIndex;
  profilePhotoIndex = nextIndex;
  setProfilePhotoZoom(false);
  profilePhotoCounter.textContent = `${profilePhotoIndex + 1} / ${profilePhotoViewerPhotos.length}`;
  profilePhotoViewer.classList.add('is-loading');
  profilePhotoImage.src = profilePhotoViewerPhotos[profilePhotoIndex];
  profilePhotoImage.alt = `Profile photo ${profilePhotoIndex + 1}`;
  [...profilePhotoThumbs.children].forEach((thumb, thumbIndex) => {
    thumb.classList.toggle('is-active', thumbIndex === profilePhotoIndex);
  });
  centerActiveProfileThumb(changed);
  if (changed && direction) {
    profilePhotoImageShell.animate([
      { transform: `translate3d(${direction * 100}%,0,0)`, opacity: .72 },
      { transform: 'translate3d(0,0,0)', opacity: 1 }
    ], { duration: 250, easing: 'cubic-bezier(.22,.78,.22,1)' });
  }
}

profilePhotoImage.addEventListener('load', () => profilePhotoViewer.classList.remove('is-loading'));
profilePhotoImage.addEventListener('error', () => profilePhotoViewer.classList.remove('is-loading'));

function animateProfilePhotoFromAvatar(opening, done) {
  const viewerRect = profilePhotoViewer.getBoundingClientRect();
  const avatarRect = profileAvatarButton.getBoundingClientRect();
  if (!viewerRect.width || !avatarRect.width) {
    done?.();
    return;
  }
  const sourceX = avatarRect.left + avatarRect.width / 2 - (viewerRect.left + viewerRect.width / 2);
  const sourceY = avatarRect.top + avatarRect.height / 2 - (viewerRect.top + viewerRect.height / 2);
  const sourceScale = avatarRect.width / Math.max(viewerRect.width, viewerRect.height);
  const sourceFrame = { transform: `translate3d(${sourceX}px,${sourceY}px,0) scale(${sourceScale})`, borderRadius: '50%', opacity: .72 };
  const fullFrame = { transform: 'translate3d(0,0,0) scale(1)', borderRadius: '0', opacity: 1 };
  const animation = profilePhotoImageShell.animate(opening ? [sourceFrame, fullFrame] : [fullFrame, sourceFrame], {
    duration: 300,
    easing: 'cubic-bezier(.22,.78,.22,1)',
    fill: 'forwards'
  });
  animation.addEventListener('finish', () => {
    animation.cancel();
    done?.();
  }, { once: true });
}

function openProfilePhotoViewer() {
  if (!currentProfilePhotos.length || profilePhotoClosing) return;
  window.clearTimeout(profilePhotoClearTimer);
  profilePhotoViewerPhotos = [...currentProfilePhotos];
  profilePhotoViewerOwn = currentProfileIsOwn;
  profilePhotoIndex = 0;
  setProfilePhotoZoom(false);
  renderProfilePhotoThumbs();
  showProfileViewerPhoto(0);
  profilePhotoViewer.classList.add('is-open');
  profilePhotoViewer.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    centerActiveProfileThumb(false);
    animateProfilePhotoFromAvatar(true);
  });
}

function finishClosingProfilePhotoViewer() {
  profilePhotoImageShell.getAnimations().forEach(animation => animation.cancel());
  profilePhotoBackdrop.getAnimations().forEach(animation => animation.cancel());
  profilePhotoViewer.classList.remove('is-open', 'has-thumbs', 'is-dragging');
  profilePhotoViewer.setAttribute('aria-hidden', 'true');
  profilePhotoBackdrop.style.opacity = '';
  profilePhotoImageShell.style.transform = '';
  profilePhotoImageShell.style.opacity = '';
  setProfilePhotoZoom(false);
  profilePhotoClosing = false;
  profilePhotoClearTimer = window.setTimeout(() => {
    profilePhotoImage.src = '';
    profilePhotoImage.alt = '';
    profilePhotoThumbs.replaceChildren();
  }, 220);
}

function closeProfilePhotoViewer(animated = true) {
  if (!profilePhotoViewer.classList.contains('is-open') || profilePhotoClosing) return;
  closeProfilePhotoMenu();
  setProfilePhotoZoom(false);
  profilePhotoClosing = true;
  if (animated) animateProfilePhotoFromAvatar(false, finishClosingProfilePhotoViewer);
  else finishClosingProfilePhotoViewer();
}

/* Улетает в ту сторону, куда смахнули: вниз при distance > 0, вверх при < 0 */
function dismissProfilePhotoAway(distance) {
  if (profilePhotoClosing) return;
  closeProfilePhotoMenu();
  setProfilePhotoZoom(false);
  profilePhotoClosing = true;
  const viewerHeight = profilePhotoViewer.getBoundingClientRect().height;
  const end = distance < 0 ? -viewerHeight : viewerHeight;
  profilePhotoImageShell.animate([
    { transform: `translate3d(0,${distance}px,0) scale(.94)`, opacity: 1 },
    { transform: `translate3d(0,${end}px,0) scale(.85)`, opacity: .25 }
  ], { duration: 220, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'forwards' });
  const fade = profilePhotoBackdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
  fade.addEventListener('finish', finishClosingProfilePhotoViewer, { once: true });
}

function closeProfilePhotoMenu() {
  profilePhotoMenu.classList.remove('is-open');
  profilePhotoMenu.setAttribute('aria-hidden', 'true');
}

function setOwnPhotoAsAvatar() {
  const selected = profilePhotoViewerPhotos[profilePhotoIndex];
  const imageIndex = profileImages.findIndex(image => !image.processing && image.src === selected);
  if (imageIndex <= 0) return;
  const [item] = profileImages.splice(imageIndex, 1);
  profileImages.unshift(item);
  renderProfileImages();
  syncOwnProfilePhotos();
  profilePhotoViewerPhotos = [...currentProfilePhotos];
  profilePhotoIndex = 0;
  renderProfilePhotoThumbs();
  showProfileViewerPhoto(0);
}

function deleteOwnProfilePhoto() {
  const selected = profilePhotoViewerPhotos[profilePhotoIndex];
  const imageIndex = profileImages.findIndex(image => !image.processing && image.src === selected);
  if (imageIndex < 0) return;
  profileImages.splice(imageIndex, 1);
  renderProfileImages();
  syncOwnProfilePhotos();
  profilePhotoViewerPhotos = [...currentProfilePhotos];
  if (!profilePhotoViewerPhotos.length) {
    closeProfilePhotoViewer(false);
    return;
  }
  profilePhotoIndex = Math.min(profilePhotoIndex, profilePhotoViewerPhotos.length - 1);
  renderProfilePhotoThumbs();
  showProfileViewerPhoto(profilePhotoIndex);
}

function openProfilePhotoMenu() {
  profilePhotoMenuSheet.innerHTML = profilePhotoViewerOwn
    ? '<button type="button" data-photo-action="avatar">Set as avatar</button><button type="button" data-photo-action="save">Save</button><button type="button" data-photo-action="delete">Delete</button><button class="feed-menu__cancel" type="button" data-photo-action="cancel">Cancel</button>'
    : '<button type="button" data-photo-action="share">Share</button><button type="button" data-photo-action="save">Save</button><button type="button" data-photo-action="report">Report</button><button class="feed-menu__cancel" type="button" data-photo-action="cancel">Cancel</button>';
  profilePhotoMenu.classList.add('is-open');
  profilePhotoMenu.setAttribute('aria-hidden', 'false');
}

profilePhotoMenuSheet.addEventListener('click', event => {
  const action = event.target.closest('[data-photo-action]')?.dataset.photoAction;
  if (!action) return;
  if (action === 'avatar') setOwnPhotoAsAvatar();
  if (action === 'delete') deleteOwnProfilePhoto();
  if (action === 'share' && navigator.share) navigator.share({ title: 'Profile photo', url: profilePhotoViewerPhotos[profilePhotoIndex] }).catch(() => {});
  closeProfilePhotoMenu();
});
profilePhotoMenu.querySelectorAll('[data-profile-photo-menu-close]').forEach(button => button.addEventListener('click', closeProfilePhotoMenu));
profilePhotoMore.addEventListener('click', openProfilePhotoMenu);
profilePhotoClose.addEventListener('click', () => closeProfilePhotoViewer());
profileAvatarButton.addEventListener('click', openProfilePhotoViewer);

profilePhotoStage.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.target.closest('button') || profilePhotoZoomed) return;
  const rect = profilePhotoViewer.getBoundingClientRect();
  profilePhotoGesture = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
    axis: null,
    edge: event.clientX - rect.left <= 24,
    moved: false
  };
  profilePhotoStage.setPointerCapture?.(event.pointerId);
});

profilePhotoStage.addEventListener('pointermove', event => {
  if (!profilePhotoGesture || event.pointerId !== profilePhotoGesture.pointerId) return;
  const dx = event.clientX - profilePhotoGesture.x;
  const dy = event.clientY - profilePhotoGesture.y;
  if (!profilePhotoGesture.axis && Math.hypot(dx, dy) > 7) {
    profilePhotoGesture.axis = profilePhotoGesture.edge || Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    profilePhotoGesture.moved = true;
  }
  if (!profilePhotoGesture.axis) return;
  event.preventDefault();
  profilePhotoViewer.classList.add('is-dragging');
  if (profilePhotoGesture.axis === 'y') {
    // смахнуть можно и вниз, и вверх
    const distance = dy;
    const localDistance = Math.abs(distance);
    const scale = Math.max(.85, 1 - localDistance / 800);
    profilePhotoImageShell.style.transform = `translate3d(0,${distance}px,0) scale(${scale})`;
    profilePhotoBackdrop.style.opacity = String(Math.max(0, 1 - localDistance / 260));
    return;
  }
  let distance = dx;
  if (!profilePhotoGesture.edge && ((profilePhotoIndex === 0 && dx > 0) || (profilePhotoIndex === profilePhotoViewerPhotos.length - 1 && dx < 0))) distance = 0;
  profilePhotoImageShell.style.transform = `translate3d(${distance}px,0,0)`;
});

function settleProfilePhotoGesture(event, cancelled = false) {
  if (!profilePhotoGesture || event.pointerId !== profilePhotoGesture.pointerId) return;
  const gesture = profilePhotoGesture;
  profilePhotoGesture = null;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  const localX = dx;
  const localY = dy;
  const velocity = localY / Math.max(16, performance.now() - gesture.time) * 1000;
  profilePhotoSuppressTap = gesture.moved;
  profilePhotoViewer.classList.remove('is-dragging');
  profilePhotoImageShell.style.transform = '';
  profilePhotoBackdrop.style.opacity = '';
  if (cancelled) return;
  if (gesture.edge && dx > 70 && Math.abs(dx) > Math.abs(dy)) {
    closeProfilePhotoViewer();
    return;
  }
  if (gesture.axis === 'y' && (Math.abs(localY) > 120 || Math.abs(velocity) > 850)) {
    dismissProfilePhotoAway(dy);
    return;
  }
  if (gesture.axis === 'x' && Math.abs(localX) > 54) {
    const direction = localX < 0 ? 1 : -1;
    const next = profilePhotoIndex + direction;
    if (next >= 0 && next < profilePhotoViewerPhotos.length) showProfileViewerPhoto(next, direction);
  }
}

profilePhotoStage.addEventListener('pointerup', event => settleProfilePhotoGesture(event));
profilePhotoStage.addEventListener('pointercancel', event => settleProfilePhotoGesture(event, true));
profilePhotoStage.addEventListener('click', event => {
  if (profilePhotoSuppressTap) {
    profilePhotoSuppressTap = false;
    return;
  }
  const now = performance.now();
  if (now - profilePhotoLastTap < 320) {
    setProfilePhotoZoom(!profilePhotoZoomed, event.clientX, event.clientY);
    profilePhotoLastTap = 0;
    return;
  }
  profilePhotoLastTap = now;
});

document.addEventListener('keydown', event => {
  if (!profilePhotoViewer.classList.contains('is-open')) return;
  if (event.key === 'Escape') closeProfilePhotoViewer();
  if (!profilePhotoZoomed && event.key === 'ArrowLeft') showProfileViewerPhoto(profilePhotoIndex - 1, -1);
  if (!profilePhotoZoomed && event.key === 'ArrowRight') showProfileViewerPhoto(profilePhotoIndex + 1, 1);
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
let currentProfileVideos = PROFILE_REEL_MEDIA;

function renderProfileVideoGrid(videos) {
  videoGrid.replaceChildren();
  videos.forEach((clip, index) => appendMediaCard(videoGrid, {
    image: clip.posterURL,
    kind: 'video'
  }, index));
}

function setProfileVideos(videos) {
  currentProfileVideos = videos.slice(0, 5);
  renderProfileVideoGrid(currentProfileVideos);
  resetProfileReelData(currentProfileVideos);
}

renderProfileVideoGrid(currentProfileVideos);

export { currentProfileVideos, setProfileVideos };
