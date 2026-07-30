/* Лента видео и ролики автора */
import { show } from '../core/router.js';
import { state } from '../core/state.js';
import { PROFILE_REEL_MEDIA, UNIQUE_VERTICAL_VIDEO_LIBRARY, VIDEO_HOLD_DELAY, compactMetric, generatedProfilePhotos, normalizedAuthorPhotos, updateVideoProgress } from '../data/catalog.js';
import { DEFAULT_AVATAR_URL } from '../data/photos.js';
import { openExternalProfile, profileAvatar, profilePage } from '../screens/profile.js';
import { shuffled } from '../screens/start.js';
import { currentProfileVideos } from '../ui/photo-viewer.js';
import { countryByCode, flagFor } from '../ui/picker.js';
import { play as playVideo } from '../ui/video.js';

/* ── Полноэкранная вертикальная лента видео ── */
const FEED_PROFILE_COUNT = 20;
const FEED_CLIPS_PER_PROFILE = 5;
const ownProfileVideoIds = new Set(PROFILE_REEL_MEDIA.map(video => video.id));
const FEED_CATALOG = shuffled(UNIQUE_VERTICAL_VIDEO_LIBRARY.filter(video => !ownProfileVideoIds.has(video.id)));
let feedCatalogCursor = 0;

function takeUniqueFeedVideos(amount) {
  if (feedCatalogCursor + amount > FEED_CATALOG.length) return [];
  const videos = FEED_CATALOG.slice(feedCatalogCursor, feedCatalogCursor + amount);
  feedCatalogCursor += amount;
  return videos;
}

/* ── Горизонтальная лента роликов, открываемая из профиля ── */
const profileReelStage = document.getElementById('profileReelStage');
const profileReelClips = document.getElementById('profileReelClips');
const profileReelPosition = document.getElementById('profileReelPosition');
const profileReelLike = document.getElementById('profileReelLike');
const profileReelMenu = document.getElementById('profileReelMenu');
const profileReelProgress = document.getElementById('profileReelProgress');
const makeProfileReelData = videos => videos.map((video, index) => ({
  ...video,
  likes: Math.floor(Math.random() * 14951) + 50,
  views: Math.floor(Math.random() * 119801) + 200,
  liked: false,
  viewedSession: false,
  index
}));
let profileReelData = makeProfileReelData(currentProfileVideos);
let profileReelIndex = 0;
let profileReelFollowing = false;
let profileReelExpanded = false;
let profileReelLastGesture = 0;

function pauseProfileReels() {
  window.clearTimeout(window.__profileReelViewTimer);
  document.querySelectorAll('#profileReelClips video').forEach(video => video.pause());
}

function bindProfileReelVideo(video, index) {
  const page = video.closest('.profile-reel-clip');
  video.addEventListener('loadeddata', () => page.classList.add('is-ready'));
  video.addEventListener('playing', () => {
    if (index === profileReelIndex) scheduleProfileReelView(video, index);
  });
  video.addEventListener('timeupdate', () => {
    if (index === profileReelIndex) updateVideoProgress(profileReelProgress, video);
  });
  video.addEventListener('error', () => page.classList.add('is-ready', 'is-video-error'));
}

function renderProfileReelClips() {
  profileReelClips.innerHTML = profileReelData.map(clip => `
    <div class="profile-reel-clip" data-reel-index="${clip.index}">
      <video class="feed-video" muted loop playsinline webkit-playsinline preload="none"
             poster="${clip.posterURL}" data-src="${clip.videoURL}"></video>
      <span class="feed-loading" aria-hidden="true"></span>
    </div>`).join('');
  profileReelClips.querySelectorAll('video').forEach(bindProfileReelVideo);
}

function resetProfileReelData(videos) {
  pauseProfileReels();
  profileReelData = makeProfileReelData(videos);
  profileReelIndex = 0;
  profileReelClips.style.transform = '';
  renderProfileReelClips();
  renderProfileReelPosition(0);
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
  video.muted = !state.videoSoundEnabled;
  playVideo(video);
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
  const reelWidth = profileReelClips.clientWidth || profileReelStage.clientWidth || 1;
  if (Math.round(profileReelClips.scrollLeft / reelWidth) !== nextIndex) {
    profileReelClips.scrollTo({ left: nextIndex * reelWidth, behavior: reset ? 'smooth' : 'auto' });
  }
  ensureProfileReelMedia(nextIndex);
  updateProfileReelOverlay();
  updateVideoProgress(profileReelProgress, profileReelClips.querySelectorAll('video')[nextIndex]);
  renderProfileReelPosition(nextIndex);
  playProfileReel(reset);
}

/* Полоска позиции едет за пальцем по событию scroll, активный ролик
   определяется по позиции прилипания. */
let profileReelSettleTimer = 0;
profileReelClips.addEventListener('scroll', () => {
  const width = profileReelClips.clientWidth || 1;
  const progress = profileReelClips.scrollLeft / width;
  renderProfileReelPosition(progress);
  profileReelLastGesture = performance.now();
  window.clearTimeout(profileReelSettleTimer);
  profileReelSettleTimer = window.setTimeout(() => {
    const index = Math.max(0, Math.min(4, Math.round(progress)));
    if (index !== profileReelIndex) activateProfileReel(index, true);
  }, 90);
}, { passive: true });

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

renderProfileReelClips();

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
  const button = event.currentTarget;
  button.classList.toggle('is-following', profileReelFollowing);
  button.classList.remove('is-bouncing');
  void button.offsetWidth;
  button.classList.add('is-bouncing');
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

const profileReelGesture = {
  pointerId: null, axis: null, startX: 0, startY: 0, deltaX: 0, deltaY: 0,
  holdTimer: null, holdActive: false, wasPlaying: false
};
profileReelStage.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.target.closest('button')) return;
  profileReelGesture.pointerId = event.pointerId;
  profileReelGesture.axis = null;
  profileReelGesture.startX = event.clientX;
  profileReelGesture.startY = event.clientY;
  profileReelGesture.deltaX = 0;
  profileReelGesture.deltaY = 0;
  profileReelGesture.holdActive = false;
  profileReelGesture.wasPlaying = false;
  window.clearTimeout(profileReelGesture.holdTimer);
  profileReelGesture.holdTimer = window.setTimeout(() => {
    if (profileReelGesture.pointerId !== event.pointerId || profileReelGesture.axis) return;
    const video = profileReelClips.querySelectorAll('video')[profileReelIndex];
    if (!video) return;
    profileReelGesture.holdActive = true;
    profileReelGesture.wasPlaying = !video.paused;
    video.pause();
  }, VIDEO_HOLD_DELAY);
  profileReelStage.setPointerCapture?.(event.pointerId);
});
profileReelStage.addEventListener('pointermove', event => {
  if (event.pointerId !== profileReelGesture.pointerId) return;
  if (profileReelGesture.holdActive) {
    event.preventDefault();
    return;
  }
  const deltaX = event.clientX - profileReelGesture.startX;
  const deltaY = event.clientY - profileReelGesture.startY;
  if (!profileReelGesture.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 6) {
    window.clearTimeout(profileReelGesture.holdTimer);
    profileReelGesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
  }
  // Горизонталь листает сам скроллер со scroll-snap, JS остаётся только смахивание вниз
  if (profileReelGesture.axis !== 'vertical') return;
  event.preventDefault();
  profileReelLastGesture = performance.now();
  profileReelGesture.deltaX = deltaX;
  profileReelGesture.deltaY = deltaY;
  profileReelStage.style.transform = `translateY(${deltaY}px)`;
  profileReelStage.style.opacity = String(Math.max(.45, 1 - Math.abs(deltaY) / 420));
});

function finishProfileReelGesture(event) {
  if (event.pointerId !== profileReelGesture.pointerId) return;
  window.clearTimeout(profileReelGesture.holdTimer);
  if (profileReelGesture.holdActive) {
    const video = profileReelClips.querySelectorAll('video')[profileReelIndex];
    const shouldResume = profileReelGesture.wasPlaying;
    profileReelGesture.pointerId = null;
    profileReelGesture.axis = null;
    profileReelGesture.holdActive = false;
    profileReelGesture.wasPlaying = false;
    profileReelLastGesture = performance.now();
    if (shouldResume && video) playVideo(video);
    return;
  }
  const { axis, deltaY } = profileReelGesture;
  profileReelGesture.pointerId = null;
  profileReelGesture.axis = null;
  if (axis === 'vertical' && Math.abs(deltaY) >= 70) {
    closeProfileReels();
    return;
  }
  profileReelStage.style.transform = '';
  profileReelStage.style.opacity = '';
  if (axis === 'vertical') playProfileReel(false);
}
profileReelStage.addEventListener('pointerup', finishProfileReelGesture);
profileReelStage.addEventListener('pointercancel', finishProfileReelGesture);
profileReelStage.addEventListener('contextmenu', event => {
  if (!event.target.closest('button')) event.preventDefault();
});

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
    state.videoSoundEnabled = !state.videoSoundEnabled;
    video.muted = !state.videoSoundEnabled;
  }, 230);
});

renderProfileReelPosition(0);

const FEED_PROFILE_BIOS = [
  'Travel and lifestyle UGC creator crafting warm, authentic stories for hotels, villas and modern brands ✨',
  'Fashion and beauty creator based in Barcelona. I make polished content that still feels natural and personal.',
  'Lifestyle UGC creator helping brands turn everyday moments into relatable social content.',
  'Paris-based beauty and fashion creator with a love for clean visuals, soft light and honest storytelling.',
  'UGC creator focused on beauty, wellness and lifestyle campaigns for bold, people-first brands.',
  'Amsterdam creator making calm lifestyle, home and travel content with an editorial touch.',
  'Seoul-based beauty and fashion creator producing modern vertical content for global brands.',
  'Fashion, food and lifestyle storyteller from Milan. Available for UGC campaigns across Europe.',
  'Berlin UGC creator specializing in minimal lifestyle, skincare and product-focused content.',
  'London-based creator making confident fashion, beauty and everyday lifestyle content.',
  'Travel and menswear creator producing energetic, natural UGC for hospitality and fashion brands.',
  'French lifestyle creator focused on travel, food and premium hospitality collaborations.',
  'Madrid-based menswear and lifestyle creator with a clean, cinematic visual style.',
  'New York UGC creator working across fashion, fitness and modern lifestyle campaigns.',
  'Brussels creator making approachable menswear, technology and city-lifestyle content.',
  'Lifestyle and travel creator based in Singapore, available for hospitality and brand collaborations.',
  'Tokyo beauty and lifestyle creator combining playful concepts with refined visual storytelling.',
  'Dubai-based fashion and luxury lifestyle creator producing premium social-first content.',
  'Lisbon UGC creator inspired by travel, food, natural light and slow everyday moments.',
  'Copenhagen lifestyle creator specializing in interiors, wellness and sustainable brands.',
  'Beauty and fashion creator from Bucharest making expressive, conversion-focused UGC.',
  'Prague-based creator producing friendly lifestyle, café and travel content for social media.',
  'Sydney travel and fitness creator capturing energetic outdoor stories for modern brands.',
  'Warsaw menswear and lifestyle creator with a focus on authentic, understated brand content.'
];

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
].map(([name, portrait, countryCode, city], index) => ({
  name,
  avatarURL: `https://randomuser.me/api/portraits/${portrait}.jpg`,
  countryCode,
  city,
  bio: FEED_PROFILE_BIOS[index % FEED_PROFILE_BIOS.length]
}));

const feed = document.getElementById('feed');
const feedPosition = document.getElementById('feedPosition');
const feedMenu = document.getElementById('feedMenu');
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

function makeFeedProfile(author) {
  const profileIndex = feedProfileSequence++;
  const videos = takeUniqueFeedVideos(FEED_CLIPS_PER_PROFILE);
  if (videos.length < FEED_CLIPS_PER_PROFILE) return null;
  const profileAuthor = {
    ...author,
    photos: normalizedAuthorPhotos(author),
    videos
  };
  return {
    id: `feed-profile-${profileIndex}`,
    author: profileAuthor,
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
  const authorNameButton = card.querySelector('.feed-author-name');
  authorNameButton.textContent = author.name;
  authorNameButton.setAttribute('aria-label', `Open ${author.name} profile`);
  card.querySelector('.feed-flag').textContent = flagFor(author.countryCode);
  card.querySelector('.feed-city').textContent = `${author.city}, ${countryByCode(author.countryCode)?.name || author.countryCode}`;
  card.querySelector('.feed-caption').textContent = author.bio;
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
  video.muted = !state.videoSoundEnabled;
  playVideo(video);
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
      <video class="feed-video" muted loop playsinline webkit-playsinline preload="none"
             poster="${clip.posterURL}" data-src="${clip.videoURL}"></video>
      <span class="feed-loading" aria-hidden="true"></span>
    </div>`).join('');
  card.innerHTML = `
    <div class="feed-clips" aria-label="${FEED_CLIPS_PER_PROFILE} videos by ${profile.author.name}">${clips}</div>
    <span class="feed-heart-burst" aria-hidden="true"></span>
    <div class="feed-progress" aria-hidden="true"><i></i></div>
    <div class="feed-content">
      <div class="feed-author-row">
        <button class="feed-avatar-button" type="button" aria-label="Open ${profile.author.name} profile">
          <img class="feed-avatar" src="${profile.author.avatarURL}" alt="${profile.author.name}">
        </button>
        <div class="feed-author">
          <button class="feed-author-name" type="button" aria-label="Open ${profile.author.name} profile">${profile.author.name}</button>
          <span class="feed-place"><span class="feed-flag">${flagFor(profile.author.countryCode)}</span><span class="feed-city">${profile.author.city}, ${countryByCode(profile.author.countryCode)?.name || profile.author.countryCode}</span></span>
        </div>
        <div class="feed-actions">
          <button class="feed-like glass" type="button" aria-label="Like"><span class="feed-like__icon"></span><b>${compactMetric(profile.clips[0].likes)}</b></button>
          <button class="feed-follow" type="button" aria-label="Follow"><img class="feed-follow__plus" src="assets/icons/FeedPlus.svg" alt=""><img class="feed-follow__check" src="assets/icons/Check.svg" alt=""></button>
        </div>
      </div>
      <p class="feed-caption">${profile.author.bio}</p>
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

  /* Листание — нативное: вертикально по .feed, горизонтально по .feed-clips,
     оба со scroll-snap. От указателя нужен только долгий тап: он ставит ролик
     на паузу, пока палец прижат. */
  const hold = { pointerId: null, timer: 0, active: false, wasPlaying: false, x: 0, y: 0 };

  const releaseHold = resume => {
    window.clearTimeout(hold.timer);
    const video = card.querySelectorAll('.feed-video')[profile.activeClipIndex];
    const shouldResume = hold.active && hold.wasPlaying && resume;
    hold.pointerId = null;
    hold.active = false;
    hold.wasPlaying = false;
    profile.lastGestureAt = performance.now();
    if (shouldResume && feedProfiles[activeFeedIndex] === profile && video) playVideo(video);
  };

  card.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.target.closest('button')) return;
    hold.pointerId = event.pointerId;
    hold.x = event.clientX;
    hold.y = event.clientY;
    hold.active = false;
    hold.wasPlaying = false;
    window.clearTimeout(hold.timer);
    hold.timer = window.setTimeout(() => {
      if (hold.pointerId !== event.pointerId) return;
      const video = card.querySelectorAll('.feed-video')[profile.activeClipIndex];
      if (!video) return;
      hold.active = true;
      hold.wasPlaying = !video.paused;
      video.pause();
    }, VIDEO_HOLD_DELAY);
  }, { passive: true });

  card.addEventListener('pointermove', event => {
    if (event.pointerId !== hold.pointerId || hold.active) return;
    // палец поехал — это листание, а не удержание
    if (Math.max(Math.abs(event.clientX - hold.x), Math.abs(event.clientY - hold.y)) > 6) {
      window.clearTimeout(hold.timer);
      hold.pointerId = null;
    }
  }, { passive: true });

  card.addEventListener('pointerup', () => releaseHold(true), { passive: true });
  card.addEventListener('pointercancel', () => releaseHold(false), { passive: true });
  card.addEventListener('contextmenu', event => {
    if (!event.target.closest('button')) event.preventDefault();
  });

  card.querySelector('.feed-avatar').addEventListener('error', event => {
    event.currentTarget.src = DEFAULT_AVATAR_URL;
  }, { once: true });

  card.querySelectorAll('.feed-avatar-button, .feed-author-name').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      openExternalProfile(profile.author);
    });
  });

  card.querySelector('.feed-like').addEventListener('click', () => {
    const clip = profile.clips[profile.activeClipIndex];
    setFeedLiked(profile, card, !clip.liked);
  });

  card.querySelector('.feed-follow').addEventListener('click', event => {
    profile.following = !profile.following;
    const button = event.currentTarget;
    button.classList.toggle('is-following', profile.following);
    button.setAttribute('aria-label', profile.following ? 'Following' : 'Follow');
    button.classList.remove('is-bouncing');
    void button.offsetWidth;
    button.classList.add('is-bouncing');
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
    if (event.detail >= 2) {
      window.clearTimeout(singleTapTimer);
      setFeedLiked(profile, card, true, true);
      return;
    }
    singleTapTimer = window.setTimeout(() => {
      state.videoSoundEnabled = !state.videoSoundEnabled;
      video.muted = !state.videoSoundEnabled;
    }, 230);
  });

  return card;
}

function appendFeedBatch(amount = 10) {
  const authors = shuffled(FALLBACK_AUTHORS);
  let previousAuthor = feedProfiles.at(-1)?.author.name;

  for (let index = 0; index < amount; index++) {
    let author = authors[index % authors.length];
    if (author.name === previousAuthor) author = authors[(index + 1) % authors.length];
    previousAuthor = author.name;
    const profile = makeFeedProfile(author);
    if (!profile) break;
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

}

const feedObserver = new IntersectionObserver(entries => {
  const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible || visible.intersectionRatio < .65) return;
  const cards = [...feed.querySelectorAll('.feed-card')];
  activateFeedIndex(cards.indexOf(visible.target));
}, { root: feed, threshold: [.65, .8, 1] });

/* Вертикальная лента листается нативно (scroll-snap: y mandatory).
   Активную карточку определяем по позиции скролла, а не по жесту. */
let feedSettleTimer = 0;
feed.addEventListener('scroll', () => {
  window.clearTimeout(feedSettleTimer);
  feedSettleTimer = window.setTimeout(() => {
    const cardHeight = feed.querySelector('.feed-card')?.clientHeight || feed.clientHeight;
    if (!cardHeight || !feedProfiles.length) return;
    const index = Math.max(0, Math.min(feedProfiles.length - 1, Math.round(feed.scrollTop / cardHeight)));
    if (index !== activeFeedIndex) activateFeedIndex(index);
  }, 90);
}, { passive: true });

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

appendFeedBatch(FEED_PROFILE_COUNT);

let feedWheelWrapLocked = false;
feed.addEventListener('wheel', event => {
  if (feedWheelWrapLocked || !feedProfiles.length) return;
  const lastIndex = feedProfiles.length - 1;
  const targetIndex = activeFeedIndex === lastIndex && event.deltaY > 18
    ? 0
    : activeFeedIndex === 0 && event.deltaY < -18
      ? lastIndex
      : null;
  if (targetIndex === null) return;
  event.preventDefault();
  feedWheelWrapLocked = true;
  const cardHeight = feed.querySelector('.feed-card')?.clientHeight || feed.clientHeight;
  feed.scrollTo({ top: targetIndex * cardHeight, behavior: 'auto' });
  activateFeedIndex(targetIndex);
  window.setTimeout(() => { feedWheelWrapLocked = false; }, 350);
}, { passive: false });

// Random User дополняет статический каталог; при ошибке уже отрисованные fallback-авторы остаются.
fetch('https://randomuser.me/api/?results=30&inc=name,picture,nat,location')
  .then(response => response.ok ? response.json() : Promise.reject(new Error('Random User unavailable')))
  .then(data => {
    const authors = data.results.map((person, index) => {
      const avatarURL = person.picture.large;
      return {
        name: `${person.name.first} ${person.name.last}`,
        avatarURL,
        photos: generatedProfilePhotos(avatarURL, index),
        countryCode: person.nat,
        city: person.location.city,
        bio: FEED_PROFILE_BIOS[index % FEED_PROFILE_BIOS.length]
      };
    });
    if (!authors.length) return;
    feedProfiles.slice(0, FEED_PROFILE_COUNT).forEach((profile, index) => {
      profile.author = { ...authors[index % authors.length], videos: profile.author.videos };
      const card = feed.querySelector(`[data-feed-id="${profile.id}"]`);
      if (card) updateFeedAuthor(card, profile);
    });
  })
  .catch(() => {});

export { openProfileReels, pauseFeed, pauseProfileReels, resetProfileReelData, resumeActiveFeed };
