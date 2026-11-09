// Microsoft Clarity (web project zaxrlwua97). The official tag is loaded once, from index.html, only when the viewer
// allows usage analytics (Settings → Privacy & Safety → Usage analytics; off by default under Global Privacy Control
// or Do Not Track). The app never changes its URL, so screens are named here (`screen` tag + an event per change).
// Nothing personal is sent: no user id, no e-mail, no message or form text — only screen names and a few action
// names; private areas carry data-clarity-mask so their text is masked in recordings.

declare global { interface Window { clarity?: (...args: unknown[]) => void } }

const KEY = 'kolaba.analytics';
const PROJECT = 'zaxrlwua97';

/** The viewer's choice; unset → allowed unless the browser asks not to be tracked. */
export function analyticsAllowed(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch { /* private mode */ }
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return !(nav.globalPrivacyControl || nav.doNotTrack === '1');
}

/** Stores the choice and applies it: on → load (once) and consent; off → Clarity stops and erases its cookies. */
export function setAnalyticsAllowed(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* */ }
  if (on) { loadClarity(); window.clarity?.('consent'); }
  else window.clarity?.('consent', false);
}

/** The official snippet, run at most once per page load. */
export function loadClarity() {
  if (document.querySelector(`script[src="https://www.clarity.ms/tag/${PROJECT}"]`)) return;
  ((c: any, l: Document, a: string, r: string, i: string) => {
    c[a] = c[a] || function (...args: unknown[]) { (c[a].q = c[a].q || []).push(args); };
    const t = l.createElement(r) as HTMLScriptElement; t.async = true; t.src = `https://www.clarity.ms/tag/${i}`;
    const y = l.getElementsByTagName(r)[0]; y.parentNode!.insertBefore(t, y);
  })(window, document, 'clarity', 'script', PROJECT);
}

let lastScreen = '';
/** A screen of the SPA (section or pushed screen) — once per change. */
export function trackScreen(name: string) {
  if (!name || name === lastScreen || !window.clarity) return;
  lastScreen = name;
  window.clarity('set', 'screen', name);
  window.clarity('event', `screen_${name}`);
}

/** A named action (no personal data in names). */
export function trackEvent(name: string) { window.clarity?.('event', name); }
