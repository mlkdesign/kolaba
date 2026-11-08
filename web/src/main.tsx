import { render } from 'preact';
import './styles/shell.css';
import './styles/app.css';
import { App } from './app';

// Scales the phone picture (not the app) to the window — the screen keeps real 386 × 841 CSS pixels (from the
// previous mockup: js/ui/mockup.js). On phones the mockup is off and the app fills the screen.
const PHONE_WIDTH = 434;
const PHONE_HEIGHT = 887;
function fitMockup() {
  const phone = document.querySelector<HTMLElement>('.phone');
  const stage = phone?.parentElement;
  if (!phone || !stage || !document.documentElement.classList.contains('is-mockup')) return;
  const scale = Math.min(1, stage.clientHeight / PHONE_HEIGHT, stage.clientWidth / PHONE_WIDTH);
  phone.style.setProperty('--mockup-scale', String(Math.max(0.2, scale)));
}
fitMockup();
const stage = document.querySelector('.stage');
if (stage) new ResizeObserver(fitMockup).observe(stage);
window.addEventListener('resize', fitMockup);

render(<App />, document.getElementById('app')!);
