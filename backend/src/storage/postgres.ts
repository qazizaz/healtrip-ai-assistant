import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { bundledGuidance, type GuidanceEntry } from '../knowledge/retrieve.js';
import type { Provider } from '../types.js';
import { bundledProviders } from './json.js';
import type {
  AuditStore, Conversation, ConversationStore, GuidanceStore, ProviderFilters, ProviderStore, SettingsStore, StatsData,
  StatsStore, Stores, User, UserStore,
} from './types.js';

type Q = pg.Pool | pg.PoolClient;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations/', import.meta.url));
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

export interface PgOptions { connectionString: string; ssl?: boolean; max?: number }

export function createPool(o: PgOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: o.connectionString,
    ssl: o.ssl ? { rejectUnauthorized: true } : undefined,
    max: o.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'healtrip',
  });
  pool.on('error', (err) => console.error('postgres pool error:', err.message)); // idle client errors must not crash the process
  return pool;
}

async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { c.release(); }
}

// ---------------------------------------------------------------- migrations + seed

/** Applies db/migrations/*.sql in order, once each. An advisory lock keeps concurrent instances from racing. */
export async function migrate(pool: pg.Pool, log = console.log): Promise<string[]> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const applied: string[] = [];
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(hashtext($1))', ['healtrip:migrate']);
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await c.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    for (const f of files) {
      if (done.has(f)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(MIGRATIONS_DIR + f, 'utf8'));
        await c.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw new Error(`migration ${f} failed: ${(e as Error).message}`); }
      applied.push(f); log(`applied migration ${f}`);
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(hashtext($1))', ['healtrip:migrate']).catch(() => undefined);
    c.release();
  }
  return applied;
}

/** Loads the sample doctors/hospitals and guidance once (tracked in app_meta, so admin deletions are not undone). */
export async function seed(pool: pg.Pool, log = console.log): Promise<boolean> {
  return tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['healtrip:seed']);
    const done = await c.query("SELECT 1 FROM app_meta WHERE key = 'seed:v1'");
    if (done.rowCount) return false;
    for (const p of bundledProviders()) await insertProvider(c, p, true);
    for (const g of bundledGuidance()) await upsertGuidance(c, g, true);
    await c.query("INSERT INTO app_meta (key, value) VALUES ('seed:v1', now()::text)");
    log('seeded sample providers and guidance');
    return true;
  });
}

// ---------------------------------------------------------------- providers

const PROVIDER_COLS = `id, type, name_en, name_ar, specialty, city, hospital_en, hospital_ar, languages, accepts_insurance,
  er_available, accepting_second_opinions, rating::float8 AS rating, phone`;

async function insertProvider(c: Q, p: Provider, ignoreConflict = false) {
  await c.query(
    `INSERT INTO providers (id, type, name_en, name_ar, specialty, city, hospital_en, hospital_ar, languages, accepts_insurance,
       er_available, accepting_second_opinions, rating, phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ${ignoreConflict ? 'ON CONFLICT (id) DO NOTHING' : ''}`,
    [p.id, p.type, p.name_en, p.name_ar, p.specialty, p.city, p.hospital_en, p.hospital_ar, p.languages, p.accepts_insurance,
      p.er_available, p.accepting_second_opinions, p.rating, p.phone]);
}

class PgProviders implements ProviderStore {
  constructor(private db: pg.Pool) {}
  async all() { return (await this.db.query<Provider>(`SELECT ${PROVIDER_COLS} FROM providers ORDER BY id`)).rows; }
  /** Parameterised search; same semantics as filterProviders() in json.ts. */
  async search(f: ProviderFilters) {
    const where = ['specialty = $1']; const args: unknown[] = [f.specialty];
    const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
    if (f.city) add('lower(city) = lower(?)', f.city);
    if (f.language) add('? = ANY(languages)', f.language.toLowerCase());
    if (f.insurance) add('EXISTS (SELECT 1 FROM unnest(accepts_insurance) i WHERE lower(i) = lower(?))', f.insurance);
    if (f.needEr) where.push('er_available');
    if (f.secondOpinion) where.push('accepting_second_opinions');
    args.push(Math.min(f.limit ?? 3, 5));
    const sql = `SELECT ${PROVIDER_COLS} FROM providers WHERE ${where.join(' AND ')} ORDER BY rating DESC, id LIMIT $${args.length}`;
    return (await this.db.query<Provider>(sql, args)).rows;
  }
  async getByIds(ids: string[]) {
    if (!ids.length) return [];
    const rows = (await this.db.query<Provider>(`SELECT ${PROVIDER_COLS} FROM providers WHERE id = ANY($1)`, [ids])).rows;
    return ids.flatMap((id) => rows.filter((r) => r.id === id)); // keep the order the agent chose
  }
  async insert(p: Provider) { await insertProvider(this.db, p); }
  async update(p: Provider) {
    const r = await this.db.query(
      `UPDATE providers SET type=$2, name_en=$3, name_ar=$4, specialty=$5, city=$6, hospital_en=$7, hospital_ar=$8, languages=$9,
         accepts_insurance=$10, er_available=$11, accepting_second_opinions=$12, rating=$13, phone=$14, updated_at=now() WHERE id=$1`,
      [p.id, p.type, p.name_en, p.name_ar, p.specialty, p.city, p.hospital_en, p.hospital_ar, p.languages, p.accepts_insurance,
        p.er_available, p.accepting_second_opinions, p.rating, p.phone]);
    return (r.rowCount ?? 0) > 0;
  }
  async remove(id: string) { return ((await this.db.query('DELETE FROM providers WHERE id = $1', [id])).rowCount ?? 0) > 0; }
}

// ---------------------------------------------------------------- users

interface UserRow { id: string; email: string; name: string; picture: string | null; role: 'user' | 'admin'; disabled: boolean; token_version: number; created_at: Date; last_login_at: Date }
const toUser = (r: UserRow): User => ({
  id: r.id, email: r.email, name: r.name, picture: r.picture ?? undefined, role: r.role, disabled: r.disabled,
  tokenVersion: r.token_version, createdAt: iso(r.created_at), lastLoginAt: iso(r.last_login_at),
});

class PgUsers implements UserStore {
  constructor(private db: pg.Pool) {}
  async get(id: string) { const r = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]); return r.rows[0] && toUser(r.rows[0]); }
  async list() { return (await this.db.query<UserRow>('SELECT * FROM users ORDER BY last_login_at DESC')).rows.map(toUser); }
  async upsertLogin(p: { id: string; email: string; name: string; picture?: string }) {
    const r = await this.db.query<UserRow>(
      `INSERT INTO users (id, email, name, picture) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture, last_login_at = now()
       RETURNING *`, [p.id, p.email, p.name, p.picture ?? null]);
    return toUser(r.rows[0]);
  }
  async update(id: string, patch: { role?: User['role']; disabled?: boolean; bumpTokenVersion?: boolean }) {
    const r = await this.db.query(
      `UPDATE users SET role = COALESCE($2, role), disabled = COALESCE($3, disabled),
         token_version = token_version + CASE WHEN $4 THEN 1 ELSE 0 END WHERE id = $1`,
      [id, patch.role ?? null, patch.disabled ?? null, !!patch.bumpTokenVersion]);
    return (r.rowCount ?? 0) > 0;
  }
}

// ---------------------------------------------------------------- conversations

class PgConversations implements ConversationStore {
  constructor(private db: pg.Pool) {}
  async list(userId: string) {
    const r = await this.db.query(
      `SELECT c.id, c.title, c.created_at, c.updated_at, (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c WHERE c.user_id = $1 ORDER BY c.updated_at DESC`, [userId]);
    return r.rows.map((x) => ({ id: x.id, title: x.title, createdAt: iso(x.created_at), updatedAt: iso(x.updated_at), messageCount: x.message_count }));
  }
  async get(userId: string, id: string): Promise<Conversation | undefined> {
    const c = (await this.db.query('SELECT * FROM conversations WHERE id = $1 AND user_id = $2', [id, userId])).rows[0];
    if (!c) return undefined;
    const msgs = (await this.db.query('SELECT role, content, data, created_at FROM messages WHERE conversation_id = $1 ORDER BY id', [id])).rows;
    return {
      id: c.id, userId: c.user_id, title: c.title, createdAt: iso(c.created_at), updatedAt: iso(c.updated_at), version: c.version,
      state: c.agent_state ?? undefined,
      messages: msgs.map((m) => ({ role: m.role, text: m.content, at: iso(m.created_at), ...(m.data ? { data: m.data } : {}) })),
    };
  }
  async create(userId: string, title: string, keepNewest: number) {
    return tx(this.db, async (c) => {
      const r = (await c.query('INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, $3) RETURNING *', [randomUUID(), userId, title])).rows[0];
      // Keep each user's history bounded: drop the oldest conversations beyond the limit.
      await c.query(
        `DELETE FROM conversations WHERE user_id = $1 AND id IN (
           SELECT id FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC OFFSET $2)`, [userId, keepNewest]);
      return { id: r.id, userId, title: r.title, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), version: 0, messages: [] };
    });
  }
  async appendTurn(userId: string, id: string, expectedVersion: number, messages: Conversation['messages'], state: Conversation['state']) {
    return tx(this.db, async (c) => {
      const r = await c.query(
        'UPDATE conversations SET version = version + 1, agent_state = $4, updated_at = now() WHERE id = $1 AND user_id = $2 AND version = $3',
        [id, userId, expectedVersion, JSON.stringify(state ?? null)]);
      if (!r.rowCount) return false; // changed concurrently or deleted
      for (const m of messages) {
        await c.query('INSERT INTO messages (conversation_id, role, content, data, created_at) VALUES ($1, $2, $3, $4, $5)',
          [id, m.role, m.text, m.data ? JSON.stringify(m.data) : null, m.at]);
      }
      return true;
    });
  }
  async rename(userId: string, id: string, title: string) {
    return ((await this.db.query('UPDATE conversations SET title = $3 WHERE id = $1 AND user_id = $2', [id, userId, title])).rowCount ?? 0) > 0;
  }
  async remove(userId: string, id: string) {
    return ((await this.db.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [id, userId])).rowCount ?? 0) > 0;
  }
  async removeAll(userId: string) { return (await this.db.query('DELETE FROM conversations WHERE user_id = $1', [userId])).rowCount ?? 0; }
  async countByUser() {
    const r = await this.db.query<{ user_id: string; n: number }>('SELECT user_id, count(*)::int AS n FROM conversations GROUP BY user_id');
    return Object.fromEntries(r.rows.map((x) => [x.user_id, x.n]));
  }
}

// ---------------------------------------------------------------- guidance, audit, stats, settings

async function upsertGuidance(c: Q, g: GuidanceEntry, ignoreConflict = false) {
  await c.query(
    `INSERT INTO guidance (id, title_en, title_ar, text_en, text_ar, tags, source) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO ${ignoreConflict ? 'NOTHING' : `UPDATE SET title_en = EXCLUDED.title_en, title_ar = EXCLUDED.title_ar,
       text_en = EXCLUDED.text_en, text_ar = EXCLUDED.text_ar, tags = EXCLUDED.tags, source = EXCLUDED.source, updated_at = now()`}`,
    [g.id, g.title_en, g.title_ar, g.text_en, g.text_ar, g.tags, g.source]);
}

class PgGuidance implements GuidanceStore {
  constructor(private db: pg.Pool) {}
  async all() { return (await this.db.query<GuidanceEntry>('SELECT id, title_en, title_ar, text_en, text_ar, tags, source FROM guidance ORDER BY id')).rows; }
  async upsert(g: GuidanceEntry) { await upsertGuidance(this.db, g); }
  async remove(id: string) { return ((await this.db.query('DELETE FROM guidance WHERE id = $1', [id])).rowCount ?? 0) > 0; }
}

class PgAudit implements AuditStore {
  constructor(private db: pg.Pool) {}
  async add(e: { actor: string; action: string; target: string; summary: string }) {
    await this.db.query('INSERT INTO audit_log (actor, action, target, summary) VALUES ($1, $2, $3, $4)', [e.actor, e.action, e.target, e.summary.slice(0, 200)]);
  }
  async recent(n: number) {
    const r = await this.db.query('SELECT at, actor, action, target, summary FROM audit_log ORDER BY id DESC LIMIT $1', [n]);
    return r.rows.map((x) => ({ ...x, at: iso(x.at) }));
  }
}

class PgStats implements StatsStore {
  constructor(private db: pg.Pool) {}
  async record(e: { nextStep: string; urgency?: string; department?: string; model: string; fallback: boolean; lang: string }) {
    await this.db.query('INSERT INTO chat_events (next_step, urgency, department, model, fallback, lang) VALUES ($1, $2, $3, $4, $5, $6)',
      [e.nextStep, e.urgency ?? null, e.department ?? null, e.model, e.fallback, e.lang]);
  }
  async summary(): Promise<StatsData> {
    const head = (await this.db.query('SELECT min(at) AS since, count(*)::int AS total, count(*) FILTER (WHERE fallback)::int AS fallbacks FROM chat_events')).rows[0];
    const groups = (await this.db.query<{ dim: string; k: string; n: number }>(
      `SELECT 'byNextStep' AS dim, next_step AS k, count(*)::int AS n FROM chat_events GROUP BY next_step
       UNION ALL SELECT 'byUrgency', urgency, count(*)::int FROM chat_events WHERE urgency IS NOT NULL GROUP BY urgency
       UNION ALL SELECT 'byDepartment', department, count(*)::int FROM chat_events WHERE department IS NOT NULL GROUP BY department
       UNION ALL SELECT 'byModel', model, count(*)::int FROM chat_events GROUP BY model
       UNION ALL SELECT 'byLang', lang, count(*)::int FROM chat_events GROUP BY lang`)).rows;
    const out: StatsData = { since: iso(head.since ?? new Date()), total: head.total, fallbacks: head.fallbacks, byNextStep: {}, byUrgency: {}, byDepartment: {}, byModel: {}, byLang: {} };
    for (const g of groups) (out[g.dim as 'byLang'])[g.k] = g.n;
    return out;
  }
}

class PgSettings implements SettingsStore {
  constructor(private db: pg.Pool) {}
  async load() { return (await this.db.query('SELECT value FROM app_settings WHERE id = 1')).rows[0]?.value; }
  async save(value: unknown) {
    await this.db.query('INSERT INTO app_settings (id, value) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [JSON.stringify(value)]);
  }
}

// ---------------------------------------------------------------- factory

export async function createPostgresStores(o: PgOptions & { autoMigrate?: boolean; seed?: boolean; log?: (m: string) => void }): Promise<Stores> {
  const pool = createPool(o);
  const log = o.log ?? console.log;
  await pool.query('SELECT 1'); // fail fast with a clear error if the database is unreachable
  if (o.autoMigrate !== false) await migrate(pool, log);
  if (o.seed !== false) await seed(pool, log);
  return {
    kind: 'postgres',
    providers: new PgProviders(pool), users: new PgUsers(pool), conversations: new PgConversations(pool), guidance: new PgGuidance(pool),
    audit: new PgAudit(pool), stats: new PgStats(pool), settings: new PgSettings(pool),
    async ping() { try { await pool.query('SELECT 1'); return true; } catch { return false; } },
    async close() { await pool.end(); },
  };
}
