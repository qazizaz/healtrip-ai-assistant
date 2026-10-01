import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSummary, User } from './api';
import { T, type Lang } from './i18n';
import { IconClose, IconDots, IconEdit, IconGlobe, IconLogout, IconPlus, IconSearch, IconShield, IconSidebar, IconTrash } from './Icons';

type Group = 'today' | 'yesterday' | 'week' | 'month' | 'older';
function groupOf(iso: string): Group {
  const d = new Date(iso), now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime(), day = 86_400_000;
  if (t >= start) return 'today';
  if (t >= start - day) return 'yesterday';
  if (t >= start - 7 * day) return 'week';
  if (t >= start - 30 * day) return 'month';
  return 'older';
}

interface Props {
  user: User; lang: Lang; conversations: ConversationSummary[] | null; activeId?: string; isAdminRoute: boolean;
  open: boolean; onClose: () => void; onToggle: () => void;
  onNew: () => void; onRename: (id: string, title: string) => void; onDelete: (id: string) => void; onDeleteAll: () => void;
  onLang: () => void; onSignOut: () => void;
}

function Item({ c, active, lang, onRename, onDelete, onPick }: { c: ConversationSummary; active: boolean; lang: Lang; onRename: Props['onRename']; onDelete: Props['onDelete']; onPick: () => void }) {
  const t = T[lang];
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c.title);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off);
  }, [menu]);
  const commit = () => { const v = title.trim(); setEditing(false); if (v && v !== c.title) onRename(c.id, v); else setTitle(c.title); };

  return (
    <li ref={ref} className={`conv ${active ? 'active' : ''}`}>
      {editing ? (
        <input className="conv-edit" autoFocus value={title} maxLength={80} dir="auto" onChange={(e) => setTitle(e.target.value)}
          onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setTitle(c.title); setEditing(false); } }} />
      ) : (
        <a href={`#/c/${c.id}`} onClick={onPick} dir="auto" title={c.title}>{c.title}</a>
      )}
      {!editing && <button className="icon-btn conv-more" aria-label={t.menu} onClick={() => setMenu((m) => !m)}><IconDots /></button>}
      {menu && (
        <div className="popover">
          <button onClick={() => { setMenu(false); setEditing(true); }}><IconEdit /> {t.rename}</button>
          <button className="danger" onClick={() => { setMenu(false); if (confirm(t.confirmDelete)) onDelete(c.id); }}><IconTrash /> {t.delete}</button>
        </div>
      )}
    </li>
  );
}

export function Sidebar(p: Props) {
  const t = T[p.lang];
  const [q, setQ] = useState('');
  const [userMenu, setUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!userMenu) return;
    const off = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setUserMenu(false); };
    document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off);
  }, [userMenu]);

  const groups = useMemo(() => {
    const list = (p.conversations ?? []).filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase()));
    const order: Group[] = ['today', 'yesterday', 'week', 'month', 'older'];
    return order.map((g) => [g, list.filter((c) => groupOf(c.updatedAt) === g)] as const).filter(([, l]) => l.length > 0);
  }, [p.conversations, q]);
  const pick = () => { if (window.matchMedia('(max-width: 860px)').matches) p.onClose(); };

  return (
    <>
      <div className={`scrim ${p.open ? 'show' : ''}`} onClick={p.onClose} />
      <aside className={`sidebar ${p.open ? 'open' : ''}`} aria-label="Conversations">
        <div className="sb-top">
          <a href="#/" className="sb-brand" onClick={pick}><img src="/healtrip-mark.png" alt="" /><span dir="ltr">HealTrip<b>+</b></span></a>
          <button className="icon-btn" onClick={p.onToggle} aria-label={t.menu} title={t.menu}><span className="only-desktop"><IconSidebar /></span><span className="only-mobile"><IconClose /></span></button>
        </div>
        <button className="new-chat" onClick={() => { p.onNew(); pick(); }}><IconPlus /> {t.newChat}</button>
        <label className="sb-search"><IconSearch /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} dir="auto" /></label>

        <nav className="sb-list">
          {p.conversations === null && <div className="sb-skeleton"><span /><span /><span /></div>}
          {p.conversations?.length === 0 && <p className="sb-empty">{t.noChats}</p>}
          {p.conversations && p.conversations.length > 0 && groups.length === 0 && <p className="sb-empty">{t.noMatches}</p>}
          {groups.map(([g, list]) => (
            <section key={g}>
              <h4>{t[g]}</h4>
              <ul>{list.map((c) => <Item key={c.id} c={c} lang={p.lang} active={c.id === p.activeId && !p.isAdminRoute} onRename={p.onRename} onDelete={p.onDelete} onPick={pick} />)}</ul>
            </section>
          ))}
        </nav>

        <div className="sb-user" ref={menuRef}>
          {userMenu && (
            <div className="popover up">
              {p.user.role === 'admin' && (p.isAdminRoute
                ? <a href="#/" onClick={() => { setUserMenu(false); pick(); }}><IconShield /> {t.backToChat}</a>
                : <a href="#/admin" onClick={() => { setUserMenu(false); pick(); }}><IconShield /> {t.admin}</a>)}
              <button onClick={() => { setUserMenu(false); p.onLang(); }}><IconGlobe /> {t.language}</button>
              <button className="danger" onClick={() => { setUserMenu(false); if (confirm(t.confirmDeleteAll)) p.onDeleteAll(); }}><IconTrash /> {t.deleteAll}</button>
              <button onClick={() => { setUserMenu(false); p.onSignOut(); }}><IconLogout /> {t.signOut}</button>
            </div>
          )}
          <button className="user-btn" onClick={() => setUserMenu((m) => !m)} aria-expanded={userMenu}>
            {p.user.picture ? <img src={p.user.picture} alt="" referrerPolicy="no-referrer" className="avatar" /> : <span className="avatar initials">{(p.user.name || p.user.email).slice(0, 1).toUpperCase()}</span>}
            <span className="user-meta"><strong dir="auto">{p.user.name}</strong><small dir="ltr">{p.user.email}</small></span>
            {p.user.role === 'admin' && <span className="role-pill">admin</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
