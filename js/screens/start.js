/* Стартовый экран: бегущая стена фотографий */
import { WALL_PHOTOS } from '../data/photos.js';

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

export { shuffled };
