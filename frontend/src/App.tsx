import { useCallback, useEffect, useRef, useState } from 'react';
import Admin from './Admin';
import {
  deleteAllConversations, deleteConversation, getConfig, getMe, listConversations, logout, renameConversation,
  UNAUTHORIZED_EVENT, type Config, type ConversationSummary, type PublicConfig, type User,
} from './api';
import { Chat } from './Chat';
import { T, type Lang } from './i18n';
import { IconMenu, IconPlus, IconSidebar } from './Icons';
import { LoginPage } from './Login';
import { Sidebar } from './Sidebar';

// Per-browser conveniences only (never patient data).
const pref = {
  get: (k: string) => { try { return localStorage.getItem('healtrip.' + k) ?? ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { localStorage.setItem('healtrip.' + k, v); } catch { /* storage unavailable */ } },
};

type Route = { page: 'chat'; id?: string } | { page: 'admin' };
function parseRoute(hash: string): Route {
  if (hash === '#/admin') return { page: 'admin' };
  const m = /^#\/c\/([0-9a-f-]{36})$/i.exec(hash);
  return { page: 'chat', id: m?.[1] };
}
const isFull = (c: PublicConfig | Config | undefined): c is Config => !!c && 'welcome' in c;

function Splash() {
  return <div className="splash"><img src="/healtrip-logo.png" alt="HealTrip+" /><span className="dots"><i /><i /><i /></span></div>;
}

export default function App() {
  const [cfg, setCfg] = useState<PublicConfig | Config>();
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = still checking
  const [lang, setLangState] = useState<Lang>(() => (pref.get('lang') === 'ar' ? 'ar' : 'en'));
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [convs, setConvs] = useState<ConversationSummary[] | null>(null);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 860 && pref.get('sidebar') !== 'closed');
  const [modelChoice, setModelChoice] = useState(() => pref.get('model'));
  const [notice, setNotice] = useState('');
  const [bootError, setBootError] = useState(false);
  const t = T[lang];
  const userRef = useRef(user); userRef.current = user;

  const setLang = (l: Lang) => { setLangState(l); pref.set('lang', l); };
  const loadConfig = useCallback(() => getConfig().then(setCfg).catch(() => setBootError(true)), []);
  const refreshConvs = useCallback(() => listConversations().then(setConvs).catch(() => undefined), []);

  // Boot: who am I, and what does the UI need.
  useEffect(() => {
    Promise.all([getMe().then((r) => setUser(r.user)), loadConfig()]).catch(() => setBootError(true));
    const onHash = () => setRoute(parseRoute(location.hash));
    const onUnauthorized = () => { if (userRef.current) setNotice(T[pref.get('lang') === 'ar' ? 'ar' : 'en'].sessionEnded); setUser(null); };
    window.addEventListener('hashchange', onHash);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized); };
  }, [loadConfig]);

  // After sign-in (or sign-out) reload the config (full vs public) and the conversation list.
  useEffect(() => {
    if (user === undefined) return;
    loadConfig();
    if (user) refreshConvs(); else setConvs(null);
  }, [user, loadConfig, refreshConvs]);

  useEffect(() => {
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  useEffect(() => {
    const title = route.page === 'admin' ? t.admin : route.id ? convs?.find((c) => c.id === route.id)?.title : undefined;
    document.title = title ? `${title} · HealTrip+` : 'HealTrip+ · AI Patient Decision Assistant';
  }, [route, convs, t.admin]);
  // Non-admins cannot open the admin page.
  useEffect(() => { if (user && route.page === 'admin' && user.role !== 'admin') location.hash = '#/'; }, [user, route]);

  if (bootError && !cfg) return <div className="splash"><img src="/healtrip-logo.png" alt="HealTrip+" /><p>{t.error}</p><button className="btn-primary" onClick={() => location.reload()}>Retry</button></div>;
  if (user === undefined || !cfg) return <Splash />;
  if (!user) return <LoginPage cfg={cfg} lang={lang} setLang={setLang} notice={notice} onUser={(u) => { setNotice(''); setUser(u); }} />;
  if (!isFull(cfg)) return <Splash />;

  const toggleSidebar = () => setSidebar((s) => { pref.set('sidebar', s ? 'closed' : 'open'); return !s; });
  const signOut = async () => { await logout().catch(() => undefined); location.hash = '#/'; setUser(null); };
  const newChat = () => { location.hash = '#/'; };
  const activeId = route.page === 'chat' ? route.id : undefined;
  const currentTitle = activeId ? convs?.find((c) => c.id === activeId)?.title : route.page === 'admin' ? t.admin : t.newChat;

  return (
    <div className={`shell ${sidebar ? 'sb-open' : 'sb-closed'}`}>
      <Sidebar
        user={user} lang={lang} conversations={convs} activeId={activeId} isAdminRoute={route.page === 'admin'}
        open={sidebar} onClose={() => setSidebar(false)} onToggle={toggleSidebar} onNew={newChat}
        onRename={async (id, title) => { setConvs((l) => l?.map((c) => (c.id === id ? { ...c, title } : c)) ?? l); await renameConversation(id, title).catch(() => undefined); refreshConvs(); }}
        onDelete={async (id) => { await deleteConversation(id).catch(() => undefined); if (id === activeId) location.hash = '#/'; refreshConvs(); }}
        onDeleteAll={async () => { await deleteAllConversations().catch(() => undefined); location.hash = '#/'; refreshConvs(); }}
        onLang={() => setLang(lang === 'en' ? 'ar' : 'en')} onSignOut={signOut}
      />
      <div className="main">
        <header className="topbar">
          {!sidebar && <button className="icon-btn" onClick={toggleSidebar} aria-label={t.menu}><span className="only-desktop"><IconSidebar /></span><span className="only-mobile"><IconMenu /></span></button>}
          {!sidebar && <button className="icon-btn" onClick={newChat} aria-label={t.newChat} title={t.newChat}><IconPlus /></button>}
          <h2 className="topbar-title" dir="auto">{currentTitle ?? ''}</h2>
          {route.page === 'chat' && cfg.models.length > 0 && (
            <select className="model-select" value={modelChoice} aria-label={t.model}
              onChange={(e) => { setModelChoice(e.target.value); pref.set('model', e.target.value); }}>
              <option value="">{t.defaultModel}</option>
              {cfg.models.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          )}
          {route.page === 'admin' && <a className="btn-secondary" href="#/">{t.backToChat}</a>}
        </header>
        {route.page === 'admin' && user.role === 'admin'
          ? <div className="admin-wrap"><Admin /></div>
          : <Chat id={activeId} cfg={cfg} lang={lang} modelChoice={cfg.models.some((m) => m.key === modelChoice) ? modelChoice : ''}
              onCreated={(id) => { location.hash = `#/c/${id}`; }} onActivity={refreshConvs} />}
      </div>
    </div>
  );
}
