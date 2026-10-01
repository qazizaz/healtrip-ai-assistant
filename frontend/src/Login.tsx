import { useEffect, useRef, useState } from 'react';
import { ApiError, call, type PublicConfig, type User } from './api';
import { T, type Lang } from './i18n';
import { IconGlobe, IconShield } from './Icons';

declare global { interface Window { google?: any } }

let gsiPromise: Promise<void> | undefined;
function loadGsi(): Promise<void> {
  gsiPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = () => resolve(); s.onerror = () => { gsiPromise = undefined; reject(new Error('gsi')); };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

const errorFor = (e: unknown, lang: Lang) => (e instanceof ApiError && e.data?.error === 'account_disabled' ? T[lang].disabled : T[lang].signInFailed);

/** "Sign in with Google" button. The ID token goes to our server, which verifies it with Google's keys and sets an HttpOnly cookie. */
export function GoogleButton({ clientId, lang, onUser, onError }: { clientId: string; lang: Lang; onUser: (u: User) => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    loadGsi().then(() => {
      if (cancelled || !ref.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: 'popup',
        callback: async (r: { credential: string }) => {
          try { onUser((await call<{ user: User }>('/api/auth/google', 'POST', { credential: r.credential })).user); }
          catch (e) { onError(errorFor(e, lang)); }
        },
      });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 300, locale: lang });
    }).catch(() => onError('Could not load Google sign-in. Check your connection and try again.'));
    return () => { cancelled = true; };
  }, [clientId, lang]);
  return <div ref={ref} className="gbtn" />;
}

function DevLogin({ lang, onUser, onError }: { lang: Lang; onUser: (u: User) => void; onError: (m: string) => void }) {
  const [email, setEmail] = useState('');
  return (
    <form className="devlogin" onSubmit={async (e) => {
      e.preventDefault();
      try { onUser((await call<{ user: User }>('/api/auth/dev', 'POST', { email })).user); } catch (err) { onError(errorFor(err, lang)); }
    }}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dev login: email" type="email" required />
      <button type="submit" className="btn-secondary">Dev sign in</button>
    </form>
  );
}

export function LoginPage({ cfg, lang, setLang, notice, onUser }: { cfg: PublicConfig; lang: Lang; setLang: (l: Lang) => void; notice?: string; onUser: (u: User) => void }) {
  const t = T[lang];
  const [error, setError] = useState('');
  return (
    <div className="login-page">
      <button className="lang-switch" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}><IconGlobe /> {t.language}</button>
      <div className="login-card">
        <img src="/healtrip-logo.png" alt="HealTrip+" className="login-logo" />
        <h1>{t.loginTitle}</h1>
        <p className="login-tagline">{t.tagline}</p>
        <p className="muted">{t.loginBody}</p>
        {notice && <p className="notice">{notice}</p>}
        <div className="login-actions">
          {cfg.auth.googleClientId && <GoogleButton clientId={cfg.auth.googleClientId} lang={lang} onUser={onUser} onError={setError} />}
          {cfg.auth.devLogin && <DevLogin lang={lang} onUser={onUser} onError={setError} />}
          {!cfg.auth.googleClientId && !cfg.auth.devLogin && <p className="error-text">{t.googleMissing}</p>}
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <p className="login-foot"><IconShield width={14} height={14} /> {t.loginFoot} {lang === 'ar' ? 'رقم الطوارئ' : 'Emergency'}: <strong dir="ltr">{cfg.emergencyNumber}</strong></p>
      </div>
    </div>
  );
}
