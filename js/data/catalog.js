/* Тематический каталог видео и фотографий */
import { THEMED_PHOTO_IDS } from '../data/photos.js';
import { swipeToDismiss } from '../ui/dismiss.js';

/* ── Общий тематический Pexels-каталог для профиля, ленты и проектов ── */
const PEXELS_PHOTO_IDS = Object.values(THEMED_PHOTO_IDS).flat();

const PROFILE_PHOTOS = PEXELS_PHOTO_IDS.map((id, index) => ({
  image: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=480&h=480`,
  fullImage: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200`,
  source: `https://www.pexels.com/photo/${id}/`,
  alt: `Pexels photo ${index + 1}`,
  kind: 'photo'
}));

function generatedProfilePhotos(avatarURL, seed = 0) {
  if (!avatarURL) return [];
  const photos = [avatarURL];
  for (let offset = 0; photos.length < 5 && offset < PROFILE_PHOTOS.length; offset += 1) {
    const photo = PROFILE_PHOTOS[(seed * 5 + offset) % PROFILE_PHOTOS.length]?.fullImage;
    if (photo && !photos.includes(photo)) photos.push(photo);
  }
  return photos;
}

function normalizedAuthorPhotos(author) {
  const avatar = author?.avatarURL || author?.photos?.[0];
  const supplied = Array.isArray(author?.photos) ? author.photos.filter(Boolean) : [];
  const photos = [avatar, ...supplied.filter(photo => photo !== avatar)].filter(Boolean).slice(0, 5);
  const generated = generatedProfilePhotos(avatar, Math.abs((author?.name || '').length + photos.length));
  generated.forEach(photo => {
    if (photos.length < 5 && !photos.includes(photo)) photos.push(photo);
  });
  return photos;
}

const THEMATIC_VIDEO_LIBRARY = [
  ['31223575', 'model', 'https://videos.pexels.com/video-files/31223575/13336360_2160_3840_30fps.mp4', 19222080, 2160, 3840],
  ['31223577', 'model', 'https://videos.pexels.com/video-files/31223577/13336324_2160_3840_30fps.mp4', 774909, 2160, 3840],
  ['36183530', 'restaurant', 'https://videos.pexels.com/video-files/36183530/15345291_1080_1920_30fps.mp4', 13085892, 1080, 1920],
  ['6060027', 'restaurant', 'https://videos.pexels.com/video-files/6060027/6060027-hd_1080_1920_25fps.mp4', 13369643, 1080, 1920],
  ['36371109', 'villa', 'https://videos.pexels.com/video-files/36371109/15425909_1080_1920_60fps.mp4', 34378030, 1080, 1920],
  ['30790272', 'girlBeach', 'https://videos.pexels.com/video-files/30790272/13169804_1080_1920_60fps.mp4', 9872346, 1080, 1920],
  ['6004106', 'girlBeach', 'https://videos.pexels.com/video-files/6004106/6004106-hd_720_1280_30fps.mp4', 16398000, 720, 1280],
  ['5728442', 'girlDog', 'https://videos.pexels.com/video-files/5728442/5728442-hd_1080_1920_24fps.mp4', 15759038, 1080, 1920],
  ['8170819', 'girlDog', 'https://videos.pexels.com/video-files/8170819/8170819-hd_1080_1920_25fps.mp4', 6827310, 1080, 1920],
  ['31574448', 'stylishMan', 'https://videos.pexels.com/video-files/31574448/13456035_2160_3840_30fps.mp4', 11513878, 2160, 3840],
  ['8126403', 'stylishMan', 'https://videos.pexels.com/video-files/8126403/8126403-hd_1080_1920_30fps.mp4', 37252810, 1080, 1920],
  ['5834291', 'restaurant', 'https://videos.pexels.com/video-files/5834291/5834291-hd_1080_1920_24fps.mp4', 8993326, 1080, 1920],
  ['7326813', 'stylishMan', 'https://videos.pexels.com/video-files/7326813/7326813-hd_1080_1920_24fps.mp4', 35047322, 1080, 1920],
  ['7413779', 'stylishMan', 'https://videos.pexels.com/video-files/7413779/7413779-hd_1080_1920_24fps.mp4', 32030188, 1080, 1920],
  ['3829084', 'restaurant', 'https://videos.pexels.com/video-files/3829084/3829084-hd_1080_1920_30fps.mp4', 302899, 1080, 1920],
  ['8126404', 'stylishMan', 'https://videos.pexels.com/video-files/8126404/8126404-hd_1080_1920_30fps.mp4', 33680031, 1080, 1920],
  ['8056840', 'model', 'https://videos.pexels.com/video-files/8056840/8056840-hd_1080_1920_25fps.mp4', 1884584, 1080, 1920],
  ['8031642', 'model', 'https://videos.pexels.com/video-files/8031642/8031642-hd_1080_1920_24fps.mp4', 2983464, 1080, 1920],
  ['8456349', 'girlBeach', 'https://videos.pexels.com/video-files/8456349/8456349-hd_1080_1920_30fps.mp4', 6146793, 1080, 1920],
  ['6634626', 'girlDog', 'https://videos.pexels.com/video-files/6634626/6634626-hd_720_1280_50fps.mp4', 11682187, 720, 1280],
  ['7572159', 'girlDog', 'https://videos.pexels.com/video-files/7572159/7572159-hd_1080_1920_25fps.mp4', 4592067, 1080, 1920],
  ['34950655', 'restaurant', 'https://videos.pexels.com/video-files/34950655/14805453_1440_2560_30fps.mp4', 70497, 1440, 2560],
  ['5201403', 'girlBeach', 'https://videos.pexels.com/video-files/5201403/5201403-hd_1080_1920_30fps.mp4', 12889642, 1080, 1920],
  ['6876674', 'girlBeach', 'https://videos.pexels.com/video-files/6876674/6876674-hd_1080_1920_30fps.mp4', 27348311, 1080, 1920],
  ['17982228', 'girlBeach', 'https://videos.pexels.com/video-files/17982228/17982228-hd_1080_1920_40fps.mp4', 20260050, 1080, 1920],
  ['8456031', 'girlBeach', 'https://videos.pexels.com/video-files/8456031/8456031-hd_1080_1920_30fps.mp4', 11836504, 1080, 1920],
  ['8995633', 'girlBeach', 'https://videos.pexels.com/video-files/8995633/8995633-hd_1080_1920_30fps.mp4', 1755428, 1080, 1920],
  ['11748260', 'girlBeach', 'https://videos.pexels.com/video-files/11748260/11748260-hd_720_1280_60fps.mp4', 1391498, 720, 1280]
]
  .filter(([, , , , width, height]) => height * 9 === width * 16)
  .map(([id, category, videoURL, posterId, width, height]) => ({
  id,
  category,
  videoURL,
  posterId,
  width,
  height,
  aspectRatio: '9 / 16',
  posterURL: `https://images.pexels.com/photos/${posterId}/pexels-photo-${posterId}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=720&h=1280`
}));

// Проверенные портретные источники. Вместе с базовым каталогом они дают 105
// разных роликов: 5 для своего профиля и 100 для 20 авторов основной ленты.
const ADDITIONAL_VERTICAL_VIDEO_SOURCES = [
  ['28879317', 'model', '12502250_2160_3840_30fps.mp4'],
  ['19863106', 'model', '19863106-hd_1080_1920_30fps.mp4'],
  ['3894693', 'model', '3894693-hd_1080_2048_25fps.mp4'],
  ['30744211', 'model', '13151593_2160_3840_30fps.mp4'],
  ['31291134', 'model', '13361161_2160_3840_60fps.mp4'],
  ['3894699', 'model', '3894699-hd_1080_2048_25fps.mp4'],
  ['4650265', 'model', '4650265-hd_1080_2048_30fps.mp4'],
  ['27179530', 'model', '12091296_2160_3840_30fps.mp4'],
  ['7315361', 'model', '7315361-hd_1080_1920_25fps.mp4'],
  ['28879304', 'model', '12502274_2160_3840_30fps.mp4'],
  ['19863115', 'model', '19863115-hd_1080_1920_30fps.mp4'],
  ['34373830', 'model', '14561924_2160_3840_30fps.mp4'],
  ['8102715', 'model', '8102715-hd_1080_2048_25fps.mp4'],
  ['31223583', 'model', '13336276_2160_3840_30fps.mp4'],
  ['8478627', 'model', '8478627-hd_1080_1920_24fps.mp4'],
  ['10140479', 'model', '10140479-hd_1080_2048_25fps.mp4'],
  ['27989409', 'model', '12282893_1080_1920_30fps.mp4'],
  ['30744227', 'model', '13151512_2160_3840_30fps.mp4'],
  ['31223568', 'model', '13336378_2160_3840_30fps.mp4'],
  ['31223578', 'model', '13336322_2160_3840_30fps.mp4'],
  ['28879299', 'model', '12502334_2160_3840_30fps.mp4'],
  ['18156308', 'model', '18156308-hd_1080_1920_25fps.mp4'],
  ['5805691', 'girlBeach', '5805691-hd_720_1144_30fps.mp4'],
  ['7850917', 'girlBeach', '7850917-hd_1080_1920_30fps.mp4'],
  ['7849877', 'girlBeach', '7849877-hd_1080_1920_30fps.mp4'],
  ['26756815', 'girlBeach', '12001181_1080_1918_30fps.mp4'],
  ['19724362', 'girlBeach', '19724362-hd_1080_1920_30fps.mp4'],
  ['8456350', 'girlBeach', '8456350-hd_1080_1920_30fps.mp4'],
  ['16409820', 'girlBeach', '16409820-hd_1080_1920_30fps.mp4'],
  ['27847944', 'girlBeach', '12241889_2160_3840_50fps.mp4'],
  ['7764127', 'stylishMan', '7764127-hd_1080_2048_25fps.mp4'],
  ['4878060', 'stylishMan', '4878060-hd_1080_2048_25fps.mp4'],
  ['9371261', 'stylishMan', '9371261-hd_1080_1920_24fps.mp4'],
  ['6474955', 'stylishMan', '6474955-hd_1080_2048_25fps.mp4'],
  ['9953951', 'stylishMan', '9953951-hd_1080_2048_25fps.mp4'],
  ['7426708', 'stylishMan', '7426708-hd_1080_1920_25fps.mp4'],
  ['7576220', 'stylishMan', '7576220-hd_1080_1902_24fps.mp4'],
  ['8296233', 'stylishMan', '8296233-hd_1080_1920_25fps.mp4'],
  ['6987041', 'stylishMan', '6987041-hd_1080_1920_25fps.mp4'],
  ['8346469', 'stylishMan', '8346469-hd_1080_2048_25fps.mp4'],
  ['3206482', 'stylishMan', '3206482-hd_1080_1920_25fps.mp4'],
  ['6626482', 'stylishMan', '6626482-hd_1080_2048_25fps.mp4'],
  ['7326825', 'stylishMan', '7326825-hd_1080_1920_24fps.mp4'],
  ['9154728', 'stylishMan', '9154728-hd_1080_2048_25fps.mp4'],
  ['9488543', 'stylishMan', '9488543-hd_1080_2048_25fps.mp4'],
  ['7189607', 'girlDog', '7189607-hd_1080_1920_25fps.mp4'],
  ['7189583', 'girlDog', '7189583-hd_1080_1920_25fps.mp4'],
  ['5263407', 'girlDog', '5263407-hd_1080_2048_30fps.mp4'],
  ['6318313', 'girlDog', '6318313-hd_1080_2048_25fps.mp4'],
  ['5384347', 'girlDog', '5384347-hd_1080_1920_25fps.mp4'],
  ['6507081', 'girlDog', '6507081-hd_1080_1920_25fps.mp4'],
  ['7189533', 'girlDog', '7189533-hd_1080_1920_25fps.mp4'],
  ['7197715', 'girlDog', '7197715-hd_1080_1920_25fps.mp4'],
  ['10814083', 'girlDog', '10814083-hd_1080_1920_25fps.mp4'],
  ['5384343', 'girlDog', '5384343-hd_1080_1920_25fps.mp4'],
  ['5540192', 'girlDog', '5540192-hd_1080_1920_30fps.mp4'],
  ['30641787', 'restaurant', '13114829_1080_1920_30fps.mp4'],
  ['15545898', 'restaurant', '15545898-hd_1080_1920_60fps.mp4'],
  ['4254064', 'restaurant', '4254064-hd_1080_2048_25fps.mp4'],
  ['37282780', 'restaurant', '15794117_1080_1920_30fps.mp4'],
  ['36418770', 'restaurant', '15442434_1440_2560_50fps.mp4'],
  ['34355147', 'restaurant', '14554585_2160_3840_60fps.mp4'],
  ['10619422', 'restaurant', '10619422-hd_1080_1920_30fps.mp4'],
  ['3795387', 'model', '3795387-hd_1080_2048_25fps.mp4'],
  ['3917703', 'model', '3917703-hd_1080_2048_25fps.mp4'],
  ['3894710', 'model', '3894710-hd_1080_2048_25fps.mp4'],
  ['3894706', 'model', '3894706-hd_1080_2048_25fps.mp4'],
  ['3403327', 'model', '3403327-hd_1080_2048_25fps.mp4'],
  ['3888257', 'model', '3888257-hd_1080_2048_25fps.mp4'],
  ['3795832', 'model', '3795832-hd_1080_2048_25fps.mp4'],
  ['3795655', 'model', '3795655-hd_1080_2048_25fps.mp4'],
  ['29532471', 'restaurant', '12712779_2160_3840_30fps.mp4'],
  ['32937922', 'restaurant', '14038041_2160_3840_30fps.mp4'],
  ['13736691', 'restaurant', '13736691-hd_1080_1920_24fps.mp4'],
  ['6204980', 'restaurant', '6204980-hd_1080_1920_24fps.mp4'],
  ['9154731', 'stylishMan', '9154731-hd_1080_2048_25fps.mp4'],
  ['6770045', 'model', '6770045-hd_1080_1920_25fps.mp4']
];

const ADDITIONAL_VERTICAL_VIDEO_LIBRARY = ADDITIONAL_VERTICAL_VIDEO_SOURCES.map(([id, category, file], index) => {
  const posterPool = THEMED_PHOTO_IDS[category] || THEMED_PHOTO_IDS.model;
  const posterId = posterPool[index % posterPool.length];
  return {
    id,
    category,
    videoURL: `https://videos.pexels.com/video-files/${id}/${file}`,
    posterId,
    width: 1080,
    height: 1920,
    aspectRatio: '9 / 16',
    posterURL: `https://images.pexels.com/photos/${posterId}/pexels-photo-${posterId}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=720&h=1280`
  };
});

const UNIQUE_VERTICAL_VIDEO_LIBRARY = [...THEMATIC_VIDEO_LIBRARY, ...ADDITIONAL_VERTICAL_VIDEO_LIBRARY];
const PROFILE_REEL_MEDIA = UNIQUE_VERTICAL_VIDEO_LIBRARY.slice(0, 5);

const compactMetric = number => number >= 1000
  ? `${(number / 1000).toFixed(number >= 10000 ? 0 : 1).replace('.0', '')}k`
  : String(number);

const VIDEO_HOLD_DELAY = 320;


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

/* Кнопки закрытия на экране нет — закрываем смахиванием вверх или вниз */
swipeToDismiss(mediaViewer, {
  stage: mediaViewerImage,
  backdrop: mediaViewerBackdrop,
  onClose: closePhoto,
  isOpen: () => mediaViewer.classList.contains('is-open')
});
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

export { PROFILE_PHOTOS, PROFILE_REEL_MEDIA, THEMATIC_VIDEO_LIBRARY, UNIQUE_VERTICAL_VIDEO_LIBRARY, VIDEO_HOLD_DELAY, compactMetric, generatedProfilePhotos, mediaStats, normalizedAuthorPhotos, openPhoto, updateVideoProgress };
