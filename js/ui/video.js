/* Воспроизведение видео в браузере.

   Играет только видимый ролик — за этим следит IntersectionObserver.
   play() возвращает промис и на iOS в энергосбережении может быть отклонён:
   тогда показываем постер и центральную кнопку play, по тапу пробуем снова.
   Одновременно «живыми» держим не больше трёх video, у остальных снимаем src
   и вызываем load(), иначе на телефоне быстро кончается память. */

const LIVE_LIMIT = 3;

/* video -> исходный адрес, снятый со src ради экономии памяти */
const parked = new WeakMap();
/* порядок обращения: последние — самые свежие */
const live = [];

function markLive(video) {
  const at = live.indexOf(video);
  if (at !== -1) live.splice(at, 1);
  live.push(video);
  while (live.length > LIVE_LIMIT) park(live.shift());
}

function park(video) {
  if (!video || !video.src) return;
  parked.set(video, video.src);
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function revive(video) {
  if (video.src) return;
  const src = parked.get(video);
  if (src) {
    video.src = src;
    video.load();
  }
}

function showPlayButton(video) {
  const holder = video.parentElement;
  if (!holder || holder.querySelector('.video-play-fallback')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'video-play-fallback';
  button.setAttribute('aria-label', 'Play video');
  button.addEventListener('click', event => {
    event.stopPropagation();
    button.remove();
    play(video);
  });
  holder.appendChild(button);
}

function clearPlayButton(video) {
  video.parentElement?.querySelector('.video-play-fallback')?.remove();
}

async function play(video) {
  if (!video) return false;
  revive(video);
  markLive(video);
  video.muted = video.muted !== false;
  try {
    await video.play();
    clearPlayButton(video);
    return true;
  } catch (error) {
    // Браузер отказал в автозапуске — оставляем постер и кнопку play
    showPlayButton(video);
    return false;
  }
}

function stop(video, { rewind = true } = {}) {
  if (!video) return;
  video.pause();
  if (rewind) {
    try { video.currentTime = 0; } catch { /* src уже снят */ }
  }
}

/* Готовит элемент к работе в вебе: без звука, инлайново, с постером. */
function prepare(video, poster) {
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('muted', '');
  video.preload = 'metadata';
  if (poster && !video.poster) video.poster = poster;
  return video;
}

/* Следит за контейнером: видимый ролик играет, остальные встают на паузу. */
function autoplayWhenVisible(root, selector = 'video', threshold = 0.6) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const video = entry.target;
      if (entry.isIntersecting && entry.intersectionRatio >= threshold) play(video);
      else stop(video);
    }
  }, { root, threshold: [0, threshold, 1] });

  const watch = () => {
    root.querySelectorAll(selector).forEach(video => observer.observe(video));
  };
  watch();
  return { observer, watch };
}

export { LIVE_LIMIT, autoplayWhenVisible, park, play, prepare, revive, stop };
