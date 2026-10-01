// Database maintenance: `npm run db:migrate` applies pending migrations and loads the sample data (first run only).
import { config } from '../config.js';
import { createPool, migrate, seed } from './postgres.js';

if (!config.databaseUrl) { console.error('DATABASE_URL is not set (see .env.example).'); process.exit(1); }
const pool = createPool({ connectionString: config.databaseUrl, ssl: config.databaseSsl, max: 1 });
try {
  const applied = await migrate(pool);
  const seeded = await seed(pool);
  console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Schema is up to date.', seeded ? 'Sample data loaded.' : '');
} catch (e) {
  console.error((e as Error).message); process.exitCode = 1;
} finally { await pool.end(); }
