import { fileURLToPath } from 'node:url';
// Load the repo-root .env if present (does not override variables already set in the shell).
try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch { /* no .env file */ }

const env = process.env;

/**
 * Provider selection (first match wins):
 *   LLM_BASE_URL set       -> any OpenAI-compatible server (Ollama, Groq, LM Studio, ...). Needs LLM_MODEL; LLM_API_KEY optional
 *   OPENROUTER_API_KEY set -> OpenRouter
 *   ANTHROPIC_API_KEY set  -> Anthropic
 *   otherwise              -> "rules": tier-0 deterministic agent, zero cost, no network
 */
const mode = (env.LLM_BASE_URL ? 'openai_compat' : env.OPENROUTER_API_KEY ? 'openrouter' : env.ANTHROPIC_API_KEY ? 'anthropic' : 'rules') as
  'openai_compat' | 'openrouter' | 'anthropic' | 'rules';

const lower = (s?: string) => (s ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

export const config = {
  port: Number(env.PORT ?? 3001),
  nodeEnv: env.NODE_ENV ?? 'development',
  dataDir: env.DATA_DIR || fileURLToPath(new URL('../.data', import.meta.url)),
  databaseUrl: env.DATABASE_URL ?? '',
  databaseSsl: env.DATABASE_SSL === 'true',
  openrouterKey: env.OPENROUTER_API_KEY ?? '',
  googleClientId: env.GOOGLE_CLIENT_ID ?? '',
  adminEmails: new Set(lower(env.ADMIN_EMAILS)),
  sessionSecret: env.SESSION_SECRET ?? '',
  authDevLogin: env.AUTH_DEV_LOGIN === 'true',
  authRateLimitPerMin: Number(env.AUTH_RATE_LIMIT_PER_MIN ?? 20),
  llmMode: mode,
  openai: {
    baseUrl: mode === 'openrouter' ? 'https://openrouter.ai/api/v1' : (env.LLM_BASE_URL ?? ''),
    apiKey: mode === 'openrouter' ? (env.OPENROUTER_API_KEY ?? '') : (env.LLM_API_KEY ?? ''),
    model: mode === 'openrouter' ? (env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4.5') : (env.LLM_MODEL ?? ''),
  },
  anthropicKey: env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
  llmFallbackToRules: (env.LLM_FALLBACK ?? 'rules') !== 'off',
  llmMaxTokens: Number(env.LLM_MAX_TOKENS ?? 600),
  corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
  emergencyNumber: env.EMERGENCY_NUMBER ?? '997',
  sessionTtlMs: 30 * 60 * 1000,
  maxSessions: 1000,
  maxTurnsPerSession: 20,
  maxMessageChars: 1000,
  maxAgentSteps: 6,
  llmTimeoutMs: Number(env.LLM_TIMEOUT_MS ?? 20_000),
  cacheTtlMs: 10 * 60 * 1000,
  cacheMax: 200,
};
