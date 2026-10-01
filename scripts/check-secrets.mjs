#!/usr/bin/env node
// Fails (exit 1) if the repo contains anything that looks like a credential. Values are never printed.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', '.data', 'package-lock.json']);
const PATTERNS = [
  ['Google OAuth client secret', /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['OpenRouter API key', /sk-or-v1-[A-Za-z0-9]{20,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}/],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['Private key block', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Hard-coded SESSION_SECRET', /^SESSION_SECRET=[A-Fa-f0-9]{32,}/m],
  ['"client_secret" JSON field', /"client_secret"\s*:\s*"[^"]{8,}"/],
  ['Database URL with a password for a remote host', /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]+@(?!localhost|127\.0\.0\.1|db[:/])[^\s'"]+/],
];
const findings = [];
function check(path) {
  const name = path.split(/[\\/]/).pop();
  if (/^client_secret.*\.json$/i.test(name)) findings.push(`${path}: Google OAuth client-secret file`);
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) findings.push(`${path}: env file must not be committed`);
  if (!existsSync(path) || statSync(path).size > 1_000_000) return;
  const text = readFileSync(path, 'utf8');
  for (const [label, re] of PATTERNS) {
    const m = re.exec(text);
    if (m) findings.push(`${path}:${text.slice(0, m.index).split('\n').length}: ${label}`);
  }
}
// Inside a git repository, check exactly what git would commit (tracked + new, not ignored): a local .env is fine.
let files = null;
try { files = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); } catch { /* not a git repo */ }
if (files) files.filter((f) => !f.endsWith('package-lock.json')).forEach(check);
else (function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) { walk(path); continue; }
    check(path);
  }
})('.');
if (findings.length) { console.error('Possible secrets found:\n  ' + findings.join('\n  ') + '\n(Local .env files are fine on your machine: they are git-ignored. Delete committed ones and rotate the credential.)'); process.exit(1); }
console.log('check-secrets: nothing suspicious found');
