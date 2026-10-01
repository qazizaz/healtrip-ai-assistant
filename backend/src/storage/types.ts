import type { GuidanceEntry } from '../knowledge/retrieve.js';
import type { SessionState } from '../sessions.js';
import type { Provider, Specialty } from '../types.js';

/**
 * Storage interfaces. Two implementations exist:
 *  - PostgreSQL (`postgres.ts`): the application database, used whenever DATABASE_URL is set (required in production)
 *  - JSON files / memory (`json.ts`): zero-setup local development and unit tests
 * Business rules (validation, last-admin checks, ...) live in the services, not in the stores.
 */

export interface ProviderFilters {
  specialty: Specialty;
  city?: string;
  language?: string;
  insurance?: string;
  needEr?: boolean;
  secondOpinion?: boolean;
  limit?: number;
}
/** The data source the agent searches. The agent depends only on this read interface. */
export interface ProviderRepository {
  search(f: ProviderFilters): Promise<Provider[]>;
  getByIds(ids: string[]): Promise<Provider[]>;
  all(): Promise<Provider[]>;
}
export interface ProviderStore extends ProviderRepository {
  insert(p: Provider): Promise<void>;
  update(p: Provider): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

export interface User {
  id: string; email: string; name: string; picture?: string; role: 'user' | 'admin';
  createdAt: string; lastLoginAt: string; disabled?: boolean; tokenVersion?: number;
}
export interface UserStore {
  get(id: string): Promise<User | undefined>;
  list(): Promise<User[]>;
  upsertLogin(p: { id: string; email: string; name: string; picture?: string }): Promise<User>;
  update(id: string, patch: { role?: User['role']; disabled?: boolean; bumpTokenVersion?: boolean }): Promise<boolean>;
}

export interface StoredMessage { role: 'user' | 'assistant'; text: string; at: string; data?: Record<string, unknown> }
export interface Conversation {
  id: string; userId: string; title: string; createdAt: string; updatedAt: string;
  version: number;                 // optimistic lock: incremented on every saved turn
  messages: StoredMessage[];
  state?: SessionState;            // agent working state, never sent to the browser
}
export interface ConversationSummary { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number }
export interface ConversationStore {
  list(userId: string): Promise<ConversationSummary[]>;
  get(userId: string, id: string): Promise<Conversation | undefined>;
  create(userId: string, title: string, keepNewest: number): Promise<Conversation>;
  /** Appends messages and saves agent state if the conversation is still at `expectedVersion`. */
  appendTurn(userId: string, id: string, expectedVersion: number, messages: StoredMessage[], state: SessionState): Promise<boolean>;
  rename(userId: string, id: string, title: string): Promise<boolean>;
  remove(userId: string, id: string): Promise<boolean>;
  removeAll(userId: string): Promise<number>;
  countByUser(): Promise<Record<string, number>>;
}

export interface GuidanceStore {
  all(): Promise<GuidanceEntry[]>;
  upsert(e: GuidanceEntry): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export interface AuditEntry { at: string; actor: string; action: string; target: string; summary: string }
export interface AuditStore {
  add(e: Omit<AuditEntry, 'at'>): Promise<void>;
  recent(n: number): Promise<AuditEntry[]>;
}

export interface ChatEvent { nextStep: string; urgency?: string; department?: string; model: string; fallback: boolean; lang: string }
export interface StatsData {
  since: string; total: number; fallbacks: number;
  byNextStep: Record<string, number>; byUrgency: Record<string, number>; byDepartment: Record<string, number>;
  byModel: Record<string, number>; byLang: Record<string, number>;
}
export interface StatsStore {
  record(e: ChatEvent): Promise<void>;
  summary(): Promise<StatsData>;
}

export interface SettingsStore {
  load(): Promise<unknown | undefined>;
  save(value: unknown): Promise<void>;
}

export interface Stores {
  kind: 'postgres' | 'json';
  providers: ProviderStore; users: UserStore; conversations: ConversationStore; guidance: GuidanceStore;
  audit: AuditStore; stats: StatsStore; settings: SettingsStore;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}
