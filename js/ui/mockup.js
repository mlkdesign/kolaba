/* Подгонка мокапа телефона под окно.

   Масштабируется сама картинка телефона, а не приложение внутри: transform не
   влияет на раскладку, поэтому экран остаётся честными 386×841 CSS-пикселями —
   те же размеры, что у настоящего телефона. Если масштабировать контент (как
   было раньше), внутрь попадали бы размеры коробки мокапа, и медиазапросы
   считали бы экран узким.

   В вебе модуль ничего не делает. */
import { inMockup } from '../ui/page-scroll.js';

const PHONE_WIDTH = 434;
const PHONE_HEIGHT = 887;

function fitMockup() {
  const phone = document.querySelector('.phone');
  const stage = phone?.parentElement;
  if (!phone || !stage) return;
  const scale = Math.min(
    1,
    stage.clientHeight / PHONE_HEIGHT,
    stage.clientWidth / PHONE_WIDTH
  );
  phone.style.setProperty('--mockup-scale', String(Math.max(0.2, scale)));
}

function startMockup() {
  if (!inMockup()) return;
  fitMockup();
  const stage = document.querySelector('.stage');
  if (stage) new ResizeObserver(fitMockup).observe(stage);
  window.addEventListener('resize', fitMockup);
}

export { fitMockup, startMockup };
