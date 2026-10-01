import type { SettingsStore } from '../storage/types.js';
import { DEFAULT_SETTINGS, SECTION_SCHEMAS, settingsSchema, type Settings, type SettingsSection } from './schema.js';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge((base as any)[k], v) : v;
  return out as T;
}

/**
 * Admin-editable settings. Persisted in the database (app_settings) and kept in memory for fast synchronous reads,
 * because the model router and agent read them on every turn.
 */
export class SettingsService {
  private current: Settings = structuredClone(DEFAULT_SETTINGS);
  private listeners: Array<(s: Settings) => void> = [];
  constructor(private store: SettingsStore) {}

  async init() {
    const stored = await this.store.load();
    const parsed = settingsSchema.safeParse(deepMerge(DEFAULT_SETTINGS, stored)); // keys added in later versions get defaults
    this.current = parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
    this.listeners.forEach((fn) => fn(this.current));
    return this;
  }
  get = (): Settings => this.current;
  onChange(fn: (s: Settings) => void) { this.listeners.push(fn); fn(this.current); }

  /** Replace one section. Returns the validated section or the validation issues. */
  async update<S extends SettingsSection>(section: S, value: unknown): Promise<{ ok: true; value: Settings[S] } | { ok: false; issues: string[] }> {
    const r = SECTION_SCHEMAS[section].safeParse(value);
    if (!r.success) return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    const next = { ...this.current, [section]: r.data } as Settings;
    await this.store.save(next);
    this.current = next;
    this.listeners.forEach((fn) => fn(this.current));
    return { ok: true, value: r.data as Settings[S] };
  }
  reset(section: SettingsSection) { return this.update(section, DEFAULT_SETTINGS[section]); }
}
