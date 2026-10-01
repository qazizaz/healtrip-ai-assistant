import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tiny persistent document store (one JSON file per collection, atomic writes). Good for a prototype and for
 * running locally; behind this interface you would use PostgreSQL in production (see db/schema.sql).
 * `dir = null` keeps everything in memory (tests).
 */
export class JsonStore {
  private cache = new Map<string, unknown>();
  constructor(private dir: string | null) {
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  read<T>(name: string, seed: () => T): T {
    if (this.cache.has(name)) return this.cache.get(name) as T;
    let value: T | undefined;
    if (this.dir) {
      const file = join(this.dir, `${name}.json`);
      if (existsSync(file)) { try { value = JSON.parse(readFileSync(file, 'utf8')) as T; } catch { value = undefined; } }
    }
    if (value === undefined) { value = seed(); this.write(name, value); }
    this.cache.set(name, value);
    return value;
  }
  write<T>(name: string, value: T): void {
    this.cache.set(name, value);
    if (!this.dir) return;
    const file = join(this.dir, `${name}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, file);
  }
}
