// iOS ambient effects, numbers from kolaba/Features/Welcome/AmbientBackgroundView.swift and Profile/ProfileGlow.swift:
// the same SVG blobs, transforms, blur (50) and sine drift (AmbientDrift), driven by one requestAnimationFrame clock
// that only runs while an effect is mounted, the page is visible and reduced motion is off.
import { useEffect, useRef } from 'preact/hooks';
import { BASE } from './ui';

interface Drift { ax: number; ay: number; period: number; phase: number; rot: number; scale: number }

const offset = (d: Drift, t: number) => {
  const angle = 2 * Math.PI * t / d.period + d.phase;
  return [d.ax * Math.sin(angle), d.ay * Math.sin(angle * 0.77 + d.phase * 0.5)];
};
const rotation = (d: Drift, t: number) => d.rot * Math.sin(2 * Math.PI * t / (d.period * 1.3) + d.phase);
const scale = (d: Drift, t: number) => 1 + d.scale * Math.sin(2 * Math.PI * t / (d.period * 0.9) + d.phase * 1.7);

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

type Tick = (t: number) => void;
const ticks = new Set<Tick>();
let frame = 0;
const start = performance.now();
function loop(now: number) {
  frame = 0;
  if (document.hidden || !ticks.size) return;
  const t = (now - start) / 1000;
  ticks.forEach((fn) => fn(t));
  frame = requestAnimationFrame(loop);
}
export function subscribe(fn: Tick) {
  ticks.add(fn);
  fn(0);
  if (!frame && !reduceMotion()) frame = requestAnimationFrame(loop);
  return () => { ticks.delete(fn); };
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && ticks.size && !frame && !reduceMotion()) frame = requestAnimationFrame(loop); });

// ─── Profile glow: 402 × 100 at the top of a profile (ProfileGlowBlob.figmaBlobs) ───

interface GlowBlob { asset: string; business: string; w: number; h: number; matrix: number[]; cx: number; cy: number; drift: Drift }
// matrix = edges (xEdge/shapeW, yEdge/shapeH) then scale(1, −1); cy measured from the container's bottom.
const profileBlobs: GlowBlob[] = [
  { asset: 'ProfileGlowPink', business: 'ProfileGlowBusinessA', w: 449.98, h: 506.552,
    matrix: [224.11 / 249.98, -110.75 / 249.98, -277.74 / 306.55, -129.74 / 306.55], cx: 336.96, cy: 104.45,
    drift: { ax: 14, ay: 6, period: 13, phase: 2.1, rot: 3, scale: 0.04 } },
  { asset: 'ProfileGlowPurple', business: 'ProfileGlowBusinessB', w: 483.299, h: 424.461,
    matrix: [256.57 / 283.3, 120.13 / 283.3, 201.32 / 224.46, -99.26 / 224.46], cx: 57.95, cy: 121.75,
    drift: { ax: 16, ay: 6, period: 11, phase: 0, rot: 4, scale: 0.05 } },
];

export function ProfileGlow({ business = false, still = false, stretch = 0 }: { business?: boolean; still?: boolean; stretch?: number }) {
  const refs = [useRef<HTMLImageElement>(null), useRef<HTMLImageElement>(null)];
  useEffect(() => {
    const place = (t: number) => profileBlobs.forEach((b, i) => {
      const el = refs[i].current;
      if (!el) return;
      const [dx, dy] = still ? [0, 0] : offset(b.drift, t);
      const r = still ? 0 : rotation(b.drift, t);
      const s = still ? 1 : scale(b.drift, t);
      const [a, bb, c, d] = b.matrix;
      el.style.transform = `translate(${b.cx + dx}px, ${100 - b.cy + dy}px) translate(-50%, -50%) rotate(${r}deg) scale(${s}) matrix(${a}, ${bb}, ${c}, ${d}, 0, 0)`;
    });
    if (still) { place(0); return; }
    return subscribe(place);
  }, [still]);
  return (
    <div class="profile-glow" style={{ ['--glow-stretch' as any]: 1 + stretch }} aria-hidden="true">
      {profileBlobs.map((b, i) => (
        <img ref={refs[i]} src={`${BASE}icons/${business ? b.business : b.asset}.svg`} alt="" width={b.w} height={b.h}
          style={{ width: b.w, height: b.h }} />
      ))}
    </div>
  );
}

// ─── Authentication ambient: 402 × 405 at the bottom of the auth screens (AmbientBlob.figmaBlobs) ───

const ambientBlobs = [
  { asset: 'AmbientVector2', w: 521.49, h: 587.378, cx: 401.65, cy: 283.13, rot: -85.91, blend: 'normal',
    drift: { ax: 22, ay: 18, period: 13, phase: 2.1, rot: 3, scale: 0.04 } },
  { asset: 'AmbientVector1', w: 558.249, h: 488.46, cx: 49.87, cy: 359.56, rot: -19.41, blend: 'normal',
    drift: { ax: 26, ay: 16, period: 11, phase: 0, rot: 4, scale: 0.05 } },
  { asset: 'AmbientVector3', w: 534.483, h: 729.181, cx: 232.16, cy: 482.72, rot: -114.69, blend: 'plus-lighter',
    drift: { ax: 28, ay: 14, period: 9.5, phase: 4.2, rot: 5, scale: 0.03 } },
];

export function AmbientBackground({ business = false, rise = false }: { business?: boolean; rise?: boolean }) {
  const refs = [useRef<HTMLImageElement>(null), useRef<HTMLImageElement>(null), useRef<HTMLImageElement>(null)];
  useEffect(() => subscribe((t) => ambientBlobs.forEach((b, i) => {
    const el = refs[i].current;
    if (!el) return;
    const [dx, dy] = offset(b.drift, t);
    el.style.transform = `translate(${b.cx + dx}px, ${b.cy + dy}px) translate(-50%, -50%) rotate(${b.rot + rotation(b.drift, t)}deg) scale(${scale(b.drift, t)})`;
  })), []);
  return (
    <div class={`ambient ${rise ? 'is-rising' : ''}`} aria-hidden="true">
      <div class="ambient__box">
        {ambientBlobs.map((b, i) => (
          <img ref={refs[i]} src={`${BASE}icons/${business && b.asset !== 'AmbientVector3' ? `${b.asset}Business` : b.asset}.svg`} alt=""
            style={{ width: b.w, height: b.h, mixBlendMode: b.blend as any }} />
        ))}
      </div>
    </div>
  );
}
