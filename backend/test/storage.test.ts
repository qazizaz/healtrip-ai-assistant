import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { newSession, toState } from '../src/sessions.js';
import { createJsonStores, bundledProviders, filterProviders } from '../src/storage/json.js';
import { createPostgresStores } from '../src/storage/postgres.js';
import type { Stores } from '../src/storage/types.js';
import { SPECIALTIES } from '../src/types.js';
import { resetDatabase, TEST_DB } from './helpers.js';

// Runs against PostgreSQL when TEST_DATABASE_URL is set, otherwise against the in-memory store.
let db: Stores;
before(async () => {
  await resetDatabase();
  db = TEST_DB ? await createPostgresStores({ connectionString: TEST_DB, log: () => undefined }) : createJsonStores(null);
});
after(async () => { await db.close(); });

test(`provider search matches the reference filter for every filter combination (${TEST_DB ? 'postgres' : 'memory'})`, async () => {
  const all = bundledProviders();
  const cases = SPECIALTIES.flatMap((specialty) => [
    { specialty }, { specialty, city: 'riyadh' }, { specialty, language: 'EN' }, { specialty, insurance: 'bupa' },
    { specialty, needEr: true }, { specialty, secondOpinion: true }, { specialty, city: 'Jeddah', needEr: true, limit: 5 },
  ]);
  for (const f of cases) {
    const got = (await db.providers.search(f)).map((p) => p.id);
    const want = filterProviders(all, f).map((p) => p.id);
    assert.deepEqual(got, want, JSON.stringify(f));
  }
  const one = (await db.providers.getByIds(['prov_001']))[0];
  assert.equal(typeof one.rating, 'number');
  assert.ok(Array.isArray(one.languages));
});

test('seeding is one-off: deleted sample rows stay deleted after a restart', async () => {
  if (!TEST_DB) return;
  assert.equal(await db.providers.remove('prov_015'), true);
  const again = await createPostgresStores({ connectionString: TEST_DB, log: () => undefined });
  try { assert.equal((await again.providers.getByIds(['prov_015'])).length, 0); }
  finally { await again.close(); }
});

test('conversations: optimistic locking rejects a stale turn; history is capped per user', async () => {
  const u = await db.users.upsertLogin({ id: 'google:store-test', email: 'store@example.com', name: 'Store Test' });
  const c = await db.conversations.create(u.id, 'first', 3);
  const msg = { role: 'user' as const, text: 'hello', at: new Date().toISOString() };
  assert.equal(await db.conversations.appendTurn(u.id, c.id, 0, [msg], toState(newSession(c.id))), true);
  assert.equal(await db.conversations.appendTurn(u.id, c.id, 0, [msg], toState(newSession(c.id))), false); // stale version
  const fresh = await db.conversations.get(u.id, c.id);
  assert.equal(fresh?.version, 1);
  assert.equal(fresh?.messages.length, 1);
  assert.equal(fresh?.state?.turns, 0);
  for (let i = 0; i < 4; i++) await db.conversations.create(u.id, `c${i}`, 3);
  assert.equal((await db.conversations.list(u.id)).length, 3);
  assert.equal((await db.conversations.countByUser())[u.id], 3);
  assert.equal(await db.conversations.removeAll(u.id), 3);
});

test('users: token version and disabled flag persist', async () => {
  const u = await db.users.upsertLogin({ id: 'google:flags', email: 'flags@example.com', name: 'Flags' });
  assert.equal(u.tokenVersion, 0);
  await db.users.update(u.id, { disabled: true, bumpTokenVersion: true });
  const after = await db.users.get(u.id);
  assert.equal(after?.disabled, true); assert.equal(after?.tokenVersion, 1);
  await db.users.update(u.id, { role: 'admin' });
  assert.equal((await db.users.get(u.id))?.role, 'admin');
  assert.equal((await db.users.get(u.id))?.disabled, true); // untouched fields are kept
});

test('stats aggregate chat events; settings round-trip', async () => {
  await db.stats.record({ nextStep: 'emergency', urgency: 'emergency', department: 'emergency_medicine', model: 'rules', fallback: false, lang: 'ar' });
  await db.stats.record({ nextStep: 'see_specialist', urgency: 'urgent', department: 'cardiology', model: 'claude->rules', fallback: true, lang: 'en' });
  const s = await db.stats.summary();
  assert.ok(s.total >= 2); assert.ok(s.fallbacks >= 1); assert.ok(s.byLang.ar >= 1); assert.ok(s.byNextStep.emergency >= 1);
  await db.settings.save({ app: { emergencyNumber: '911' } });
  assert.deepEqual(await db.settings.load(), { app: { emergencyNumber: '911' } });
});
