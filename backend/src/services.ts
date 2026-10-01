import { z } from 'zod';
import { config } from './config.js';
import { setGuidanceEntries, type GuidanceEntry } from './knowledge/retrieve.js';
import { setRuntimeMessages } from './messages.js';
import type { SessionState } from './sessions.js';
import { SettingsService } from './settings/service.js';
import { createJsonStores } from './storage/json.js';
import { createPostgresStores } from './storage/postgres.js';
import type { ChatEvent, Conversation, ProviderFilters, ProviderRepository, StoredMessage, Stores, User } from './storage/types.js';
import { SPECIALTIES, type Provider } from './types.js';

export type { User } from './storage/types.js';
type Result<T> = ({ ok: true } & T) | { ok: false; issues: string[] };
const issuesOf = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

// ---------------------------------------------------------------- providers (doctors and hospitals)

const str = (max: number) => z.string().trim().min(1).max(max);
export const providerSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{3,40}$/i).optional(),
  type: z.enum(['doctor', 'hospital']),
  name_en: str(80), name_ar: str(80),
  specialty: z.enum(SPECIALTIES), city: str(40),
  hospital_en: str(80), hospital_ar: str(80),
  languages: z.array(z.string().trim().toLowerCase().length(2)).max(8),
  accepts_insurance: z.array(str(40)).max(12),
  er_available: z.boolean(), accepting_second_opinions: z.boolean(),
  rating: z.number().min(0).max(5),
  phone: z.string().trim().regex(/^\+?[\d\s-]{7,20}$/),
});

export class ProviderService implements ProviderRepository {
  constructor(private store: Stores['providers']) {}
  all() { return this.store.all(); }
  search(f: ProviderFilters) { return this.store.search(f); }
  getByIds(ids: string[]) { return this.store.getByIds(ids); }
  async upsert(input: unknown, id?: string): Promise<Result<{ provider: Provider }>> {
    const r = providerSchema.safeParse(input);
    if (!r.success) return { ok: false, issues: issuesOf(r.error) };
    const provider: Provider = { ...r.data, id: id ?? r.data.id ?? `prov_${Date.now().toString(36)}` };
    if (id) { if (!(await this.store.update(provider))) return { ok: false, issues: ['not found'] }; }
    else {
      if ((await this.store.getByIds([provider.id])).length) return { ok: false, issues: ['id: already exists'] };
      await this.store.insert(provider);
    }
    return { ok: true, provider };
  }
  remove(id: string) { return this.store.remove(id); }
}

// ---------------------------------------------------------------- users

const isEnvAdmin = (email: string) => config.adminEmails.has(email.toLowerCase());
/** Effective view: emails in ADMIN_EMAILS are always admins. */
const view = (u: User): User => (isEnvAdmin(u.email) ? { ...u, role: 'admin' } : u);

export class UserService {
  constructor(private store: Stores['users']) {}
  async get(id: string) { const u = await this.store.get(id); return u && view(u); }
  async list() { return (await this.store.list()).map(view); }
  async upsertLogin(p: { id: string; email: string; name: string; picture?: string }) { return view(await this.store.upsertLogin(p)); }
  /** Revokes every login cookie issued to this user (sign out everywhere). */
  async revokeSessions(id: string) { return this.store.update(id, { bumpTokenVersion: true }); }
  private async activeAdmins() { return (await this.list()).filter((u) => u.role === 'admin' && !u.disabled); }

  async setDisabled(id: string, disabled: boolean, actorId?: string): Promise<{ ok: true } | { ok: false; issue: string }> {
    const u = await this.get(id);
    if (!u) return { ok: false, issue: 'user not found' };
    if (disabled) {
      if (id === actorId) return { ok: false, issue: 'you cannot disable your own account' };
      if (isEnvAdmin(u.email)) return { ok: false, issue: 'this user is an admin through ADMIN_EMAILS' };
      if (u.role === 'admin' && (await this.activeAdmins()).length <= 1) return { ok: false, issue: 'cannot disable the last admin' };
    }
    await this.store.update(id, { disabled, bumpTokenVersion: disabled }); // disabling signs the user out immediately
    return { ok: true };
  }
  async setRole(id: string, role: 'user' | 'admin'): Promise<{ ok: true } | { ok: false; issue: string }> {
    const u = await this.get(id);
    if (!u) return { ok: false, issue: 'user not found' };
    if (isEnvAdmin(u.email) && role !== 'admin') return { ok: false, issue: 'this user is an admin through ADMIN_EMAILS' };
    if (u.role === 'admin' && role === 'user' && (await this.activeAdmins()).length <= 1) return { ok: false, issue: 'cannot remove the last admin' };
    await this.store.update(id, { role }); // read on every request, so it applies immediately
    return { ok: true };
  }
}

// ---------------------------------------------------------------- conversations

export const MAX_CONVERSATIONS_PER_USER = 200;
export const MAX_TITLE = 80;
const cleanTitle = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
export const titleFrom = (firstMessage: string) => {
  const t = cleanTitle(firstMessage);
  return t.length >= MAX_TITLE ? t.slice(0, MAX_TITLE - 1).trimEnd() + '…' : t || 'New chat';
};

/**
 * Per-user conversation history. Every method takes the authenticated user id and every query is scoped by it:
 * there is no way to read another user's conversations, including for admins.
 */
export class ConversationService {
  constructor(private store: Stores['conversations']) {}
  list(userId: string) { return this.store.list(userId); }
  get(userId: string, id: string): Promise<Conversation | undefined> { return this.store.get(userId, id); }
  create(userId: string, title = 'New chat') { return this.store.create(userId, cleanTitle(title) || 'New chat', MAX_CONVERSATIONS_PER_USER); }
  appendTurn(userId: string, c: Conversation, messages: StoredMessage[], state: SessionState) {
    return this.store.appendTurn(userId, c.id, c.version, messages, state);
  }
  async rename(userId: string, id: string, title: string) { const t = cleanTitle(title); return !!t && this.store.rename(userId, id, t); }
  remove(userId: string, id: string) { return this.store.remove(userId, id); }
  removeAll(userId: string) { return this.store.removeAll(userId); }
  countByUser() { return this.store.countByUser(); }
}

// ---------------------------------------------------------------- guidance (knowledge base)

const slug = z.string().regex(/^[a-z0-9-]{3,40}$/);
const t = (n: number) => z.string().trim().min(1).max(n);
export const guidanceSchema = z.object({
  id: slug.optional(), title_en: t(100), title_ar: t(100), text_en: t(1200), text_ar: t(1200),
  tags: z.array(t(40)).max(30), source: t(200).default('HealTrip admin'),
});

/** Guidance lives in the database; a copy is kept in memory because the BM25 index is built from it. */
export class GuidanceService {
  private list: GuidanceEntry[] = [];
  constructor(private store: Stores['guidance']) {}
  async init() { this.list = await this.store.all(); setGuidanceEntries(this.list); return this; }
  all() { return this.list; }
  async upsert(input: unknown, id?: string): Promise<Result<{ entry: GuidanceEntry }>> {
    const r = guidanceSchema.safeParse(input);
    if (!r.success) return { ok: false, issues: issuesOf(r.error) };
    const eid = id ?? r.data.id;
    if (!eid) return { ok: false, issues: ['id: required (lowercase letters, digits, dashes)'] };
    if (id && !this.list.some((e) => e.id === id)) return { ok: false, issues: ['not found'] };
    const entry: GuidanceEntry = { ...r.data, id: eid };
    await this.store.upsert(entry);
    await this.init();
    return { ok: true, entry };
  }
  async remove(id: string) { const ok = await this.store.remove(id); if (ok) await this.init(); return ok; }
}

// ---------------------------------------------------------------- audit + stats

export class AuditLog {
  constructor(private store: Stores['audit']) {}
  /** Never throws: an audit write failure must not break the action it describes (it is logged instead). */
  async add(actor: string, action: string, target: string, summary = '') {
    try { await this.store.add({ actor, action, target, summary: summary.slice(0, 200) }); }
    catch (e) { console.error('audit write failed:', (e as Error).message); }
  }
  recent(n = 100) { return this.store.recent(n); }
}

export class Stats {
  constructor(private store: Stores['stats']) {}
  async record(e: ChatEvent) { try { await this.store.record(e); } catch (err) { console.error('stats write failed:', (err as Error).message); } }
  get() { return this.store.summary(); }
}

// ---------------------------------------------------------------- wiring

export interface ServiceOptions { databaseUrl?: string | null; databaseSsl?: boolean; dataDir?: string | null; log?: (m: string) => void }

/** PostgreSQL when a database URL is given; otherwise JSON files in dataDir (or memory when dataDir is null). */
export async function createServices(o: ServiceOptions = {}) {
  const stores = o.databaseUrl
    ? await createPostgresStores({ connectionString: o.databaseUrl, ssl: o.databaseSsl, log: o.log })
    : createJsonStores(o.dataDir ?? null);
  const settings = await new SettingsService(stores.settings).init();
  settings.onChange((s) => setRuntimeMessages({ emergencyNumber: s.app.emergencyNumber, disclaimer_en: s.app.disclaimer_en, disclaimer_ar: s.app.disclaimer_ar }));
  return {
    storage: stores.kind,
    settings,
    providers: new ProviderService(stores.providers),
    guidance: await new GuidanceService(stores.guidance).init(),
    users: new UserService(stores.users),
    conversations: new ConversationService(stores.conversations),
    audit: new AuditLog(stores.audit),
    stats: new Stats(stores.stats),
    ping: () => stores.ping(),
    close: () => stores.close(),
  };
}
export type Services = Awaited<ReturnType<typeof createServices>>;
