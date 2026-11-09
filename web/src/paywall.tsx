// kolaba.pro paywall (Pro/ProComponents.swift — ProPaywallContent + FullscreenPaywall): the card fan, creator.pro /
// business.pro, the feature's title and line, View all benefits ›, the two plans, the call, the terms, Restore
// Purchases and the legal links, over the registration's glow. It rises 200 pt and fades in (0.3 s, easing out), ×
// takes it away at once, a pull down from its top follows the finger and closes past half. Nothing is sold on the web:
// the call says so honestly (as the app does) — no purchase, no charge, nothing unlocked.
import { useRef, useState } from 'preact/hooks';
import { AmbientBackground } from './fx';
import { activeProfile, openSheet } from './state';
import { alertDialog, BASE, icon, SheetFrame } from './ui';
import { uiScale } from './scale';
import { trackEvent } from './analytics';

export type PaywallFeature = 'collections' | 'introVideo' | 'pro' | 'jobPosts' | 'businessPro';

const BENEFITS = {
  creator: ['Intro video at the top of your profile', 'Unlimited collections in your portfolio', 'Photos and videos in your applications', 'The PRO badge next to your name'],
  business: ['More job posts at once', 'The BUSINESS badge next to your name', 'A business.pro profile with its blue glow'],
};
const PRICES = {
  creator: { yearly: '$7.99/month, billed annually at $95.88', monthly: '$9.99/month', yearlyTerms: '14 days free, then $95.88/year. Cancel anytime.', monthlyTerms: '$9.99 billed every month. Cancel anytime.' },
  business: { yearly: '$3.99/month, billed annually at $47.88', monthly: '$5.99/month', yearlyTerms: '14 days free, then $47.88/year. Cancel anytime.', monthlyTerms: '$5.99 billed every month. Cancel anytime.' },
};
const COPY: Record<PaywallFeature, [string, string]> = {
  collections: ['Unlock Unlimited Collections', 'Create unlimited collections to organize your work and build a portfolio that stands out.'],
  introVideo: ['Unlock Intro Video', 'Introduce yourself with a short video at the top of your profile, so brands get to know you first.'],
  pro: ['Get creator.pro', 'Stand out with the PRO badge, an intro video, unlimited collections and media in your applications.'],
  jobPosts: ['Unlock Unlimited Job Posts', 'Publish more jobs at once and find the right creators faster.'],
  businessPro: ['Get business.pro', 'Stand out with the BUSINESS badge, a business.pro profile and more job posts at once.'],
};

let open = false;
/** One paywall at a time, over the current screen (its context stays under it). */
export function openPaywall(feature: PaywallFeature) {
  if (open) return;
  open = true;
  trackEvent(`paywall_${feature}`);
  openSheet((close) => <Paywall feature={feature} close={() => { open = false; close(); }} />, { raw: true });
}

/** creator.pro for a creator, business.pro for a business — the offer behind someone's PRO badge. */
export const offerFor = (type: 'creator' | 'business'): PaywallFeature => (type === 'business' ? 'businessPro' : 'pro');

function Paywall({ feature, close }: { feature: PaywallFeature; close: () => void }) {
  const kind = feature === 'jobPosts' || feature === 'businessPro' ? 'business' : 'creator';
  const [plan, setPlan] = useState<'yearly' | 'monthly'>('yearly');
  const [pull, setPull] = useState(0);
  const [settling, setSettling] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [title, detail] = COPY[feature];
  const prices = PRICES[kind];
  const accent = kind === 'business' ? 'var(--blue)' : 'var(--pink)';
  const startPull = (e: PointerEvent) => {
    if ((scroller.current?.scrollTop ?? 0) > 0 || (e.target as HTMLElement).closest('button, a')) return;
    const k = uiScale(); const y0 = e.clientY; let active = false; let v = 0; let last = y0; let lastT = performance.now();
    const move = (ev: PointerEvent) => {
      const dy = (ev.clientY - y0) / k;
      if (!active) { if (dy < 8) return; active = true; }
      const t = performance.now(); v = ((ev.clientY - last) / k / Math.max(t - lastT, 1)) * 1000; last = ev.clientY; lastT = t;
      setPull(Math.max(0, dy));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!active) return;
      const dy = Math.max(0, (ev.clientY - y0) / k);
      setSettling(true);
      if (dy > 100 || v > 700) { setPull(200); window.setTimeout(close, 300); }
      else { setPull(0); window.setTimeout(() => setSettling(false), 300); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const shown = 1 - Math.min(pull / 200, 1);
  return (
    <div class={`paywall ${settling ? 'is-settling' : ''}`} style={{ ['--pw-accent' as any]: accent, ['--pw-shown' as any]: shown }} role="dialog" aria-modal="true" aria-label={title}>
      <div class="paywall__dim" />
      <div class="paywall__sheet" style={{ transform: `translateY(${pull}px)` }} onPointerDown={startPull as any}>
        <div class="paywall__glow"><AmbientBackground business={kind === 'business'} /></div>
        <div class="paywall__scroll" ref={scroller}>
          <div class="paywall__content">
            <div class="paywall__brand">
              <div class="fan" aria-hidden="true" style={{ transform: `scale(${1 - Math.min(pull / 200, 1) * 0.1})` }}>
                <span class="fan__card is-left"><img src={icon('IconLockKey')} alt="" /></span>
                <span class="fan__card is-right"><img src={icon('IconLockKey')} alt="" /></span>
                <span class="fan__card is-center"><img src={icon('IconPortfolioMark')} alt="" style={{ width: 20, height: 19.5 }} /></span>
              </div>
              <div class="paywall__logo">{kind}<i>.pro</i></div>
            </div>
            <div class="paywall__text"><b>{title}</b><span>{detail}</span></div>
            <button class="paywall__benefits" onClick={() => openSheet((c) => (
              <SheetFrame title={`All ${kind}.pro benefits`} close={c}>
                <ul class="benefits">{BENEFITS[kind].map((b) => <li><img src={icon('IconCrownSimple')} alt="" style={{ filter: kind === 'business' ? 'none' : undefined }} />{b}</li>)}</ul>
              </SheetFrame>
            ))}>View all benefits<img src={icon('IconCaretRight')} alt="" /></button>
            <div class="plans" role="radiogroup" aria-label="Plan">
              {(['yearly', 'monthly'] as const).map((p) => (
                <button class={`plan ${plan === p ? 'is-on' : ''}`} role="radio" aria-checked={plan === p} onClick={() => setPlan(p)}>
                  <span class="grow">
                    <span class="plan__name">{p === 'yearly' ? 'Yearly' : 'Monthly'}{p === 'yearly' && <span class="plan__badge">14-day free trial</span>}</span>
                    <span class="plan__price">{prices[p]}</span>
                  </span>
                  <span class="radio" />
                </button>
              ))}
            </div>
            <button class="paywall__call" onClick={() => alertDialog(`${kind}.pro isn't available yet`,
              'Subscriptions can’t be bought in this version of KOLABA. Nothing was purchased or charged.', 'OK', () => {}, false)}>
              <span>{plan === 'yearly' ? 'Start 14-days free trial' : 'Continue with kolaba.pro'}</span><img src={icon('IconLockKeyOpen')} alt="" />
            </button>
            <div class="paywall__terms">{plan === 'yearly' ? prices.yearlyTerms : prices.monthlyTerms}</div>
            <button class="paywall__restore" onClick={() => alertDialog('Nothing to restore',
              'No purchases can be made in this version of KOLABA yet, so there are none to restore.', 'OK', () => {}, false)}>Restore Purchases</button>
            <nav class="legal-links" style={{ padding: 0 }}><a href={`${BASE}privacy.html`}>Privacy Policy</a><i /><a href={`${BASE}terms.html`}>Terms and Conditions</a></nav>
          </div>
        </div>
      </div>
      <button class="glass glass-btn paywall__close" aria-label="Close" onClick={close}><img src={icon('IconPlus')} alt="" style={{ transform: 'rotate(45deg)' }} /></button>
    </div>
  );
}

/** Whether someone's badge offers the viewer the paywall (MainAppModel.proBadgeOffer): only a non-PRO viewer, and only
 *  the subscription of the viewer's own type. */
export function badgeOffers(badgeType: 'creator' | 'business') {
  const me = activeProfile.value;
  return !!me && !me.isPro && me.type === badgeType;
}
