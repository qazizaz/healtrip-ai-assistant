import pg from 'pg';

/** Set TEST_DATABASE_URL to run the storage and API tests against PostgreSQL (CI does). Otherwise they use memory. */
export const TEST_DB = process.env.TEST_DATABASE_URL || '';

/** Drops and recreates the public schema so each test file starts from an empty database. Never point this at real data. */
export async function resetDatabase(url = TEST_DB) {
  if (!url) return;
  if (!/test/i.test(url)) throw new Error('Refusing to reset a database whose URL does not contain "test".');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); } finally { await c.end(); }
}
