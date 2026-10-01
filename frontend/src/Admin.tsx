import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, call } from './api';

type Tab = 'overview' | 'model' | 'instructions' | 'ml' | 'doctors' | 'knowledge' | 'users' | 'app';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['model', 'AI model'], ['instructions', 'Instructions'], ['ml', 'Departments & ML'], ['doctors', 'Doctors & hospitals'], ['knowledge', 'Knowledge'], ['users', 'Users'], ['app', 'App settings']];

const Panel = ({ title, children }: { title?: string; children: ReactNode }) => <div className="panel">{title && <h3>{title}</h3>}{children}</div>;
const Field = ({ label, children }: { label: string; children: ReactNode }) => <div className="field"><label>{label}</label>{children}</div>;
const errText = (e: unknown) => (e instanceof ApiError ? (e.data?.issues?.join('; ') ?? e.data?.error ?? String(e.status)) : 'error');

/** Settings form helper: local draft + Save / Reset against /api/admin/settings/:section. */
function useSection(section: string) {
  const [draft, setDraft] = useState<any>();
  const [msg, setMsg] = useState('');
  useEffect(() => { call(`/api/admin/settings`).then((s) => setDraft(s[section])); }, [section]);
  const save = async () => { try { setDraft(await call(`/api/admin/settings/${section}`, 'PUT', draft)); setMsg('Saved. Applies immediately.'); } catch (e) { setMsg('Not saved: ' + errText(e)); } };
  const reset = async () => { if (confirm('Reset this section to defaults?')) { setDraft(await call(`/api/admin/settings/${section}/reset`, 'POST')); setMsg('Reset to defaults.'); } };
  const set = (patch: any) => setDraft((d: any) => ({ ...d, ...patch }));
  const Bar = () => <div className="row"><button onClick={save}>Save</button><button className="ghost" onClick={reset}>Reset to defaults</button><span className={msg.startsWith('Not') ? 'error' : 'ok'}>{msg}</span></div>;
  return { draft, set, setDraft, Bar };
}

function Overview() {
  const [o, setO] = useState<any>(); const [audit, setAudit] = useState<any[]>([]);
  useEffect(() => { call('/api/admin/overview').then(setO); call('/api/admin/audit').then(setAudit); }, []);
  if (!o) return null;
  const rt = o.runtime, st = o.stats;
  return (<>
    <Panel title="Runtime">
      <p>Database: <code>{o.storage === "postgres" ? "PostgreSQL" : "JSON files (dev fallback)"}</code> · AI mode: <code>{rt.mode}</code> · provider: <code>{rt.provider}</code> · model: <code>{rt.model}</code></p>
      {!rt.hasOpenRouterKey && <p className="error">No OPENROUTER_API_KEY on the server: the free rules agent is answering. Add the key to enable Claude / ChatGPT / Gemini.</p>}
      <p>Google login: {rt.googleConfigured ? <span className="ok">configured</span> : <span className="error">not configured (GOOGLE_CLIENT_ID)</span>}</p>
    </Panel>
    <Panel title={`Usage since ${new Date(st.since).toLocaleDateString()} (no patient text is stored)`}>
      <p>Conversations turns: <b>{st.total}</b> · fallbacks to rules: <b>{st.fallbacks}</b></p>
      {(['byNextStep', 'byUrgency', 'byDepartment', 'byModel', 'byLang'] as const).map((k) => <p key={k} className="muted">{k.replace('by', 'By ')}: {Object.entries(st[k]).map(([a, b]) => `${a} ${b}`).join(' · ') || 'none yet'}</p>)}
    </Panel>
    <Panel title="Recent admin changes">
      <table><tbody>{audit.slice(0, 15).map((a, i) => <tr key={i}><td>{new Date(a.at).toLocaleString()}</td><td>{a.actor}</td><td>{a.action}</td><td>{a.target} {a.summary}</td></tr>)}</tbody></table>
    </Panel>
  </>);
}

const KEYS = ['claude', 'chatgpt', 'gemini'] as const;
function ModelTab() {
  const { draft: d, set, Bar } = useSection('llm');
  const [q, setQ] = useState(''); const [pick, setPick] = useState<string>('claude'); const [found, setFound] = useState<any[]>([]); const [test, setTest] = useState<Record<string, string>>({}); const [note, setNote] = useState('');
  if (!d) return null;
  const setPreset = (k: string, patch: any) => set({ presets: { ...d.presets, [k]: { ...d.presets[k], ...patch } } });
  const browse = async () => { try { setFound((await call(`/api/admin/openrouter-models?q=${encodeURIComponent(q)}`)).models); setNote(''); } catch { setNote('Could not reach OpenRouter from the server.'); } };
  const runTest = async (k: string) => {
    setTest((t) => ({ ...t, [k]: 'testing…' }));
    try { const r = await call('/api/admin/llm-test', 'POST', { model: d.presets[k].model }); setTest((t) => ({ ...t, [k]: r.ok ? `works (${r.ms} ms)` : `failed: ${r.error}` })); }
    catch (e) { setTest((t) => ({ ...t, [k]: errText(e) })); }
  };
  return (<>
    <Panel title="Model switch (via OpenRouter)">
      <p className="muted">All language understanding runs through OpenRouter. Choose which family answers patients, and edit the OpenRouter model id for each. Aliases like <code>~anthropic/claude-sonnet-latest</code> follow the newest version.</p>
      {KEYS.map((k) => (
        <div key={k} className="panel">
          <div className="row">
            <label><input type="radio" name="active" checked={d.activeProvider === k} onChange={() => set({ activeProvider: k })} /> <b>Active</b></label>
            <input type="text" value={d.presets[k].label} onChange={(e) => setPreset(k, { label: e.target.value })} style={{ width: 110 }} />
            <label><input type="checkbox" checked={d.presets[k].enabled} onChange={(e) => setPreset(k, { enabled: e.target.checked })} /> enabled</label>
          </div>
          <Field label="OpenRouter model id"><input type="text" value={d.presets[k].model} onChange={(e) => setPreset(k, { model: e.target.value })} /></Field>
          <div className="row"><button className="ghost" onClick={() => runTest(k)}>Test this model</button><span className={test[k]?.startsWith('works') ? 'ok' : 'muted'}>{test[k]}</span><button className="ghost" onClick={() => setPick(k)}>{pick === k ? 'Browsing for this one' : 'Browse models for this one'}</button></div>
        </div>
      ))}
      <div className="row"><input type="text" placeholder="search OpenRouter models (e.g. claude, gpt, gemini)" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} /><button onClick={browse}>Search</button></div>
      {note && <p className="error">{note}</p>}
      <table><tbody>{found.map((m) => <tr key={m.id}><td><code>{m.id}</code></td><td>{m.name}</td><td>{m.tools ? <span className="ok">tools ✓</span> : <span className="error">no tools</span>}</td><td><button className="ghost" onClick={() => setPreset(pick, { model: m.id })}>use for {pick}</button></td></tr>)}</tbody></table>
      <p className="muted">Pick models that support tool calling (tools ✓); the agent depends on it.</p>
    </Panel>
    <Panel title="Behaviour">
      <div className="grid2">
        <Field label={`Temperature: ${d.temperature}`}><input type="range" min={0} max={1.5} step={0.1} value={d.temperature} onChange={(e) => set({ temperature: Number(e.target.value) })} /></Field>
        <Field label="Max reply tokens"><input type="number" min={100} max={2000} value={d.maxTokens} onChange={(e) => set({ maxTokens: Number(e.target.value) })} /></Field>
      </div>
      <div className="row"><label><input type="checkbox" checked={d.fallbackToRules} onChange={(e) => set({ fallbackToRules: e.target.checked })} /> If the model fails, answer with the free rules agent</label></div>
      <div className="row"><label><input type="checkbox" checked={d.allowUserModelChoice} onChange={(e) => set({ allowUserModelChoice: e.target.checked })} /> Let patients pick Claude / ChatGPT / Gemini in the chat</label></div>
      <Bar />
    </Panel>
  </>);
}

function Instructions() {
  const { draft: d, set, Bar } = useSection('instructions');
  const [lang, setLang] = useState<'en' | 'ar'>('en'); const [prev, setPrev] = useState<any>();
  const loadPrev = useCallback(() => call(`/api/admin/prompt-preview?lang=${lang}`).then(setPrev), [lang]);
  useEffect(() => { loadPrev(); }, [loadPrev]);
  if (!d) return null;
  const lines = (a: string[]) => a.join('\n'); const arr = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 4);
  return (<>
    <Panel title="Model instructions (no code)">
      <p className="muted">These shape the assistant's voice and scope. The safety rules (urgency, grounding, citations, no diagnosis) are locked in code and always come first.</p>
      <Field label="Persona"><textarea value={d.persona} onChange={(e) => set({ persona: e.target.value })} /></Field>
      <Field label="Tone"><textarea value={d.tone} onChange={(e) => set({ tone: e.target.value })} /></Field>
      <Field label="Additional rules (one per line is fine)"><textarea value={d.extraRules} onChange={(e) => set({ extraRules: e.target.value })} /></Field>
      <Field label="Topics the assistant must not discuss"><textarea value={d.forbiddenTopics} onChange={(e) => set({ forbiddenTopics: e.target.value })} /></Field>
      <div className="grid2">
        <Field label="Reply length"><select value={d.responseLength} onChange={(e) => set({ responseLength: e.target.value })}><option value="short">Short (~60 words)</option><option value="medium">Medium (~120 words)</option><option value="detailed">Detailed (~200 words)</option></select></Field>
        <Field label="Arabic style"><select value={d.arabicStyle} onChange={(e) => set({ arabicStyle: e.target.value })}><option value="msa">Modern Standard Arabic</option><option value="gulf">Friendly, light Gulf warmth</option></select></Field>
      </div>
    </Panel>
    <Panel title="Welcome text and example prompts (shown in the chat)">
      <div className="grid2">
        <Field label="Welcome (English)"><textarea value={d.welcome_en} onChange={(e) => set({ welcome_en: e.target.value })} /></Field>
        <Field label="Welcome (Arabic)"><textarea dir="rtl" value={d.welcome_ar} onChange={(e) => set({ welcome_ar: e.target.value })} /></Field>
        <Field label="Example prompts, English (one per line, max 4)"><textarea value={lines(d.examplePrompts_en)} onChange={(e) => set({ examplePrompts_en: arr(e.target.value) })} /></Field>
        <Field label="Example prompts, Arabic (one per line, max 4)"><textarea dir="rtl" value={lines(d.examplePrompts_ar)} onChange={(e) => set({ examplePrompts_ar: arr(e.target.value) })} /></Field>
      </div>
      <Bar />
      <button className="ghost" onClick={loadPrev}>Refresh prompt preview after saving</button>
    </Panel>
    <Panel title="What the model actually receives">
      <div className="row"><button className={lang === 'en' ? '' : 'ghost'} onClick={() => setLang('en')}>English</button><button className={lang === 'ar' ? '' : 'ghost'} onClick={() => setLang('ar')}>العربية</button></div>
      {prev && <><div className="locked">{prev.locked}</div><div className="editable">{prev.editable}</div></>}
    </Panel>
  </>);
}

function MlTab() {
  const { draft: d, set, Bar } = useSection('ml');
  const [info, setInfo] = useState<any>(); const [sel, setSel] = useState<string[]>([]); const [res, setRes] = useState<any>(); const [f, setF] = useState('');
  useEffect(() => { call('/api/admin/ml').then(setInfo); }, []);
  if (!d || !info) return null;
  const setDept = (k: string, patch: any) => set({ departments: { ...d.departments, [k]: { ...d.departments[k], ...patch } } });
  const score = async () => setRes(await call('/api/admin/ml/score', 'POST', { symptoms: sel }));
  const Scores = ({ rows }: { rows: any[] }) => <>{rows.map((r) => <div key={r.department}><span style={{ display: 'inline-block', width: 150 }}>{d.departments[r.department]?.name_en ?? r.department}</span><span className="barwrap"><div className="bar" style={{ width: `${r.score * 100}%` }} /></span> {(r.score * 100).toFixed(0)}%</div>)}</>;
  return (<>
    <Panel title="ML / DL department scoring">
      <p className="muted">Symptoms (read from the patient's words by the OpenRouter model) are scored by a trained model to pick the department; doctors are then matched from that department. Emergencies are never routed by this model.</p>
      <div className="grid2">
        <Field label="Scoring engine"><select value={d.engine} onChange={(e) => set({ engine: e.target.value })}><option value="dl_mlp">Deep learning (neural network)</option><option value="ml_linear">Machine learning (logistic regression)</option><option value="off">Off (rules only)</option></select></Field>
        <Field label="Departments considered (top K)"><input type="number" min={1} max={3} value={d.topK} onChange={(e) => set({ topK: Number(e.target.value) })} /></Field>
        <Field label={`Minimum score to trust the model: ${Math.round(d.minScore * 100)}%`}><input type="range" min={0} max={1} step={0.05} value={d.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} /></Field>
      </div>
      <table><thead><tr><th>Department</th><th>On</th><th>Name (EN)</th><th>Name (AR)</th></tr></thead><tbody>
        {Object.entries<any>(d.departments).map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td><input type="checkbox" checked={v.enabled} onChange={(e) => setDept(k, { enabled: e.target.checked })} /></td><td><input type="text" value={v.name_en} onChange={(e) => setDept(k, { name_en: e.target.value })} /></td><td><input type="text" dir="rtl" value={v.name_ar} onChange={(e) => setDept(k, { name_ar: e.target.value })} /></td></tr>)}
      </tbody></table>
      <Bar />
    </Panel>
    <Panel title="Model cards">
      {info.cards.map((c: any) => <p key={c.engine}><code>{c.engine}</code> ({c.type}): top-1 {(c.metrics.top1_accuracy * 100).toFixed(1)}%, top-2 {(c.metrics.top2_accuracy * 100).toFixed(1)}% on held-out data</p>)}
      <p className="error">Trained on {info.meta.trainedOn}. Accuracy shows how well the models learn that table, not clinical accuracy. Replace with real, consented, clinician-labelled data (ml/train.py) before real use.</p>
    </Panel>
    <Panel title="Try it: symptoms → department">
      <input type="text" placeholder="filter symptoms" value={f} onChange={(e) => setF(e.target.value)} />
      <div className="symgrid">{info.symptoms.filter((s: any) => !f || s.label_en.includes(f.toLowerCase())).map((s: any) => <label key={s.id} className={sel.includes(s.id) ? 'on' : ''}><input type="checkbox" hidden checked={sel.includes(s.id)} onChange={() => setSel((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id].slice(0, 8)))} />{s.label_en}</label>)}</div>
      <div className="row"><button onClick={score} disabled={!sel.length}>Score</button><span className="muted">{sel.length} selected (max 8)</span></div>
      {res && <div className="grid2"><div><b>Neural network</b><Scores rows={res.dl_mlp} /></div><div><b>Logistic regression</b><Scores rows={res.ml_linear} /></div><div style={{ gridColumn: '1/-1' }}><b>Matched doctors/hospitals (active engine: {res.activeEngine})</b>{res.matched.map((p: any) => <div key={p.id}>{p.name_en} · {p.city} · rating {p.rating}</div>)}</div></div>}
    </Panel>
  </>);
}

const blank = { type: 'doctor', name_en: '', name_ar: '', specialty: 'cardiology', city: '', hospital_en: '', hospital_ar: '', languages: ['ar', 'en'], accepts_insurance: [], er_available: false, accepting_second_opinions: false, rating: 4.5, phone: '' };
function Doctors() {
  const [list, setList] = useState<any[]>([]); const [e, setE] = useState<any>(null); const [msg, setMsg] = useState(''); const [depts, setDepts] = useState<string[]>([]);
  const load = () => call('/api/admin/providers').then(setList);
  useEffect(() => { load(); call('/api/admin/settings').then((s) => setDepts(Object.keys(s.ml.departments))); }, []);
  const save = async () => { try { await call(e.id ? `/api/admin/providers/${e.id}` : '/api/admin/providers', e.id ? 'PUT' : 'POST', { ...e, id: undefined }); setE(null); setMsg('Saved.'); load(); } catch (x) { setMsg('Not saved: ' + errText(x)); } };
  const del = async (id: string) => { if (confirm('Delete this entry?')) { await call(`/api/admin/providers/${id}`, 'DELETE'); load(); } };
  const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const up = (patch: any) => setE((x: any) => ({ ...x, ...patch }));
  return (<>
    <Panel title="Doctors and hospitals">
      <div className="row"><button onClick={() => setE({ ...blank })}>Add new</button><span className={msg.startsWith('Not') ? 'error' : 'ok'}>{msg}</span></div>
      <table><thead><tr><th>Name</th><th>Department</th><th>City</th><th>Rating</th><th /></tr></thead><tbody>{list.map((p) => <tr key={p.id}><td>{p.name_en}<div className="muted">{p.hospital_en}</div></td><td>{p.specialty}</td><td>{p.city}</td><td>{p.rating}</td><td><button className="ghost" onClick={() => setE({ ...p })}>Edit</button> <button className="ghost" onClick={() => del(p.id)}>Delete</button></td></tr>)}</tbody></table>
    </Panel>
    {e && <Panel title={e.id ? `Edit ${e.id}` : 'New entry'}>
      <div className="grid2">
        <Field label="Type"><select value={e.type} onChange={(x) => up({ type: x.target.value })}><option value="doctor">Doctor</option><option value="hospital">Hospital / department</option></select></Field>
        <Field label="Department"><select value={e.specialty} onChange={(x) => up({ specialty: x.target.value })}>{depts.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Name (English)"><input type="text" value={e.name_en} onChange={(x) => up({ name_en: x.target.value })} /></Field>
        <Field label="Name (Arabic)"><input type="text" dir="rtl" value={e.name_ar} onChange={(x) => up({ name_ar: x.target.value })} /></Field>
        <Field label="Hospital (English)"><input type="text" value={e.hospital_en} onChange={(x) => up({ hospital_en: x.target.value })} /></Field>
        <Field label="Hospital (Arabic)"><input type="text" dir="rtl" value={e.hospital_ar} onChange={(x) => up({ hospital_ar: x.target.value })} /></Field>
        <Field label="City"><input type="text" value={e.city} onChange={(x) => up({ city: x.target.value })} /></Field>
        <Field label="Phone"><input type="text" value={e.phone} onChange={(x) => up({ phone: x.target.value })} /></Field>
        <Field label="Languages (codes, comma separated)"><input type="text" value={e.languages.join(', ')} onChange={(x) => up({ languages: csv(x.target.value) })} /></Field>
        <Field label="Insurance accepted (comma separated)"><input type="text" value={e.accepts_insurance.join(', ')} onChange={(x) => up({ accepts_insurance: csv(x.target.value) })} /></Field>
        <Field label="Rating (0-5)"><input type="number" min={0} max={5} step={0.1} value={e.rating} onChange={(x) => up({ rating: Number(x.target.value) })} /></Field>
      </div>
      <div className="row"><label><input type="checkbox" checked={e.er_available} onChange={(x) => up({ er_available: x.target.checked })} /> Emergency department on site</label><label><input type="checkbox" checked={e.accepting_second_opinions} onChange={(x) => up({ accepting_second_opinions: x.target.checked })} /> Accepts second opinions</label></div>
      <div className="row"><button onClick={save}>Save</button><button className="ghost" onClick={() => setE(null)}>Cancel</button></div>
    </Panel>}
  </>);
}

const blankG = { id: '', title_en: '', title_ar: '', text_en: '', text_ar: '', tags: [], source: 'HealTrip admin' };
function Knowledge() {
  const [list, setList] = useState<any[]>([]); const [e, setE] = useState<any>(null); const [isNew, setIsNew] = useState(false); const [msg, setMsg] = useState('');
  const load = () => call('/api/admin/guidance').then(setList); useEffect(() => { load(); }, []);
  const up = (patch: any) => setE((x: any) => ({ ...x, ...patch }));
  const save = async () => { try { await call(isNew ? '/api/admin/guidance' : `/api/admin/guidance/${e.id}`, isNew ? 'POST' : 'PUT', e); setE(null); setMsg('Saved. Search index rebuilt.'); load(); } catch (x) { setMsg('Not saved: ' + errText(x)); } };
  return (<>
    <Panel title="Knowledge base (the only source of medical advice the assistant may use)">
      <p className="muted">Passages are retrieved by keyword (BM25) and cited under "Sources used". Keep them short, safe and clinician-reviewed.</p>
      <div className="row"><button onClick={() => { setE({ ...blankG }); setIsNew(true); }}>Add passage</button><span className={msg.startsWith('Not') ? 'error' : 'ok'}>{msg}</span></div>
      <table><tbody>{list.map((g) => <tr key={g.id}><td><code>{g.id}</code></td><td>{g.title_en}</td><td><button className="ghost" onClick={() => { setE({ ...g }); setIsNew(false); }}>Edit</button> <button className="ghost" onClick={async () => { if (confirm('Delete?')) { await call(`/api/admin/guidance/${g.id}`, 'DELETE'); load(); } }}>Delete</button></td></tr>)}</tbody></table>
    </Panel>
    {e && <Panel title={isNew ? 'New passage' : `Edit ${e.id}`}>
      <div className="grid2">
        {isNew && <Field label="Id (lowercase, digits, dashes)"><input type="text" value={e.id} onChange={(x) => up({ id: x.target.value })} /></Field>}
        <Field label="Title (English)"><input type="text" value={e.title_en} onChange={(x) => up({ title_en: x.target.value })} /></Field>
        <Field label="Title (Arabic)"><input type="text" dir="rtl" value={e.title_ar} onChange={(x) => up({ title_ar: x.target.value })} /></Field>
        <Field label="Text (English)"><textarea value={e.text_en} onChange={(x) => up({ text_en: x.target.value })} /></Field>
        <Field label="Text (Arabic)"><textarea dir="rtl" value={e.text_ar} onChange={(x) => up({ text_ar: x.target.value })} /></Field>
        <Field label="Search keywords (comma separated, EN + AR)"><input type="text" value={e.tags.join(', ')} onChange={(x) => up({ tags: x.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} /></Field>
        <Field label="Source / reviewer"><input type="text" value={e.source} onChange={(x) => up({ source: x.target.value })} /></Field>
      </div>
      <div className="row"><button onClick={save}>Save</button><button className="ghost" onClick={() => setE(null)}>Cancel</button></div>
    </Panel>}
  </>);
}

function Users() {
  const [list, setList] = useState<any[]>([]); const [msg, setMsg] = useState('');
  const load = () => call('/api/admin/users').then(setList); useEffect(() => { load(); }, []);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); setMsg(''); } catch (e) { setMsg(errText(e)); } load(); };
  const role = (id: string, r: string) => act(() => call(`/api/admin/users/${encodeURIComponent(id)}/role`, 'PUT', { role: r }));
  const status = (id: string, disabled: boolean) => act(() => call(`/api/admin/users/${encodeURIComponent(id)}/status`, 'PUT', { disabled }));
  const signout = (id: string) => act(() => call(`/api/admin/users/${encodeURIComponent(id)}/signout`, 'POST'));
  return <Panel title="Users (everyone who signed in with Google)"><p className="error">{msg}</p>
    <div className="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Last login</th><th>Chats</th><th>Role</th><th>Access</th><th></th></tr></thead><tbody>{list.map((u) => <tr key={u.id} className={u.disabled ? 'row-disabled' : ''}>
      <td>{u.name}</td><td>{u.email}</td><td>{new Date(u.lastLoginAt).toLocaleString()}</td><td>{u.conversations ?? 0}</td>
      <td><select value={u.role} onChange={(e) => role(u.id, e.target.value)}><option value="user">user</option><option value="admin">admin</option></select></td>
      <td>{u.disabled ? <button onClick={() => status(u.id, false)}>Enable</button> : <button className="ghost danger" onClick={() => confirm(`Disable ${u.email}? They are signed out immediately and cannot sign in again until re-enabled.`) && status(u.id, true)}>Disable</button>}</td>
      <td><button className="ghost" onClick={() => signout(u.id)} title="Revoke all of this user's login sessions">Sign out everywhere</button></td>
    </tr>)}</tbody></table></div>
    <p className="muted">Emails listed in ADMIN_EMAILS are always admins and cannot be disabled. Admins can see how many chats a user has, never their content.</p></Panel>;
}

function AppSettings() {
  const { draft: d, set, Bar } = useSection('app');
  if (!d) return null;
  return (<Panel title="App settings">
    <Field label="Emergency number shown to patients"><input type="text" value={d.emergencyNumber} onChange={(e) => set({ emergencyNumber: e.target.value })} /></Field>
    <div className="grid2"><Field label="Disclaimer (English)"><textarea value={d.disclaimer_en} onChange={(e) => set({ disclaimer_en: e.target.value })} /></Field><Field label="Disclaimer (Arabic)"><textarea dir="rtl" value={d.disclaimer_ar} onChange={(e) => set({ disclaimer_ar: e.target.value })} /></Field></div>
    <Bar />
  </Panel>);
}

export default function Admin() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="admin" dir="ltr">
      <div className="tabs">{TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : 'ghost'} onClick={() => setTab(k)}>{label}</button>)}</div>
      {tab === 'overview' && <Overview />}{tab === 'model' && <ModelTab />}{tab === 'instructions' && <Instructions />}{tab === 'ml' && <MlTab />}
      {tab === 'doctors' && <Doctors />}{tab === 'knowledge' && <Knowledge />}{tab === 'users' && <Users />}{tab === 'app' && <AppSettings />}
    </div>
  );
}
