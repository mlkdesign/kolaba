/* Регистрация, шаг 2: фотографии, описание, соцсети */
import { syncOwnProfilePhotos } from '../screens/profile.js';

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
  window.setTimeout(() => {
    renderProfileImages();
    syncOwnProfilePhotos();
  }, 250);
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
  window.renderSettingsProfileImages?.();
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
    syncOwnProfilePhotos();
  }).catch(() => {
    const index = profileImages.findIndex(image => image.id === item.id);
    if (index >= 0) profileImages.splice(index, 1);
    renderProfileImages();
    syncOwnProfilePhotos();
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

export { PROFILE_IMAGE_LIMIT, bio, openProfileImagePicker, profileImages, removeProfileImage, renderProfileImages };
