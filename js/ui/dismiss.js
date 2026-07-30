/* Смахивание вверх или вниз, чтобы закрыть полноэкранный просмотр.

   Нужно там, где на экране нет видимой кнопки закрытия: фотография из профиля
   и вложение проекта. Картинка едет за пальцем, фон гаснет; если увели дальше
   порога — просмотр закрывается, если нет — всё возвращается на место. */

const CLOSE_DISTANCE = 110;   // px, после которых отпускание закрывает
const CLOSE_VELOCITY = 800;   // px/s, быстрый флик закрывает раньше порога

/**
 * @param {HTMLElement} viewer   контейнер просмотра
 * @param {object} options
 * @param {HTMLElement} options.stage    что двигать за пальцем
 * @param {HTMLElement} [options.backdrop] что гасить (по умолчанию сам viewer)
 * @param {() => void} options.onClose   закрыть просмотр
 * @param {() => boolean} [options.isOpen]
 */
function swipeToDismiss(viewer, { stage, backdrop, onClose, isOpen }) {
  if (!viewer || !stage) return;
  const fade = backdrop || viewer;
  let gesture = null;

  const reset = () => {
    stage.style.transition = 'transform .2s cubic-bezier(.32,.72,0,1)';
    stage.style.transform = '';
    fade.style.opacity = '';
    window.setTimeout(() => { stage.style.transition = ''; }, 220);
  };

  viewer.addEventListener('pointerdown', event => {
    if (!event.isPrimary) return;
    if (isOpen && !isOpen()) return;
    // подложка — тоже кнопка, но с неё смахивать можно
    const button = event.target.closest('button');
    if (button && !/backdrop/.test(button.className)) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null, time: performance.now() };
  });

  viewer.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.axis && Math.hypot(dx, dy) > 8) gesture.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
    if (gesture.axis !== 'y') return;
    event.preventDefault();
    stage.style.transition = 'none';
    const scale = Math.max(.86, 1 - Math.abs(dy) / 900);
    stage.style.transform = `translate3d(0,${dy}px,0) scale(${scale})`;
    fade.style.opacity = String(Math.max(.15, 1 - Math.abs(dy) / 320));
  });

  const settle = (event, cancelled) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const { axis, y, time } = gesture;
    gesture = null;
    if (axis !== 'y' || cancelled) {
      if (axis === 'y') reset();
      return;
    }
    const dy = event.clientY - y;
    const velocity = Math.abs(dy) / Math.max(16, performance.now() - time) * 1000;
    if (Math.abs(dy) > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) {
      const height = viewer.getBoundingClientRect().height || window.innerHeight;
      stage.style.transition = 'transform .2s cubic-bezier(.32,.72,0,1), opacity .2s ease';
      stage.style.transform = `translate3d(0,${dy < 0 ? -height : height}px,0) scale(.86)`;
      fade.style.opacity = '0';
      window.setTimeout(() => {
        onClose();
        stage.style.transition = '';
        stage.style.transform = '';
        fade.style.opacity = '';
      }, 190);
      return;
    }
    reset();
  };

  viewer.addEventListener('pointerup', event => settle(event, false));
  viewer.addEventListener('pointercancel', event => settle(event, true));
}

export { swipeToDismiss };
