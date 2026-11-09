import { render } from 'preact';
import './styles/shell.css';
import './styles/app.css';
import { App } from './app';

// One fixed logical screen (402 × 874). With the frame, the phone is 70 % of the window's height (and never wider
// than the window); on a phone the screen alone fills the display. The scale goes to --ui-scale (shell.css, scale.ts).
const PHONE = { w: 452, h: 920 };
function fit() {
  const root = document.documentElement;
  const mobile = root.classList.contains('is-mobile');
  // On a phone the app is laid out at the display's own width — nothing is scaled.
  const scale = mobile ? 1 : Math.min((innerHeight * 0.7) / PHONE.h, (innerWidth - 32) / PHONE.w);
  root.style.setProperty('--ui-scale', String(Math.max(0.2, scale)));
}
fit();
window.addEventListener('resize', fit);
window.visualViewport?.addEventListener('resize', fit);

render(<App />, document.getElementById('app')!);
