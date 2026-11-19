import { existsSync, readFileSync } from 'node:fs';

// Minimal .env loader so local setup needs no extra tooling. Real environment variables win.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const int = (name: string, d: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : d; };
const production = process.env.NODE_ENV === 'production';

export const config = {
  production,
  port: int('PORT', 8787),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://weave:weave@localhost:5432/weave',
  sessionSecret: process.env.SESSION_SECRET ?? (production ? '' : 'dev-secret'),
  cookieSecure: (process.env.COOKIE_SECURE ?? (production ? '1' : '0')) === '1',
  allowSignup: (process.env.ALLOW_SIGNUP ?? '1') === '1',
  // Large enough for a PDF or photo sent to be read (as base64) when importing field notes.
  maxBodyBytes: int('MAX_BODY_BYTES', 30_000_000),
  provider: (process.env.RESEARCH_PROVIDER ?? 'none').toLowerCase(),
  researchModel: process.env.RESEARCH_MODEL ?? 'claude-opus-5-5',
  budgetSeconds: int('RESEARCH_BUDGET_SECONDS', 300),
  maxAttempts: int('RESEARCH_MAX_ATTEMPTS', 2),
  maxSearches: int('RESEARCH_MAX_SEARCHES', 6),
  runWorker: (process.env.RUN_WORKER ?? '1') === '1',
  jobPollMs: int('JOB_POLL_MS', 2000),
  allowDbReset: process.env.ALLOW_DB_RESET === '1',
  // Whether a request may bring its own Claude key (the phone app, where the key is saved on the phone).
  userKeys: false,
};
if (production && !config.sessionSecret) throw new Error('SESSION_SECRET is required in production');
