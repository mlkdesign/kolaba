// Authentication (AuthenticationRootView): the Start Page (photo collage drifting at 15°, ambient glow, logo, Get
// inspired), Create profile (e-mail + password, red errors with a shake), Verify e-mail (six cells, paste, resend
// timer), Welcome back (log in), password reset, the first profile (creator / business) and legal pages.
import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiError, errorText, post, ProfileType } from '../api';
import { applySession, profiles, reloadSession, showToast, user } from '../state';
import { AmbientBackground, subscribe } from '../fx';
import { BackButton, BASE, Header, HeaderTitle, icon, Logo } from '../ui';

type Step = 'start' | 'signup' | 'verify' | 'login' | 'forgot' | 'reset' | 'legal';

export function AuthFlow() {
  const [step, setStep] = useState<Step>('start');
  const [email, setEmail] = useState('');
  const go = (s: Step) => setStep(s);
  let page;
  if (step === 'start') page = <Start onSignup={() => go('signup')} onLogin={() => go('login')} />;
  else if (step === 'legal') page = <Legal onBack={() => go('start')} />;
  else if (step === 'signup') page = <Signup onBack={() => go('start')} onSent={(e) => { setEmail(e); go('verify'); }} onLogin={() => go('login')} />;
  else if (step === 'verify') page = <Verify email={email} onBack={() => go('signup')} />;
  else if (step === 'forgot') page = <Forgot onBack={() => go('login')} onSent={(e) => { setEmail(e); go('reset'); }} />;
  else if (step === 'reset') page = <Reset email={email} onBack={() => go('forgot')} onDone={() => go('login')} />;
  else page = <Login onBack={() => go('start')} onForgot={() => go('forgot')} onVerify={(e) => { setEmail(e); go('verify'); }} />;
  return <div class="auth-screen" key={step} style={{ animation: 'fade-in .3s ease' }}>{page}</div>;
}

// ─── Start Page: the collage (Figma 164:276) — five columns in a 592 × 1164 frame rotated 15°, opacity 20 % ───

const CARD_H = (110.54 * 432) / 243;
const GAP = 10;
const photo = (n: number) => `${BASE}demo/CollageRectangle${String(n).padStart(2, '0')}.jpg`;
const full = (n: number) => n * CARD_H + (n - 1) * GAP;
const COLUMNS = [
  { x: 0, y: 0, photos: [3, 5, 4, 5, 4, 5, 3, 7], speed: 14 },
  { x: 120.36, y: 1164 - 0.37 - full(9), photos: [5, 6, 7, 7, 4, 5, 6, 7, 3], speed: -18 },
  { x: 240.73, y: 0, photos: [10, 10, 11, 10, 9, 7, 10, 11, 10], speed: 11 },
  { x: 361.1, y: 1164 / 2 - 238.94 - full(8) / 2, photos: [8, 5, 9, 5, 8, 3, 4, 6], speed: -16 },
  { x: 481.46, y: 1164 / 2 + 239.06 - full(8) / 2, photos: [7, 7, 12, 7, 3, 4, 6, 5], speed: 13 },
];

function Collage() {
  const refs = COLUMNS.map(() => useRef<HTMLDivElement>(null));
  useEffect(() => subscribe((t) => COLUMNS.forEach((c, i) => {
    const period = c.photos.length * (CARD_H + GAP);
    const raw = (c.y + c.speed * t) % period;
    const y = raw >= 0 ? raw - period : raw;
    const el = refs[i].current;
    if (el) el.style.transform = `translate(${c.x}px, ${y}px)`;
  })), []);
  return (
    <div class="collage" aria-hidden="true">
      {COLUMNS.map((c, i) => (
        <div class="collage__col" ref={refs[i]}>{[...c.photos, ...c.photos].map((n) => <img src={photo(n)} alt="" draggable={false} />)}</div>
      ))}
    </div>
  );
}

function LegalLinks() {
  return (
    <nav class="legal-links" aria-label="Legal documents">
      <a href={`${BASE}privacy.html`}>Privacy Policy</a><i aria-hidden="true" /><a href={`${BASE}terms.html`}>Terms and Conditions</a>
    </nav>
  );
}

function Start({ onSignup, onLogin }: { onSignup: () => void; onLogin: () => void }) {
  return (
    <>
      <Collage />
      <div class="top-gradient" />
      <AmbientBackground />
      <div class="start-logo"><Logo word="kolaba" /></div>
      <div class="start-content">
        <div>
          <h1>Get inspired<br />by the best</h1>
          <p>See how other creators do it. Catch trends, experiment, and grow your own style.</p>
        </div>
        <div class="start-buttons">
          <button class="btn is-glass" onClick={onSignup}>Create profile<img class="btn__arrow" src={icon('IconArrowLeft')} alt="" /></button>
          <button class="btn is-milky" onClick={onLogin}>Log in<img class="btn__arrow" src={icon('IconArrowLeft')} alt="" /></button>
        </div>
        <LegalLinks />
      </div>
    </>
  );
}

/** KolabaAuthPage: Back at the top left, the paginator top right, the title 68 pt under the safe area, legal links at
 *  the bottom, the ambient glow behind. */
function AuthPage({ onBack, step, children }: { onBack: () => void; step?: number; children: any }) {
  return (
    <>
      <AmbientBackground />
      <div class="auth-scroll" style={{ zIndex: 2 }}>
        <div class="auth-body">{children}</div>
        <LegalLinks />
      </div>
      <Header blur={false} left={<BackButton onClick={onBack} />} />
      {step !== undefined && <div class="paginator" aria-hidden="true">{[0, 1, 2].map((i) => <i class={i === step ? 'is-on' : ''} />)}</div>}
    </>
  );
}

/** A KolabaTextField: icon, input, trailing accessory; red with a shake on error. */
function Field({ iconName, type = 'text', value, onInput, placeholder, error, shake, autoComplete, inputMode, autoFocus }: {
  iconName: string; type?: string; value: string; onInput: (v: string) => void; placeholder: string; error?: boolean; shake?: number;
  autoComplete?: string; inputMode?: string; autoFocus?: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  const secure = type === 'password';
  return (
    <label class={`field ${error ? 'is-error' : ''} ${shake ? 'shake' : ''}`} key={shake}>
      <img src={icon(iconName)} alt="" />
      <input type={secure && !reveal ? 'password' : secure ? 'text' : type} value={value} placeholder={placeholder} autoComplete={autoComplete}
        inputMode={inputMode as any} autoFocus={autoFocus} autoCapitalize="off" spellcheck={false} aria-invalid={error}
        onInput={(e) => onInput(e.currentTarget.value)} />
      {secure ? (
        <button type="button" class="field__action" aria-label={reveal ? 'Hide password' : 'Show password'} onClick={() => setReveal(!reveal)}>
          <img src={icon(reveal ? 'IconEyeSlash' : 'IconEye')} alt="" /></button>
      ) : value ? (
        <button type="button" class="field__action" aria-label="Clear" onClick={() => onInput('')}><img src={icon('IconXCircle')} alt="" /></button>
      ) : null}
    </label>
  );
}

function NextButton({ busy, ready, label = 'Next step' }: { busy: boolean; ready: boolean; label?: string }) {
  return (
    <button class={`btn ${ready ? '' : 'is-dim'}`} type="submit" disabled={busy} aria-disabled={!ready}>
      {busy ? 'Please wait…' : label}<img class="btn__arrow" src={icon('IconArrowLeft')} alt="" />
    </button>
  );
}

function Socials({ intent }: { intent: 'Sign Up' | 'Log in' }) {
  return (
    <>
      <div class="auth-or">Or</div>
      <div class="form-gap">
        <button type="button" class="social-btn" onClick={() => showToast(`${intent} with Google is available in the iOS app`)}><img src={icon('IconGoogle')} alt="" />{intent} with Google</button>
        <button type="button" class="social-btn" onClick={() => showToast(`${intent} with Apple is available in the iOS app`)}><img src={icon('IconApple')} alt="" />{intent} with Apple</button>
      </div>
    </>
  );
}

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

function Signup({ onBack, onSent, onLogin }: { onBack: () => void; onSent: (email: string) => void; onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<'' | 'invalid' | 'taken' | 'other'>('');
  const [other, setOther] = useState('');
  const [passError, setPassError] = useState(false);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const ready = validEmail(email) && password.length >= 8;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    if (!validEmail(email)) { setEmailError('invalid'); setShake((s) => s + 1); return; }
    if (password.length < 8) { setPassError(true); setShake((s) => s + 1); return; }
    setBusy(true);
    try { await post('/v1/auth/signup', { email, password }); onSent(email.trim().toLowerCase()); }
    catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'email_taken') setEmailError('taken');
      else if (code === 'password_too_short') setPassError(true);
      else { setEmailError('other'); setOther(errorText(err)); }
      setShake((s) => s + 1);
    } finally { setBusy(false); }
  };
  return (
    <AuthPage onBack={onBack} step={0}>
      <h1 class="auth-title">Let’s create<br />your <em>profile</em></h1>
      <form onSubmit={submit} class="form-gap" noValidate>
        <Field iconName="IconEnvelopeSimple" type="email" value={email} placeholder="Your e-mail" autoComplete="email" inputMode="email"
          error={!!emailError} shake={emailError ? shake : 0} onInput={(v) => { setEmail(v); setEmailError(''); }} />
        {emailError && (
          <div class="field-error" role="alert">
            {emailError === 'taken' ? <>This email is already registered. <span style={{ color: '#fff' }}>Please <button type="button" onClick={onLogin}>log in</button>.</span></>
              : emailError === 'invalid' ? 'Please enter a valid email address.' : other}
          </div>
        )}
        <Field iconName="IconKey" type="password" value={password} placeholder="Your password" autoComplete="new-password"
          error={passError} shake={passError ? shake : 0} onInput={(v) => { setPassword(v); setPassError(false); }} />
        {passError && <div class="field-error" role="alert">Password must be at least 8 characters long.</div>}
        <NextButton busy={busy} ready={ready} />
      </form>
      <Socials intent="Sign Up" />
    </AuthPage>
  );
}

function Verify({ email, onBack }: { email: string; onBack: () => void }) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(30);
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { cells.current[0]?.focus(); }, []);
  useEffect(() => { if (left <= 0) return; const t = window.setTimeout(() => setLeft(left - 1), 1000); return () => window.clearTimeout(t); }, [left]);
  const code = digits.join('');
  const submit = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true); setError('');
    try { applySession(await post('/v1/auth/verify', { email, code: value })); }
    catch (err) { setError(err instanceof ApiError && err.code === 'code_invalid' ? 'Invalid verification code.' : errorText(err)); setShake((s) => s + 1); }
    finally { setBusy(false); }
  };
  const fill = (from: number, text: string) => {
    const clean = text.replace(/\D/g, '').slice(0, 6 - from);
    if (!clean) return;
    const next = [...digits];
    clean.split('').forEach((d, i) => { next[from + i] = d; });
    setDigits(next); setError('');
    const focus = Math.min(from + clean.length, 5);
    cells.current[focus]?.focus();
    if (next.join('').length === 6) void submit(next.join(''));
  };
  const resend = async () => {
    try { await post('/v1/auth/resend-code', { email }); setLeft(30); showToast('A new code is on its way', 'ok'); } catch (e) { showToast(errorText(e), 'error'); }
  };
  return (
    <AuthPage onBack={onBack} step={1}>
      <h1 class="auth-title">Verify your<br /><em>e-mail</em></h1>
      <p class="auth-lead">We've sent a 6-digit verification code to <b>{email}</b>. Enter the code below to verify your e-mail.</p>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div class={`otp ${error ? 'is-error' : ''} ${error ? 'shake' : ''}`} key={shake}>
          {digits.map((d, i) => (
            <input ref={(el) => { cells.current[i] = el; }} value={d} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={6}
              aria-label={`Digit ${i + 1}`}
              onInput={(e) => { const v = e.currentTarget.value; if (v.length > 1) fill(i, v); else { const n = [...digits]; n[i] = v.replace(/\D/g, ''); setDigits(n); setError(''); if (n[i] && i < 5) cells.current[i + 1]?.focus(); if (n.join('').length === 6) void submit(n.join('')); } }}
              onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) cells.current[i - 1]?.focus(); }}
              onPaste={(e) => { e.preventDefault(); fill(i, e.clipboardData?.getData('text') ?? ''); }} />
          ))}
        </div>
        {error && <div class="field-error" role="alert" style={{ marginTop: -8, marginBottom: 8 }}>{error}</div>}
        <NextButton busy={busy} ready={code.length === 6} />
      </form>
      <div class="auth-row"><span>Didn't receive the code?</span>
        {left > 0 ? <span class="muted">Resend in 00:{String(left).padStart(2, '0')}</span> : <button style={{ color: 'var(--pink)' }} onClick={resend}>Resend</button>}</div>
    </AuthPage>
  );
}

function Login({ onBack, onForgot, onVerify }: { onBack: () => void; onForgot: () => void; onVerify: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<'' | 'email' | 'password' | 'other'>('');
  const [other, setOther] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    if (!validEmail(email)) { setError('email'); setShake((s) => s + 1); return; }
    if (!password) { setError('password'); setShake((s) => s + 1); return; }
    setBusy(true);
    try { applySession(await post('/v1/auth/login', { email, password })); }
    catch (err: any) {
      if (err?.code === 'verification_required') { onVerify(email.trim().toLowerCase()); return; }
      if (err?.code === 'invalid_credentials') setError('password'); else { setError('other'); setOther(errorText(err)); }
      setShake((s) => s + 1);
    } finally { setBusy(false); }
  };
  return (
    <AuthPage onBack={onBack}>
      <h1 class="auth-title">Welcome back</h1>
      <form onSubmit={submit} class="form-gap" noValidate>
        <Field iconName="IconEnvelopeSimple" type="email" value={email} placeholder="Your e-mail" autoComplete="username" inputMode="email"
          error={error === 'email'} shake={error === 'email' ? shake : 0} onInput={(v) => { setEmail(v); setError(''); }} />
        {error === 'email' && <div class="field-error" role="alert">Please enter a valid email address.</div>}
        <Field iconName="IconKey" type="password" value={password} placeholder="Your password" autoComplete="current-password"
          error={error === 'password'} shake={error === 'password' ? shake : 0} onInput={(v) => { setPassword(v); setError(''); }} />
        {error === 'password' && <div class="field-error" role="alert">Incorrect password. <span style={{ color: '#fff' }}>Please try again.</span></div>}
        {error === 'other' && <div class="field-error" role="alert">{other}</div>}
        <NextButton busy={busy} ready={validEmail(email) && !!password} />
      </form>
      <button class="btn is-ghost" style={{ marginTop: 8, height: 40 }} onClick={onForgot}>Forgot password?</button>
      <Socials intent="Log in" />
    </AuthPage>
  );
}

function Forgot({ onBack, onSent }: { onBack: () => void; onSent: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await post('/v1/auth/password/forgot', { email }); onSent(email.trim().toLowerCase()); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <AuthPage onBack={onBack}>
      <h1 class="auth-title">Reset your<br /><em>password</em></h1>
      <p class="auth-lead">We'll e-mail you a 6-digit code.</p>
      <form onSubmit={submit} class="form-gap" noValidate>
        <Field iconName="IconEnvelopeSimple" type="email" value={email} placeholder="Your e-mail" autoComplete="email" error={!!error} onInput={(v) => { setEmail(v); setError(''); }} />
        {error && <div class="field-error" role="alert">{error}</div>}
        <NextButton busy={busy} ready={validEmail(email)} label="Send code" />
      </form>
    </AuthPage>
  );
}

function Reset({ email, onBack, onDone }: { email: string; onBack: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await post('/v1/auth/password/reset', { email, code, password }); showToast('Password changed — log in with the new one', 'ok'); onDone(); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <AuthPage onBack={onBack}>
      <h1 class="auth-title">New<br /><em>password</em></h1>
      <p class="auth-lead">Code from the e-mail to <b>{email}</b>, and your new password.</p>
      <form onSubmit={submit} class="form-gap" noValidate>
        <Field iconName="IconLockKey" value={code} placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code" onInput={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} />
        <Field iconName="IconKey" type="password" value={password} placeholder="New password (8+ characters)" autoComplete="new-password" error={!!error} onInput={setPassword} />
        {error && <div class="field-error" role="alert">{error}</div>}
        <NextButton busy={busy} ready={code.length === 6 && password.length >= 8} label="Change password" />
      </form>
    </AuthPage>
  );
}

/** First profile (and more later from Settings): creator or business. */
export function CreateProfile({ onDone, onCancel, allowed }: { onDone?: () => void; onCancel?: () => void; allowed?: ProfileType[] }) {
  const types = allowed ?? ['creator', 'business'];
  const [type, setType] = useState<ProfileType>(types[0]);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [category, setCategory] = useState('');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await post('/v1/profiles', { type, displayName, username, city: city || null, country: country || null, category: category || null, bio });
      await reloadSession();
      const created = profiles.value.find((p) => p.username === username.toLowerCase());
      if (created) (await import('../state')).setActiveProfile(created.id);
      onDone?.();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  const plain = (value: string, set: (v: string) => void, placeholder: string, iconName: string) => (
    <Field iconName={iconName} value={value} placeholder={placeholder} onInput={set} />
  );
  return (
    <div class="auth-screen">
      <AmbientBackground business={type === 'business'} />
      <div class="auth-scroll" style={{ zIndex: 2 }}>
        <div class="auth-body" style={{ paddingBottom: 32 }}>
          <h1 class="auth-title">Create your<br /><em style={type === 'business' ? { color: 'var(--blue)' } : undefined}>profile</em></h1>
          {!onCancel && <p class="auth-lead">{user.value?.email}</p>}
          {types.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <button class={`choice ${type === 'creator' ? 'is-on' : ''}`} onClick={() => setType('creator')}>
                <img src={icon('IconVideoCamera')} alt="" /><div><div class="choice__title">Creator</div><div class="choice__sub">Portfolio, reels, apply to jobs from brands.</div></div></button>
              <button class={`choice ${type === 'business' ? 'is-on' : ''}`} style={type === 'business' ? { borderColor: 'var(--blue)', background: 'rgba(0,174,255,.12)' } : undefined} onClick={() => setType('business')}>
                <img src={icon('IconBriefcase')} alt="" /><div><div class="choice__title">Business</div><div class="choice__sub">Publish jobs and find creators. Up to 5, free.</div></div></button>
            </div>
          )}
          <form onSubmit={submit} class="form-gap" noValidate>
            {plain(displayName, setDisplayName, type === 'business' ? 'Business name' : 'Your name', 'IconUser')}
            <Field iconName="IconLink" value={username} placeholder="Username" onInput={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9._]/g, ''))} />
            <div class="row" style={{ gap: 8 }}>{plain(city, setCity, 'City', 'IconMapPin')}{plain(country, setCountry, 'Country', 'IconGlobeSimple')}</div>
            {plain(category, setCategory, type === 'business' ? 'Category (Hotels / Resort)' : 'Niche (Travel / Lifestyle UGC)', 'IconFunnel')}
            <textarea class="textarea" maxLength={1000} placeholder={type === 'business' ? 'Description' : 'Bio'} value={bio} onInput={(e) => setBio(e.currentTarget.value)} />
            {error && <div class="field-error" role="alert">{error}</div>}
            <NextButton busy={busy} ready={!!displayName && username.length >= 3} label="Create profile" />
          </form>
        </div>
      </div>
      {onCancel && <Header blur={false} left={<BackButton onClick={onCancel} />} />}
    </div>
  );
}

export function Legal({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div class="scroll">
        <div class="legal">
          <h2>KOLABA web test version</h2>
          <p>KOLABA connects creators and businesses. This is a test version: no payments are charged.</p>
          <h2>Legal documents</h2>
          <p><a href={`${BASE}privacy.html`}>Read the Privacy Policy</a></p>
          <p><a href={`${BASE}terms.html`}>Read the Terms of Use</a></p>
          <h2>Operator and contact</h2>
          <p>Milka Yevhenii, Ukraine · <a href="mailto:mlkdesignweb@gmail.com">mlkdesignweb@gmail.com</a></p>
        </div>
      </div>
      <Header left={<BackButton onClick={onBack} />} center={<HeaderTitle title="Terms & Privacy" />} />
    </>
  );
}
