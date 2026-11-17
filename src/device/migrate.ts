// The device version of src/server/migrate.ts: applies migrations/*.sql, bundled into the app, in order, once each.
import { pool } from './db';

const files = import.meta.glob<string>('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true });

export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const sql = new Map(Object.entries(files).map(([file, text]) => [file.split('/').pop()!, text]));
    for (const name of [...sql.keys()].sort()) {
      if (done.has(name)) continue;
      await c.query('BEGIN');
      try {
        await c.query(sql.get(name)!);
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    }
  } finally { c.release(); }
}
