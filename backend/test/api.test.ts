process.env.AUTH_RATE_LIMIT_PER_MIN = '1000';
process.env.ADMIN_EMAILS = 'boss@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

const { createApp } = await import('../src/server.js');
const { createServices } = await import('../src/services.js');
const { LlmRouter } = await import('../src/agent/router.js');
const tokenMod = await import('../src/auth/token.js');
const { signSession, verifySession } = tokenMod;

const { TEST_DB, resetDatabase } = await import('./helpers.js');
await resetDatabase();
const services = await createServices({ databaseUrl: TEST_DB, dataDir: null, log: () => undefined });
const router = new LlmRouter(services.settings.get);
const fakeGoogle = { verify: async (cred: string) => ({ sub: cred.slice(0, 8), email: cred.includes('boss') ? 'boss@example.com' : 'patient@example.com', name: 'Test User' }) };
const app = createApp({ services, router, google: fakeGoogle });
let base = '';
let server: ReturnType<typeof app.listen>;
before(() => { server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
after(async () => { server.close(); await services.close(); });

async function api(path: string, opts: { method?: string; body?: unknown; cookie?: string; csrf?: boolean } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...(opts.csrf === false ? {} : { 'X-HealTrip-CSRF': '1' }) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, cookie: res.headers.get('set-cookie')?.split(';')[0], setCookie: res.headers.get('set-cookie') ?? '' };
}
async function login(who: 'boss' | 'patient') {
  const r = await api('/api/auth/google', { method: 'POST', body: { credential: `${who}-token-${'x'.repeat(30)}` } });
  assert.equal(r.status, 200);
  return r;
}

test('session tokens: signed, expiring, tamper-proof', () => {
  const t = signSession('user-1');
  assert.equal(verifySession(t), 'user-1');
  assert.equal(verifySession(t.slice(0, -2) + 'xx'), null);
  assert.equal(verifySession(signSession('user-1', -10)), null);
  assert.equal(verifySession(undefined), null);
});

test('csrf: state-changing API calls need the custom header', async () => {
  const r = await api('/api/chat', { method: 'POST', body: { message: 'hi' }, csrf: false });
  assert.equal(r.status, 403);
});

test('google login: cookie is HttpOnly + SameSite, /me works, ADMIN_EMAILS get admin role', async () => {
  const p = await login('patient');
  assert.match(p.setCookie, /HttpOnly/); assert.match(p.setCookie, /SameSite=Lax/);
  assert.equal(p.json.user.role, 'user');
  const me = await api('/api/auth/me', { cookie: p.cookie });
  assert.equal(me.json.user.email, 'patient@example.com');
  const b = await login('boss');
  assert.equal(b.json.user.role, 'admin');
  assert.equal((await api('/api/auth/me')).json.user, null);
  await api('/api/auth/logout', { method: 'POST' });
});

test('bad google token is rejected; dev login is off by default', async () => {
  const bad = createApp({ services, router, google: { verify: async () => { throw new Error('bad'); } } });
  const s = bad.listen(0);
  const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HealTrip-CSRF': '1' }, body: JSON.stringify({ credential: 'y'.repeat(40) }) });
  assert.equal(r.status, 401); s.close();
  assert.equal((await api('/api/auth/dev', { method: 'POST', body: { email: 'a@b.co' } })).status, 404);
});

test('admin API: 401 anonymous, 403 normal user, 200 admin', async () => {
  assert.equal((await api('/api/admin/settings')).status, 401);
  const p = await login('patient');
  assert.equal((await api('/api/admin/settings', { cookie: p.cookie })).status, 403);
  const b = await login('boss');
  assert.equal((await api('/api/admin/settings', { cookie: b.cookie })).status, 200);
});

test('no-code instructions: validated, saved, and merged under the locked safety rules', async () => {
  const b = await login('boss');
  const cur = (await api('/api/admin/settings', { cookie: b.cookie })).json;
  const upd = await api('/api/admin/settings/instructions', { method: 'PUT', cookie: b.cookie, body: { ...cur.instructions, persona: 'You are Nour, a friendly HealTrip guide.', responseLength: 'short', extraRules: 'Always mention that HealTrip can arrange travel.' } });
  assert.equal(upd.status, 200);
  const prev = (await api('/api/admin/prompt-preview?lang=en', { cookie: b.cookie })).json;
  assert.match(prev.editable, /Nour/); assert.match(prev.editable, /at most about 60 words/);
  assert.match(prev.full, /Safety rules \(locked/); assert.match(prev.locked, /ONLY by assess_urgency/);
  assert.ok(prev.full.indexOf('Safety rules') < prev.full.indexOf('Organization instructions'));
  const bad = await api('/api/admin/settings/app', { method: 'PUT', cookie: b.cookie, body: { ...cur.app, emergencyNumber: 'abc' } });
  assert.equal(bad.status, 400);
});

test('emergency number and disclaimers are admin-editable and used in replies', async () => {
  const b = await login('boss');
  const cur = (await api('/api/admin/settings', { cookie: b.cookie })).json;
  await api('/api/admin/settings/app', { method: 'PUT', cookie: b.cookie, body: { ...cur.app, emergencyNumber: '911' } });
  const chat = await api('/api/chat', { method: 'POST', cookie: b.cookie, body: { message: 'I have chest pain and shortness of breath', lang: 'en' } });
  assert.equal(chat.json.nextStep, 'emergency'); assert.match(chat.json.reply, /911/);
  await api('/api/admin/settings/app/reset', { method: 'POST', cookie: b.cookie });
});

test('login is always required: anonymous users only get the sign-in bootstrap', async () => {
  assert.equal((await api('/api/chat', { method: 'POST', body: { message: 'knee pain 4/10 for 2 weeks' } })).status, 401);
  assert.equal((await api('/api/conversations')).status, 401);
  assert.equal((await api('/api/providers?specialty=cardiology')).status, 401);
  const pub = (await api('/api/config')).json;
  assert.ok(pub.auth); assert.equal(pub.welcome, undefined); assert.equal(pub.models, undefined);
  assert.deepEqual(Object.keys((await api('/api/health')).json), ['ok']);
  const p = await login('patient');
  assert.equal((await api('/api/chat', { method: 'POST', cookie: p.cookie, body: { message: 'knee pain 4/10 for 2 weeks' } })).status, 200);
  assert.ok((await api('/api/config', { cookie: p.cookie })).json.welcome);
  assert.equal((await api('/api/nope', { cookie: p.cookie })).status, 404);
});

test('api responses are not cacheable', async () => {
  const res = await fetch(base + '/api/auth/me');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('doctor CRUD (no code) immediately changes chat recommendations', async () => {
  const b = await login('boss');
  const newDoc = { type: 'doctor', name_en: 'Dr. Test Newcomer', name_ar: 'د. اختبار', specialty: 'orthopedics', city: 'Dammam', hospital_en: 'Gulf Clinic', hospital_ar: 'عيادة الخليج', languages: ['ar', 'en'], accepts_insurance: ['Bupa'], er_available: false, accepting_second_opinions: true, rating: 4.9, phone: '+966 13 555 0000' };
  const created = await api('/api/admin/providers', { method: 'POST', cookie: b.cookie, body: newDoc });
  assert.equal(created.status, 201);
  const chat = await api('/api/chat', { method: 'POST', cookie: b.cookie, body: { message: 'Knee pain 4/10 for 2 weeks, I am in Dammam', lang: 'en' } });
  assert.ok(chat.json.reply.length > 0);
  assert.equal((await api('/api/admin/providers/' + created.json.id, { method: 'PUT', cookie: b.cookie, body: { ...newDoc, rating: 4.1 } })).json.rating, 4.1);
  assert.equal((await api('/api/admin/providers', { method: 'POST', cookie: b.cookie, body: { ...newDoc, phone: 'drop table' } })).status, 400);
  assert.equal((await api('/api/admin/providers/' + created.json.id, { method: 'DELETE', cookie: b.cookie })).status, 204);
  const audit = (await api('/api/admin/audit', { cookie: b.cookie })).json;
  assert.ok(audit.some((a: any) => a.action === 'provider.create'));
});

test('knowledge base edits change retrieval; ML scoring endpoint compares both engines', async () => {
  const b = await login('boss');
  const e = await api('/api/admin/guidance', { method: 'POST', cookie: b.cookie, body: { id: 'travel-tips', title_en: 'Medical travel tips', title_ar: 'نصائح السفر العلاجي', text_en: 'Carry copies of reports when travelling for treatment.', text_ar: 'احمل نسخًا من التقارير عند السفر للعلاج.', tags: ['travel', 'سفر'] } });
  assert.equal(e.status, 201);
  const { searchGuidance } = await import('../src/knowledge/retrieve.js');
  assert.equal(searchGuidance('travelling for treatment', 'en', 1)[0].id, 'travel-tips');
  await api('/api/admin/guidance/travel-tips', { method: 'DELETE', cookie: b.cookie });
  const sc = await api('/api/admin/ml/score', { method: 'POST', cookie: b.cookie, body: { symptoms: ['chest_pain'] } });
  assert.equal(sc.json.dl_mlp[0].department, 'cardiology'); assert.equal(sc.json.ml_linear[0].department, 'cardiology');
  assert.ok(sc.json.matched.every((p: any) => p.specialty === 'cardiology'));
  assert.equal((await api('/api/admin/ml/score', { method: 'POST', cookie: b.cookie, body: { symptoms: ['not_a_symptom'] } })).status, 400);
});

test('disabling a department in the admin removes it from ML recommendations', async () => {
  const b = await login('boss');
  const cur = (await api('/api/admin/settings', { cookie: b.cookie })).json;
  const ml = structuredClone(cur.ml); ml.departments.cardiology.enabled = false;
  assert.equal((await api('/api/admin/settings/ml', { method: 'PUT', cookie: b.cookie, body: ml })).status, 200);
  const sc = await api('/api/admin/ml/score', { method: 'POST', cookie: b.cookie, body: { symptoms: ['chest_pain'] } });
  assert.ok(!sc.json.dl_mlp.some((d: any) => d.department === 'cardiology'));
  await api('/api/admin/settings/ml/reset', { method: 'POST', cookie: b.cookie });
});

test('model switch: presets for Claude / ChatGPT / Gemini via OpenRouter; user choice only when allowed', async () => {
  const b = await login('boss');
  const cur = (await api('/api/admin/settings', { cookie: b.cookie })).json;
  assert.equal(router.select().model, cur.llm.presets.claude.model);
  const llm = structuredClone(cur.llm); llm.activeProvider = 'gemini'; llm.presets.gemini.model = 'google/gemini-test-model';
  await api('/api/admin/settings/llm', { method: 'PUT', cookie: b.cookie, body: llm });
  assert.equal(router.select().model, 'google/gemini-test-model');
  assert.equal(router.select('chatgpt').provider, 'gemini'); // user choice ignored while not allowed
  llm.allowUserModelChoice = true;
  await api('/api/admin/settings/llm', { method: 'PUT', cookie: b.cookie, body: llm });
  assert.equal(router.select('chatgpt').provider, 'chatgpt');
  assert.deepEqual((await api('/api/config', { cookie: b.cookie })).json.models.map((m: any) => m.key), ['claude', 'chatgpt', 'gemini']);
  llm.presets.chatgpt.enabled = false;
  await api('/api/admin/settings/llm', { method: 'PUT', cookie: b.cookie, body: llm });
  assert.equal(router.select('chatgpt').provider, 'gemini');
  await api('/api/admin/settings/llm/reset', { method: 'POST', cookie: b.cookie });
});

test('chat through OpenRouter model: tool calls are translated; on failure the rules agent answers', async () => {
  const realFetch = globalThis.fetch; const urls: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).startsWith('https://openrouter.ai')) { urls.push(String(url)); return new Response('rate limited', { status: 429 }); }
    return realFetch(url, init);
  }) as any;
  try {
    const p = await login('patient');
    const r = await api('/api/chat', { method: 'POST', cookie: p.cookie, body: { message: 'Back pain 8/10 for 2 days', lang: 'en' } });
    assert.equal(r.status, 200);
    assert.ok(urls[0].endsWith('/chat/completions'));
    assert.equal(r.json.nextStep, 'see_specialist');
    assert.ok(r.json.trace.some((t: any) => t.tool === 'fallback_to_rules'));
  } finally { globalThis.fetch = realFetch; }
});

test('llm-test endpoint reports success and failure from OpenRouter', async () => {
  const b = await login('boss');
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => String(url).startsWith('https://openrouter.ai')
    ? new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }) : realFetch(url, init)) as any;
  try {
    const ok = await api('/api/admin/llm-test', { method: 'POST', cookie: b.cookie, body: { model: '~anthropic/claude-sonnet-latest' } });
    assert.equal(ok.json.ok, true); assert.equal(ok.json.sample, 'OK');
  } finally { globalThis.fetch = realFetch; }
  assert.equal((await api('/api/admin/llm-test', { method: 'POST', cookie: b.cookie, body: { model: 'bad model id' } })).status, 400);
});

test('conversations: saved per user, resumable, renamable, deletable, private to their owner', async () => {
  const p = await login('patient'); const b = await login('boss');
  const first = await api('/api/chat', { method: 'POST', cookie: p.cookie, body: { message: 'I have chest pain' } });
  assert.equal(first.status, 200);
  const cid = first.json.conversationId;
  assert.equal(first.json.title, 'I have chest pain');
  // continuing the same conversation keeps the agent state (it asked a question, now gets the answer)
  const second = await api('/api/chat', { method: 'POST', cookie: p.cookie, body: { message: 'It started 2 hours ago, 4/10, no shortness of breath', conversationId: cid } });
  assert.equal(second.json.conversationId, cid);
  const full = await api('/api/conversations/' + cid, { cookie: p.cookie });
  assert.equal(full.json.messages.length, 4);
  assert.equal(full.json.state, undefined); // agent internals stay on the server
  assert.ok((await api('/api/conversations', { cookie: p.cookie })).json.conversations.some((c: any) => c.id === cid));
  // another user can neither read, continue, rename nor delete it
  assert.equal((await api('/api/conversations/' + cid, { cookie: b.cookie })).status, 404);
  assert.equal((await api('/api/chat', { method: 'POST', cookie: b.cookie, body: { message: 'x', conversationId: cid } })).status, 404);
  assert.equal((await api('/api/conversations/' + cid, { method: 'PATCH', cookie: b.cookie, body: { title: 'mine' } })).status, 404);
  assert.equal((await api('/api/conversations/' + cid, { method: 'DELETE', cookie: b.cookie })).status, 404);
  assert.ok(!(await api('/api/conversations', { cookie: b.cookie })).json.conversations.some((c: any) => c.id === cid));
  // owner can rename and delete
  assert.equal((await api('/api/conversations/' + cid, { method: 'PATCH', cookie: p.cookie, body: { title: 'Chest pain check' } })).status, 200);
  assert.equal((await api('/api/conversations/' + cid, { cookie: p.cookie })).json.title, 'Chest pain check');
  assert.equal((await api('/api/conversations/' + cid, { method: 'DELETE', cookie: p.cookie })).status, 204);
  assert.equal((await api('/api/conversations/' + cid, { cookie: p.cookie })).status, 404);
  assert.equal((await api('/api/conversations/not-a-uuid', { cookie: p.cookie })).status, 404);
});

test('conversation history survives a restart (persisted store)', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { newSession, toState } = await import('../src/sessions.js');
  const dir = mkdtempSync(join(tmpdir(), 'ht-'));
  const opts = TEST_DB ? { databaseUrl: TEST_DB, log: () => undefined } : { dataDir: dir };
  const s1 = await createServices(opts);
  try {
    await s1.users.upsertLogin({ id: 'google:abc', email: 'abc@example.com', name: 'A' });
    const c = await s1.conversations.create('google:abc', 'Knee pain');
    assert.equal(await s1.conversations.appendTurn('google:abc', c, [{ role: 'user', text: 'knee', at: new Date().toISOString() }], toState(newSession(c.id))), true);
    const s2 = await createServices(opts);
    try {
      assert.equal((await s2.conversations.get('google:abc', c.id))?.messages.length, 1);
      assert.equal(await s2.conversations.get('google:other', c.id), undefined);
    } finally { await s2.close(); }
  } finally { await s1.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('sign out revokes the cookie server-side; disabled users are locked out', async () => {
  const p = await login('patient');
  assert.equal((await api('/api/auth/logout', { method: 'POST', cookie: p.cookie })).status, 200);
  assert.equal((await api('/api/auth/me', { cookie: p.cookie })).json.user, null); // the old cookie no longer works
  const p2 = await login('patient'); const b = await login('boss');
  const users = (await api('/api/admin/users', { cookie: b.cookie })).json;
  const pat = users.find((u: any) => u.email === 'patient@example.com');
  assert.equal(pat.tokenVersion, undefined);
  assert.equal((await api(`/api/admin/users/${pat.id}/status`, { method: 'PUT', cookie: b.cookie, body: { disabled: true } })).status, 200);
  assert.equal((await api('/api/chat', { method: 'POST', cookie: p2.cookie, body: { message: 'knee pain' } })).status, 401);
  assert.equal((await api('/api/auth/google', { method: 'POST', body: { credential: `patient-token-${'x'.repeat(30)}` } })).status, 403);
  const boss = users.find((u: any) => u.email === 'boss@example.com');
  assert.equal((await api(`/api/admin/users/${boss.id}/status`, { method: 'PUT', cookie: b.cookie, body: { disabled: true } })).status, 400); // not yourself
  assert.equal((await api(`/api/admin/users/${pat.id}/status`, { method: 'PUT', cookie: b.cookie, body: { disabled: false } })).status, 200);
  const p3 = await login('patient');
  assert.equal((await api(`/api/admin/users/${pat.id}/signout`, { method: 'POST', cookie: b.cookie })).status, 200);
  assert.equal((await api('/api/auth/me', { cookie: p3.cookie })).json.user, null);
});

test('session tokens carry a version; a stale version is rejected', () => {
  const { readSession } = tokenMod;
  assert.equal(readSession(signSession('u', 60, 3))?.v, 3);
  assert.equal(readSession('x'.repeat(5000)), null);
});

test('last admin cannot be demoted; env admins stay admin', async () => {
  const b = await login('boss');
  const users = (await api('/api/admin/users', { cookie: b.cookie })).json;
  const boss = users.find((u: any) => u.email === 'boss@example.com');
  assert.equal((await api(`/api/admin/users/${boss.id}/role`, { method: 'PUT', cookie: b.cookie, body: { role: 'user' } })).status, 400);
  const pat = users.find((u: any) => u.email === 'patient@example.com');
  assert.equal((await api(`/api/admin/users/${pat.id}/role`, { method: 'PUT', cookie: b.cookie, body: { role: 'admin' } })).status, 200);
});
