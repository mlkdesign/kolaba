// Start page, Sign up → e-mail code → Create profile, Log in, password reset, legal pages.
import { useState } from 'preact/hooks';
import { errorText, post, ProfileType } from '../api';
import { applySession, profiles, reloadSession, showToast, user } from '../state';
import { BASE, Icon } from '../ui';

const collage = ['7597242', '38393619', '5901081', '30981708', '15728690', '10432237', '6584521', '7845993', '13736675', '11410024',
  '39841118', '34213083', '7008573', '8456094', '36460762'].map((id) => `${BASE}demo/posters/ReelPoster${id}.jpg`);

type Step = 'start' | 'signup' | 'verify' | 'login' | 'forgot' | 'reset' | 'legal';

export function AuthFlow() {
  const [step, setStep] = useState<Step>('start');
  const [email, setEmail] = useState('');
  const go = (s: Step) => setStep(s);
  if (step === 'start') return <Start onSignup={() => go('signup')} onLogin={() => go('login')} onLegal={() => go('legal')} />;
  if (step === 'legal') return <Legal onBack={() => go('start')} />;
  if (step === 'signup') return <Signup onBack={() => go('start')} onSent={(e) => { setEmail(e); go('verify'); }} onLogin={() => go('login')} />;
  if (step === 'verify') return <Verify email={email} onBack={() => go('signup')} />;
  if (step === 'forgot') return <Forgot onBack={() => go('login')} onSent={(e) => { setEmail(e); go('reset'); }} />;
  if (step === 'reset') return <Reset email={email} onBack={() => go('forgot')} onDone={() => go('login')} />;
  return <Login onBack={() => go('start')} onForgot={() => go('forgot')} onVerify={(e) => { setEmail(e); go('verify'); }} />;
}

function Start({ onSignup, onLogin, onLegal }: { onSignup: () => void; onLogin: () => void; onLegal: () => void }) {
  return (
    <div class="start">
      <div class="start__collage" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((col) => (
          <div class="start__col">{[0, 1, 2, 3].map((i) => <img src={collage[(col * 3 + i) % collage.length]} alt="" />)}</div>
        ))}
      </div>
      <div class="start__ambient" />
      <div class="start__shade" />
      <div class="start__content">
        <div class="start__logo">kolaba<i>.</i></div>
        <div class="start__tagline">Where creators meet opportunity</div>
        <button class="btn" onClick={onSignup}>Create profile</button>
        <button class="btn secondary" style={{ marginTop: 10 }} onClick={onLogin}>Log in</button>
        <button class="muted" style={{ marginTop: 16, fontSize: 12 }} onClick={onLegal}>Test environment · Terms & Privacy</button>
        <nav aria-label="Legal documents" style={{ marginTop: 10, fontSize: 12, display: 'flex', justifyContent: 'center', gap: 20 }}><a href={`${import.meta.env.BASE_URL}privacy.html`}>Privacy Policy</a><a href={`${import.meta.env.BASE_URL}terms.html`}>Terms of Use</a></nav>
      </div>
    </div>
  );
}

function AuthPage({ title, lead, onBack, children }: { title: string; lead?: string; onBack: () => void; children: any }) {
  return (
    <div class="scroll no-tabbar">
      <header class="topbar"><button class="glass-btn" aria-label="Back" onClick={onBack}><Icon name="IconArrowLeft" /></button><span class="grow" /></header>
      <div class="auth">
        <h1>{title}</h1>
        {lead && <p class="lead">{lead}</p>}
        {children}
      </div>
    </div>
  );
}

function useSubmit<T>(fn: () => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (e?: Event) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return { busy, error, run, setError };
}

function Signup({ onBack, onSent, onLogin }: { onBack: () => void; onSent: (email: string) => void; onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agree, setAgree] = useState(false);
  const { busy, error, run, setError } = useSubmit(async () => {
    if (password !== confirm) { setError('Passwords don\'t match.'); return; }
    await post('/v1/auth/signup', { email, password });
    onSent(email.trim().toLowerCase());
  });
  return (
    <AuthPage title="Create profile" lead="Your e-mail and a password. We'll send a 6-digit code to confirm the address." onBack={onBack}>
      <form onSubmit={run}>
        <label class="field"><span class="field__label">E-mail</span>
          <input class="input" type="email" autoComplete="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} /></label>
        <label class="field"><span class="field__label">Password</span>
          <input class="input" type="password" autoComplete="new-password" minLength={8} required value={password} onInput={(e) => setPassword(e.currentTarget.value)} /></label>
        <label class="field"><span class="field__label">Confirm password</span>
          <input class="input" type="password" autoComplete="new-password" required value={confirm} onInput={(e) => setConfirm(e.currentTarget.value)} /></label>
        <button type="button" class="row" style={{ margin: '6px 4px 14px', fontSize: 13, textAlign: 'left' }} onClick={() => setAgree(!agree)}>
          <span class={`toggle ${agree ? 'is-on' : ''}`} style={{ transform: 'scale(.75)' }} />
          <span class="soft">I accept the test-environment Terms and Privacy notice</span>
        </button>
        <div class="form-error" role="alert">{error}</div>
        <button class="btn" disabled={busy || !agree || !email || password.length < 8}>{busy ? 'Sending code…' : 'Next step'}</button>
      </form>
      <button class="btn ghost" style={{ marginTop: 10 }} onClick={onLogin}>I already have an account</button>
    </AuthPage>
  );
}

function Verify({ email, onBack }: { email: string; onBack: () => void }) {
  const [code, setCode] = useState('');
  const { busy, error, run } = useSubmit(async () => {
    const data = await post('/v1/auth/verify', { email, code });
    applySession(data);
  });
  const resend = async () => {
    try { await post('/v1/auth/resend-code', { email }); showToast('A new code is on its way', 'ok'); } catch (e) { showToast(errorText(e), 'error'); }
  };
  return (
    <AuthPage title="Verify your e-mail" lead={`Enter the 6-digit code we sent to ${email}.`} onBack={onBack}>
      <form onSubmit={run}>
        <input class="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} aria-label="Code" />
        <div class="form-error" role="alert">{error}</div>
        <button class="btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
      </form>
      <button class="btn ghost" style={{ marginTop: 10 }} onClick={resend}>Send the code again</button>
    </AuthPage>
  );
}

function Login({ onBack, onForgot, onVerify }: { onBack: () => void; onForgot: () => void; onVerify: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit(async () => {
    try {
      applySession(await post('/v1/auth/login', { email, password }));
    } catch (e: any) {
      if (e?.code === 'verification_required') { onVerify(email.trim().toLowerCase()); return; }
      throw e;
    }
  });
  return (
    <AuthPage title="Log in" lead="Welcome back." onBack={onBack}>
      <form onSubmit={run}>
        <label class="field"><span class="field__label">E-mail</span>
          <input class="input" type="email" autoComplete="username" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} /></label>
        <label class="field"><span class="field__label">Password</span>
          <input class="input" type="password" autoComplete="current-password" required value={password} onInput={(e) => setPassword(e.currentTarget.value)} /></label>
        <div class="form-error" role="alert">{error}</div>
        <button class="btn" disabled={busy || !email || !password}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <button class="btn ghost" style={{ marginTop: 10 }} onClick={onForgot}>Forgot password?</button>
      <div class="notice">
        Test environment. Demo accounts (Creator PRO, Creator FREE, Business PRO, one person with several business profiles)
        are shared with testers separately — their profiles are marked <b>DEMO</b>.
      </div>
    </AuthPage>
  );
}

function Forgot({ onBack, onSent }: { onBack: () => void; onSent: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const { busy, error, run } = useSubmit(async () => { await post('/v1/auth/password/forgot', { email }); onSent(email.trim().toLowerCase()); });
  return (
    <AuthPage title="Reset password" lead="We'll e-mail you a 6-digit code." onBack={onBack}>
      <form onSubmit={run}>
        <input class="input" type="email" autoComplete="email" placeholder="E-mail" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        <div class="form-error" role="alert">{error}</div>
        <button class="btn" disabled={busy || !email}>Send code</button>
      </form>
    </AuthPage>
  );
}

function Reset({ email, onBack, onDone }: { email: string; onBack: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit(async () => {
    await post('/v1/auth/password/reset', { email, code, password });
    showToast('Password changed — log in with the new one', 'ok');
    onDone();
  });
  return (
    <AuthPage title="New password" lead={`Code from the e-mail to ${email}, and your new password.`} onBack={onBack}>
      <form onSubmit={run}>
        <input class="input code-input" inputMode="numeric" maxLength={6} value={code} onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))} aria-label="Code" />
        <input class="input" style={{ marginTop: 12 }} type="password" autoComplete="new-password" placeholder="New password (8+ characters)"
          value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
        <div class="form-error" role="alert">{error}</div>
        <button class="btn" disabled={busy || code.length !== 6 || password.length < 8}>Change password</button>
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
  const { busy, error, run } = useSubmit(async () => {
    await post('/v1/profiles', { type, displayName, username, city: city || null, country: country || null, category: category || null, bio });
    await reloadSession();
    const created = profiles.value.find((p) => p.username === username.toLowerCase());
    if (created) (await import('../state')).setActiveProfile(created.id);
    onDone?.();
  });
  return (
    <div class="scroll no-tabbar">
      <header class="topbar">
        {onCancel ? <button class="glass-btn" aria-label="Back" onClick={onCancel}><Icon name="IconArrowLeft" /></button> : <span />}
        <span class="grow" />
      </header>
      <div class="auth">
        <h1>Create your profile</h1>
        <p class="lead">{user.value?.email}</p>
        {types.length > 1 && (
          <>
            <button class={`choice ${type === 'creator' ? 'is-on' : ''}`} onClick={() => setType('creator')}>
              <Icon name="IconVideoCamera" size={28} />
              <div><div class="choice__title">Creator</div><div class="choice__sub">Portfolio, reels, apply to jobs from brands.</div></div>
            </button>
            <button class={`choice ${type === 'business' ? 'is-on' : ''}`} onClick={() => setType('business')}>
              <Icon name="IconBriefcase" size={28} />
              <div><div class="choice__title">Business</div><div class="choice__sub">Publish jobs and find creators. Up to 5, free.</div></div>
            </button>
          </>
        )}
        <form onSubmit={run} style={{ marginTop: 14 }}>
          <label class="field"><span class="field__label">{type === 'business' ? 'Business name' : 'Name'}</span>
            <input class="input" required maxLength={80} value={displayName} onInput={(e) => setDisplayName(e.currentTarget.value)} /></label>
          <label class="field"><span class="field__label">Username</span>
            <input class="input" required pattern="[a-zA-Z0-9._]{3,30}" value={username} placeholder="e.g. anna.ugc"
              onInput={(e) => setUsername(e.currentTarget.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))} /></label>
          <div class="row">
            <label class="field grow"><span class="field__label">City</span><input class="input" maxLength={60} value={city} onInput={(e) => setCity(e.currentTarget.value)} /></label>
            <label class="field grow"><span class="field__label">Country</span><input class="input" maxLength={60} value={country} onInput={(e) => setCountry(e.currentTarget.value)} /></label>
          </div>
          <label class="field"><span class="field__label">{type === 'business' ? 'Category' : 'Niche'}</span>
            <input class="input" maxLength={60} value={category} placeholder={type === 'business' ? 'Hotels / Resort' : 'Travel / Lifestyle UGC'}
              onInput={(e) => setCategory(e.currentTarget.value)} /></label>
          <label class="field"><span class="field__label">{type === 'business' ? 'Description' : 'Bio'}</span>
            <textarea class="textarea" maxLength={1000} value={bio} onInput={(e) => setBio(e.currentTarget.value)} /></label>
          <div class="form-error" role="alert">{error}</div>
          <button class="btn" disabled={busy || !displayName || username.length < 3}>{busy ? 'Creating…' : 'Create profile'}</button>
        </form>
      </div>
    </div>
  );
}

export function Legal({ onBack }: { onBack: () => void }) {
  return (
    <div class="scroll no-tabbar">
      <header class="topbar"><button class="glass-btn" aria-label="Back" onClick={onBack}><Icon name="IconArrowLeft" /></button>
        <div class="topbar__title">Terms & Privacy</div><span class="topbar__spacer" /></header>
      <div class="legal">
        <h2>KOLABA web test version</h2>
        <p>KOLABA connects creators and businesses. Demo profiles are fictional and the test may be reset. No payments are charged.</p>
        <h2>Legal documents</h2>
        <p><a href={`${import.meta.env.BASE_URL}privacy.html`}>Read the Privacy Policy</a></p>
        <p><a href={`${import.meta.env.BASE_URL}terms.html`}>Read the Terms of Use</a></p>
        <h2>Operator and contact</h2>
        <p>Milka Yevhenii, Ukraine · <a href="mailto:mlkdesignweb@gmail.com">mlkdesignweb@gmail.com</a></p>
      </div>
    </div>
  );
}
