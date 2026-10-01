import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bundledGuidance, type GuidanceEntry } from '../knowledge/retrieve.js';
import { JsonStore } from '../store/jsonStore.js';
import type { Provider } from '../types.js';
import type {
  AuditEntry, ChatEvent, Conversation, ConversationStore, ConversationSummary, GuidanceStore, ProviderFilters, ProviderStore,
  StatsData, Stores, User, UserStore,
} from './types.js';

export const bundledProviders = (): Provider[] =>
  JSON.parse(readFileSync(fileURLToPath(new URL('../data/providers.json', import.meta.url)), 'utf8'));

/** Same filter/sort semantics as the SQL query in postgres.ts. */
export function filterProviders(providers: Provider[], f: ProviderFilters): Provider[] {
  const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  return providers
    .filter((p) => p.specialty === f.specialty)
    .filter((p) => !f.city || eq(p.city, f.city))
    .filter((p) => !f.language || p.languages.includes(f.language.toLowerCase()))
    .filter((p) => !f.insurance || p.accepts_insurance.some((i) => eq(i, f.insurance)))
    .filter((p) => !f.needEr || p.er_available)
    .filter((p) => !f.secondOpinion || p.accepting_second_opinions)
    .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
    .slice(0, Math.min(f.limit ?? 3, 5));
}

/** Read-only provider list from the bundled sample data (used by tests and the evaluation harness). */
export class StaticProviderStore implements ProviderStore {
  constructor(private list: Provider[] = bundledProviders()) {}
  async all() { return this.list; }
  async search(f: ProviderFilters) { return filterProviders(this.list, f); }
  async getByIds(ids: string[]) { const s = new Set(ids); return this.list.filter((p) => s.has(p.id)); }
  async insert(p: Provider) { this.list.push(p); }
  async update(p: Provider) { const i = this.list.findIndex((x) => x.id === p.id); if (i < 0) return false; this.list[i] = p; return true; }
  async remove(id: string) { const n = this.list.length; this.list = this.list.filter((p) => p.id !== id); return this.list.length !== n; }
}

class JsonProviders extends StaticProviderStore {
  constructor(private store: JsonStore) { super(store.read<Provider[]>('providers', bundledProviders)); }
  private save = async () => this.store.write('providers', await this.all());
  async insert(p: Provider) { await super.insert(p); await this.save(); }
  async update(p: Provider) { const ok = await super.update(p); if (ok) await this.save(); return ok; }
  async remove(id: string) { const ok = await super.remove(id); if (ok) await this.save(); return ok; }
}

class JsonUsers implements UserStore {
  private users: User[];
  constructor(private store: JsonStore) { this.users = store.read<User[]>('users', () => []); }
  private persist() { this.store.write('users', this.users); }
  async get(id: string) { const u = this.users.find((x) => x.id === id); return u && { ...u }; }
  async list() { return this.users.map((u) => ({ ...u })); }
  async upsertLogin(p: { id: string; email: string; name: string; picture?: string }) {
    const now = new Date().toISOString();
    let u = this.users.find((x) => x.id === p.id);
    if (!u) { u = { ...p, role: 'user', createdAt: now, lastLoginAt: now, disabled: false, tokenVersion: 0 }; this.users.push(u); }
    else Object.assign(u, { email: p.email, name: p.name, picture: p.picture, lastLoginAt: now });
    this.persist();
    return { ...u };
  }
  async update(id: string, patch: { role?: User['role']; disabled?: boolean; bumpTokenVersion?: boolean }) {
    const u = this.users.find((x) => x.id === id);
    if (!u) return false;
    if (patch.role) u.role = patch.role;
    if (patch.disabled !== undefined) u.disabled = patch.disabled;
    if (patch.bumpTokenVersion) u.tokenVersion = (u.tokenVersion ?? 0) + 1;
    this.persist();
    return true;
  }
}

/** One collection (file) per user, keyed by a hash of the user id. */
class JsonConversations implements ConversationStore {
  private index: Record<string, string[]>; // userId -> collection key, for admin counts
  constructor(private store: JsonStore) { this.index = store.read<Record<string, string[]>>('conv-index', () => ({})); }
  private key(userId: string) { return 'conv-' + createHash('sha256').update(userId).digest('hex').slice(0, 32); }
  private all(userId: string) { return this.store.read<Conversation[]>(this.key(userId), () => []); }
  private persist(userId: string, list: Conversation[]) {
    this.store.write(this.key(userId), list);
    if (!this.index[userId]) { this.index[userId] = [this.key(userId)]; this.store.write('conv-index', this.index); }
  }
  async list(userId: string): Promise<ConversationSummary[]> {
    return this.all(userId)
      .map(({ id, title, createdAt, updatedAt, messages }) => ({ id, title, createdAt, updatedAt, messageCount: messages.length }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(userId: string, id: string) {
    const c = this.all(userId).find((x) => x.id === id && x.userId === userId);
    return c && structuredClone({ ...c, version: c.version ?? 0 });
  }
  async create(userId: string, title: string, keepNewest: number) {
    const now = new Date().toISOString();
    const c: Conversation = { id: randomUUID(), userId, title, createdAt: now, updatedAt: now, version: 0, messages: [] };
    const list = [...this.all(userId), c].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, keepNewest);
    this.persist(userId, list);
    return structuredClone(c);
  }
  async appendTurn(userId: string, id: string, expectedVersion: number, messages: Conversation['messages'], state: Conversation['state']) {
    const list = this.all(userId);
    const c = list.find((x) => x.id === id);
    if (!c || (c.version ?? 0) !== expectedVersion) return false;
    c.messages.push(...messages); c.state = state; c.version = expectedVersion + 1; c.updatedAt = new Date().toISOString();
    this.persist(userId, list);
    return true;
  }
  async rename(userId: string, id: string, title: string) {
    const list = this.all(userId); const c = list.find((x) => x.id === id);
    if (!c) return false;
    c.title = title; this.persist(userId, list); return true;
  }
  async remove(userId: string, id: string) {
    const list = this.all(userId); const next = list.filter((c) => c.id !== id);
    if (next.length === list.length) return false;
    this.persist(userId, next); return true;
  }
  async removeAll(userId: string) { const n = this.all(userId).length; this.persist(userId, []); return n; }
  async countByUser() { return Object.fromEntries(Object.keys(this.index).map((u) => [u, this.all(u).length])); }
}

class JsonGuidance implements GuidanceStore {
  private list: GuidanceEntry[];
  constructor(private store: JsonStore) { this.list = store.read<GuidanceEntry[]>('guidance', bundledGuidance); }
  async all() { return [...this.list]; }
  async upsert(e: GuidanceEntry) {
    const i = this.list.findIndex((x) => x.id === e.id);
    if (i >= 0) this.list[i] = e; else this.list.push(e);
    this.store.write('guidance', this.list);
  }
  async remove(id: string) {
    const n = this.list.length; this.list = this.list.filter((e) => e.id !== id);
    if (this.list.length !== n) this.store.write('guidance', this.list);
    return this.list.length !== n;
  }
}

const emptyStats = (): StatsData => ({ since: new Date().toISOString(), total: 0, fallbacks: 0, byNextStep: {}, byUrgency: {}, byDepartment: {}, byModel: {}, byLang: {} });

export function createJsonStores(dataDir: string | null): Stores {
  const store = new JsonStore(dataDir);
  let audit = store.read<AuditEntry[]>('audit', () => []);
  const stats = store.read<StatsData>('stats', emptyStats);
  return {
    kind: 'json',
    providers: new JsonProviders(store),
    users: new JsonUsers(store),
    conversations: new JsonConversations(store),
    guidance: new JsonGuidance(store),
    audit: {
      async add(e) { audit.push({ ...e, at: new Date().toISOString() }); if (audit.length > 300) audit = audit.slice(-300); store.write('audit', audit); },
      async recent(n) { return audit.slice(-n).reverse(); },
    },
    stats: {
      async record(e: ChatEvent) {
        const inc = (m: Record<string, number>, k?: string) => { if (k) m[k] = (m[k] ?? 0) + 1; };
        stats.total++; inc(stats.byNextStep, e.nextStep); inc(stats.byUrgency, e.urgency); inc(stats.byDepartment, e.department); inc(stats.byModel, e.model); inc(stats.byLang, e.lang);
        if (e.fallback) stats.fallbacks++;
        store.write('stats', stats);
      },
      async summary() { return structuredClone(stats); },
    },
    settings: {
      async load() { return store.read<unknown>('settings', () => null) ?? undefined; },
      async save(value) { store.write('settings', value); },
    },
    async ping() { return true; },
    async close() { /* nothing to close */ },
  };
}
