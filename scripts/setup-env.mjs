#!/usr/bin/env node
// Creates a local .env (git-ignored, permission 600) with a freshly generated SESSION_SECRET.
//   npm run setup:env -- --google-client-id=<id> --admin-email=<google account email> [--force]
// The Google CLIENT ID is public and goes in .env. The Google client SECRET is NOT needed by this app
// (Google Identity Services + server-side ID-token verification) and must not be stored anywhere.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
if (args['google-client-secret'] || Object.values(args).some((v) => /GOCSPX-/.test(v))) { console.error('Do not pass the Google client secret: this app does not need it. Rotate it in Google Cloud if it was shared.'); process.exit(1); }
if (existsSync('.env') && !args.force) { console.log('.env already exists: not touching it (use --force to regenerate).'); process.exit(0); }

let env = readFileSync('.env.example', 'utf8');
const set = (key, value) => { env = env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`); };
set('SESSION_SECRET', randomBytes(32).toString('hex'));
if (args['google-client-id']) set('GOOGLE_CLIENT_ID', args['google-client-id']);
if (args['admin-email']) set('ADMIN_EMAILS', args['admin-email']);
writeFileSync('.env', env, { mode: 0o600 });
try { chmodSync('.env', 0o600); } catch { /* not supported on this filesystem (Windows) */ }
console.log('Created .env (git-ignored). Next: add OPENROUTER_API_KEY to it, then npm run dev:backend / dev:frontend.');
