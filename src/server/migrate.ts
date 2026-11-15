// Applies migrations/*.sql in order, once each. `--reset` drops everything first (guarded by ALLOW_DB_RESET=1).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db';
import { config } from './config';

export async function migrate(opts: { reset?: boolean; quiet?: boolean } = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = [path.resolve('migrations'), path.resolve(here, '../../migrations')].find((d) => existsSync(d));
  if (!dir) throw new Error('migrations directory not found');
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(7326011)');
    if (opts.reset) {
      if (!config.allowDbReset) throw new Error('Refusing to reset: set ALLOW_DB_RESET=1 (never in production).');
      await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(path.join(dir, file), 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await c.query('COMMIT');
        if (!opts.quiet) console.log(`[migrate] applied ${file}`);
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    }
    await c.query('SELECT pg_advisory_unlock(7326011)');
  } finally { c.release(); }
}

if (process.argv[1] && /migrate\.(ts|js)$/.test(process.argv[1])) {
  migrate({ reset: process.argv.includes('--reset') }).then(() => pool.end()).catch((e) => { console.error('[migrate] failed:', e.message); process.exit(1); });
}
