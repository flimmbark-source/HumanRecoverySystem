// The server's database module (src/server/db.ts) for the build that runs on the device. It has the same
// exports, backed by PGlite (PostgreSQL compiled to WebAssembly) with one connection instead of a server pool.
import { PGlite, types, type Results } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

export interface QueryResult<T> { rows: T[]; rowCount: number }
export interface Db { query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> }
export interface PoolClient extends Db { release(): void }

let pg: PGlite | null = null;

/** Opens the database: `idb://<name>` keeps it in IndexedDB, `memory://` is for tests. */
export async function openDatabase(dataDir: string): Promise<void> {
  pg = await PGlite.create(dataDir, {
    extensions: { pgcrypto },
    // The value types the server gets from node-postgres: ISO strings for timestamptz, strings for int8.
    parsers: { [types.TIMESTAMPTZ]: (v: string) => new Date(v).toISOString(), [types.INT8]: (v: string) => v },
  });
}

// One connection: each caller waits until the previous caller releases it, as with a pool of size one.
let tail: Promise<unknown> = Promise.resolve();
function acquire(): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const ready = tail.then(() => release);
  tail = tail.then(() => held);
  return ready;
}

// Without parameters node-postgres uses the simple protocol, which accepts several statements. So does this.
async function run<T>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
  if (!pg) throw new Error('The database is not open.');
  const r: Results<T> = params.length ? await pg.query<T>(text, params) : (await pg.exec(text)).at(-1) as Results<T> ?? { rows: [], fields: [] };
  return { rows: r.rows, rowCount: Math.max(r.affectedRows ?? 0, r.rows.length) };
}

export const pool = {
  async query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const release = await acquire();
    try { return await run<T>(text, params); } finally { release(); }
  },
  async connect(): Promise<PoolClient> {
    const release = await acquire();
    return { query: run, release };
  },
};

export async function q<T = any>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(text, params)).rows;
}
export async function one<T = any>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  return (await db.query<T>(text, params)).rows[0] ?? null;
}
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
