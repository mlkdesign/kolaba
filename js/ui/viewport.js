/* Размеры окна.

   Современные браузеры считают высоту через 100dvh, но старым Safari нужен
   фолбэк: туда пишем --vh из visualViewport, а base.css подхватывает его
   в @supports not (height: 100dvh). */

const docRoot = document.documentElement;

function syncViewportHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  docRoot.style.setProperty('--vh', `${height}px`);
}

/* Ширина колонки приложения — от неё считаются страницы пейджеров.
   Слушатели получают её через observeWidth(). */
const widthListeners = new Set();

function observeWidth(element, callback) {
  callback(element.clientWidth);
  const observer = new ResizeObserver(entries => {
    for (const entry of entries) callback(entry.contentRect.width);
  });
  observer.observe(element);
  widthListeners.add(observer);
  return () => {
    observer.disconnect();
    widthListeners.delete(observer);
  };
}

function startViewport() {
  syncViewportHeight();
  window.visualViewport?.addEventListener('resize', syncViewportHeight);
  window.addEventListener('resize', syncViewportHeight);
  window.addEventListener('orientationchange', () => {
    // Safari сообщает новые размеры не сразу после поворота
    window.setTimeout(syncViewportHeight, 120);
  });
}

export { observeWidth, startViewport, syncViewportHeight };
