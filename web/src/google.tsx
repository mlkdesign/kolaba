// Sign in with Google (Google Identity Services). The official button opens Google's popup; its ID token goes to
// POST /v1/auth/google, which verifies it and answers with a KOLABA session. An address that already has a KOLABA
// account is linked only after its password is entered here (never merged by e-mail alone). No client secret exists
// on the web: the client id is public, it is the tokens' audience.
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { ApiError, errorText, post } from './api';
import { applySession, openSheet, showToast } from './state';
import { SheetFrame } from './ui';

/** The Google account's name after a Google sign-in — Create profile starts from it. */
export const googleName = signal<string | null>(null);

export const GOOGLE_CLIENT_ID = '888396863806-et1d0p9h08gaptueupl1c9lhg9dlivqa.apps.googleusercontent.com';

declare global { interface Window { google?: any } }

let loading: Promise<void> | null = null;
/** The GIS library, loaded once, only when a sign-in screen needs it. */
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = () => resolve(); s.onerror = () => { loading = null; reject(new Error('gis')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** The e-mail inside a Google ID token (display only — the server verifies the token). */
const emailOf = (credential: string) => {
  try { return JSON.parse(atob(credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email as string; } catch { return ''; }
};

async function finish(credential: string) {
  try {
    const session = await post<any>('/v1/auth/google', { credential });
    googleName.value = session.google?.name ?? null;
    applySession(session);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'google_link_required') { openLink(credential); return; }
    showToast(e instanceof ApiError && e.code === 'google_token_invalid' ? 'Google sign-in failed. Please try again.' : errorText(e), 'error');
  }
}

/** The address already has a KOLABA account: its password proves it is theirs, then Google is linked to it. */
function openLink(credential: string) {
  openSheet((close) => <LinkSheet credential={credential} close={close} />);
}

function LinkSheet({ credential, close }: { credential: string; close: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const email = emailOf(credential);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true); setError('');
    try { const session = await post<any>('/v1/auth/google', { credential, password }); close(); googleName.value = session.google?.name ?? null; applySession(session); showToast('Google is now linked to your account', 'ok'); }
    catch (err) {
      setError(err instanceof ApiError && err.code === 'invalid_credentials' ? 'Incorrect password. Please try again.'
        : err instanceof ApiError && err.code === 'google_token_invalid' ? 'The Google sign-in expired. Close this and continue with Google again.' : errorText(err));
    } finally { setBusy(false); }
  };
  return (
    <SheetFrame title="Link Google" close={close}>
      <form class="form-gap" onSubmit={submit} noValidate style={{ paddingBottom: 24 }}>
        <p class="link-google__text">A KOLABA account already uses <b>{email}</b>. Enter its password to link your Google account — your
          profiles, posts, contacts, messages and PRO stay as they are.</p>
        <label class="field"><img src={`${import.meta.env.BASE_URL}icons/IconKey.svg`} alt="" />
          <input type="password" autoComplete="current-password" placeholder="Your KOLABA password" value={password} autoFocus
            onInput={(e) => { setPassword(e.currentTarget.value); setError(''); }} /></label>
        {error && <div class="field-error" role="alert">{error}</div>}
        <button class="btn" type="submit" disabled={busy || !password}>{busy ? 'Please wait…' : 'Link and sign in'}</button>
      </form>
    </SheetFrame>
  );
}

/** Sign up / Log in with Google in KOLABA's style; the official GIS button (popup) takes the tap. */
export function GoogleButton({ intent }: { intent: 'Sign Up' | 'Log in' }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadGis().then(() => {
      if (!live || !box.current) return;
      const g = window.google.accounts.id;
      g.initialize({
        client_id: GOOGLE_CLIENT_ID, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true,
        context: intent === 'Sign Up' ? 'signup' : 'signin', itp_support: true,
        callback: (r: { credential?: string }) => { if (r.credential) void finish(r.credential); },
      });
      box.current.innerHTML = '';
      g.renderButton(box.current, {
        type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', logo_alignment: 'left', locale: 'en',
        text: intent === 'Sign Up' ? 'signup_with' : 'signin_with', width: Math.min(400, Math.max(200, box.current.clientWidth)),
      });
    }).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [intent]);
  // KOLABA's own button is what is seen (the same as Sign Up with Apple); Google's button lies exactly over it, almost
  // transparent, and takes the click — so the popup opens from Google's own button, as Google Identity Services needs.
  return (
    <div class="google-wrap">
      <button type="button" class="social-btn" tabIndex={failed ? 0 : -1} aria-hidden={!failed}
        onClick={() => failed && showToast('Google sign-in could not load. Check your connection and try again.', 'error')}>
        <img src={`${import.meta.env.BASE_URL}icons/IconGoogle.svg`} alt="" />{intent} with Google</button>
      {!failed && <div class="google-btn" ref={box} aria-label={`${intent} with Google`} />}
    </div>
  );
}
