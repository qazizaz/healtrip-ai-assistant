import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, getConversation, sendMessage, type Config, type Message, type Provider, type Reply } from './api';
import { T, type Lang } from './i18n';
import { IconAlert, IconCheck, IconCopy, IconPhone, IconSend, IconStar } from './Icons';

const MAX_CHARS = 1000;

function ProviderCard({ p, lang, cfg }: { p: Provider; lang: Lang; cfg: Config }) {
  const t = T[lang];
  const dept = cfg.departments[p.specialty]?.[lang] ?? p.specialty;
  return (
    <div className="pcard">
      <div className="pcard-head">
        <span className={`ptype ${p.type}`}>{p.type === 'hospital' ? '🏥' : '🩺'}</span>
        <div className="pcard-title">
          <strong dir="auto">{lang === 'ar' ? p.name_ar : p.name_en}</strong>
          <span className="muted" dir="auto">{dept}</span>
        </div>
        {p.match_score !== undefined && <span className="match" title={t.match}>{Math.round(p.match_score * 100)}%</span>}
      </div>
      <div className="pcard-body muted" dir="auto">{lang === 'ar' ? p.hospital_ar : p.hospital_en} · {p.city}</div>
      <div className="pcard-meta">
        <span><IconStar width={13} height={13} className="star" /> {p.rating.toFixed(1)}</span>
        <span>{t.languages}: {p.languages.join(', ').toUpperCase()}</span>
        {p.er_available && <span className="tag-er">{t.er}</span>}
      </div>
      <a className="pcard-call" href={`tel:${p.phone.replace(/[^\d+]/g, '')}`}><IconPhone width={14} height={14} /> <span dir="ltr">{p.phone}</span></a>
    </div>
  );
}

function CopyButton({ text, lang }: { text: string; lang: Lang }) {
  const [done, setDone] = useState(false);
  return (
    <button className="icon-btn small" title={T[lang].copy} aria-label={T[lang].copy}
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined)}>
      {done ? <IconCheck width={15} height={15} /> : <IconCopy width={15} height={15} />}
    </button>
  );
}

function AssistantMessage({ m, d, lang, cfg }: { m: Message; d?: Reply; lang: Lang; cfg: Config }) {
  const t = T[lang];
  const emergency = d?.nextStep === 'emergency';
  return (
    <div className="msg assistant">
      <img src="/healtrip-mark.png" alt="" className="msg-avatar" />
      <div className="msg-body">
        {emergency && (
          <div className="emergency-banner" role="alert">
            <IconAlert /> <strong>{t.emergency}</strong>
            <a href={`tel:${cfg.emergencyNumber}`} className="emergency-call"><IconPhone width={14} height={14} /> {t.emergencyCall} <span dir="ltr">{cfg.emergencyNumber}</span></a>
          </div>
        )}
        {d?.urgency && !emergency && <span className={`chip ${d.urgency}`}>{t.urgency[d.urgency] ?? d.urgency}</span>}
        <div className="msg-text" dir="auto">{m.text}</div>
        {d && d.providers.length > 0 && <div className="pgrid">{d.providers.map((p) => <ProviderCard key={p.id} p={p} lang={lang} cfg={cfg} />)}</div>}
        {d && d.sources.length > 0 && (
          <details className="fold"><summary>{t.sources} ({d.sources.length})</summary>
            <ul>{d.sources.map((s) => <li key={s.id} dir="auto"><strong>{s.title}:</strong> {s.text}</li>)}</ul>
          </details>
        )}
        <div className="msg-actions">
          <CopyButton text={m.text} lang={lang} />
          {d && d.trace.length > 0 && (
            <details className="fold inline"><summary>{t.trace}</summary>
              <ul dir="ltr">{d.trace.map((x, j) => <li key={j}><span className={x.ok ? 'ok' : 'bad'}>{x.ok ? '✓' : '✗'}</span> <code>{x.tool}</code> {x.summary}</li>)}</ul>
              <p className="muted small" dir="ltr">model: {d.model.provider}{d.model.id ? ` · ${d.model.id}` : ''}</p>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  id?: string; cfg: Config; lang: Lang; modelChoice: string;
  onCreated: (id: string) => void; onActivity: () => void;
}

export function Chat({ id, cfg, lang, modelChoice, onCreated, onActivity }: Props) {
  const t = T[lang];
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [convId, setConvId] = useState<string | undefined>(id);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [limit, setLimit] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const convRef = useRef(convId); convRef.current = convId;
  const routeRef = useRef(id); routeRef.current = id;

  // Load the conversation when the route changes (but not when we just created it ourselves).
  useEffect(() => {
    setError(''); setNotFound(false);
    if (id !== convRef.current) setLoading(false); // a reply still in flight for another chat will not be shown here
    if (!id) { setConvId(undefined); setMsgs([]); setLimit(false); setInput(''); taRef.current?.focus(); return; }
    if (id === convRef.current && msgs.length > 0) return;
    let live = true;
    setFetching(true); setConvId(id); setMsgs([]);
    getConversation(id).then((c) => { if (live) { setMsgs(c.messages); setLimit(c.limitReached); } })
      .catch((e) => { if (live) { if (e instanceof ApiError && e.status === 404) setNotFound(true); else setError(t.error); } })
      .finally(() => { if (live) setFetching(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: msgs.length > 2 ? 'smooth' : 'auto' }); }, [msgs, loading]);
  useLayoutEffect(() => { const ta = taRef.current; if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; } }, [input]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || loading || limit) return;
    setInput(''); setError(''); setLoading(true);
    const optimistic: Message = { role: 'user', text: message, at: new Date().toISOString() };
    setMsgs((m) => [...m, optimistic]);
    const startRoute = id;
    try {
      const r = await sendMessage(message, lang, convId, modelChoice);
      if (routeRef.current !== startRoute) { onActivity(); return; } // user moved to another chat meanwhile
      const { conversationId, title: _title, limitReached, ...reply } = r;
      setMsgs((m) => [...m, { role: 'assistant', text: r.reply, at: new Date().toISOString(), data: reply }]);
      setLimit(limitReached);
      if (!convId) { setConvId(conversationId); convRef.current = conversationId; onCreated(conversationId); }
      onActivity();
    } catch (e) {
      if (routeRef.current !== startRoute) return;
      setMsgs((m) => m.filter((x) => x !== optimistic));
      setInput(message);
      if (e instanceof ApiError && e.status === 401) return; // app shows the sign-in page
      setError(e instanceof ApiError && e.status === 429 ? t.rateLimited : e instanceof ApiError && e.status === 409 ? t.busy : e instanceof ApiError && e.status === 404 ? t.notFound : t.error);
    } finally { if (routeRef.current === startRoute) { setLoading(false); setTimeout(() => taRef.current?.focus(), 0); } }
  }

  const empty = !fetching && msgs.length === 0 && !notFound;

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        {empty ? (
          <div className="welcome">
            <img src="/healtrip-logo.png" alt="HealTrip+" className="welcome-logo" />
            <p className="welcome-text" dir="auto">{cfg.welcome[lang]}</p>
            <div className="suggestions">
              {cfg.examples[lang].map((ex) => <button key={ex} className="suggestion" onClick={() => send(ex)} dir="auto" disabled={loading}>{ex}</button>)}
            </div>
          </div>
        ) : (
          <div className="thread">
            {fetching && <div className="thread-loading"><span className="dots"><i /><i /><i /></span></div>}
            {notFound && <div className="notice">{t.notFound} <a href="#/">{t.newChat}</a></div>}
            {msgs.map((m, i) => m.role === 'user'
              ? <div key={i} className="msg user"><div className="msg-text" dir="auto">{m.text}</div></div>
              : <AssistantMessage key={i} m={m} d={m.data} lang={lang} cfg={cfg} />)}
            {loading && (
              <div className="msg assistant">
                <img src="/healtrip-mark.png" alt="" className="msg-avatar pulse" />
                <div className="msg-body"><span className="typing">{t.thinking}<span className="dots"><i /><i /><i /></span></span></div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        {error && <div className="composer-error" role="alert">{error}</div>}
        {limit && <div className="composer-error info">{t.limit} <a href="#/">{t.newChat}</a></div>}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <textarea ref={taRef} value={input} rows={1} maxLength={MAX_CHARS} placeholder={t.placeholder} dir="auto" autoFocus
            disabled={limit || notFound} aria-label={t.placeholder}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }} />
          <div className="composer-side">
            {input.length > MAX_CHARS * 0.8 && <span className="count">{input.length}/{MAX_CHARS}</span>}
            <button type="submit" className="send-btn" disabled={loading || !input.trim() || limit} aria-label={t.send} title={t.send}><IconSend /></button>
          </div>
        </form>
        <p className="composer-note">{t.disclaimerShort} <strong dir="ltr">{cfg.emergencyNumber}</strong>.</p>
      </div>
    </div>
  );
}
