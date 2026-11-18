// The API and its database, running in a Web Worker in the app. The page sends each /api request here
// (see transport.ts), and the worker answers it with the same Hono app that the server runs.
import { Buffer } from 'buffer';
import { app } from '../server/app';
import { createSession, createUser } from '../server/auth';
// The build swaps '../server/config' and '../server/db' for the device versions (see vite.device.config.ts).
import { config } from '../server/config';
import { one, pool, tx } from '../server/db';
import { openDatabase } from './db';
import { loadFonts } from './fonts';
import { migrate } from './migrate';

export interface ApiRequest { id: number; method: string; path: string; headers: [string, string][]; body: ArrayBuffer | null }
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'response'; id: number; status: number; headers: [string, string][]; body: ArrayBuffer };

// pdfkit and exceljs hand their output to the global Buffer, which a browser does not have.
(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;

const post = (m: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
let session: { userId: string; token: string };

// Nobody signs in on the device: the first start creates its one account, and each start opens a session for it.
async function start() {
  await Promise.all([openDatabase(config.databaseUrl), loadFonts()]);
  await migrate();
  const found = await one<{ id: string }>(pool, 'SELECT id FROM users ORDER BY created_at LIMIT 1');
  const password = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64'); // never used to sign in
  const userId = found?.id ?? (await tx((db) => createUser(db, 'you@this.device', 'You', password))).id;
  await pool.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
  session = { userId, token: await createSession(userId) };
}
const started = start();
started.then(() => post({ type: 'ready' }), (e: unknown) => post({ type: 'failed', message: e instanceof Error ? e.message : String(e) }));

async function answer(r: ApiRequest): Promise<Response> {
  await started;
  const send = () => app.fetch(new Request(new URL(r.path, 'http://device'), { method: r.method, headers: [...r.headers, ['authorization', `Bearer ${session.token}`]], body: r.body }));
  const res = await send();
  if (res.status !== 401 || r.path.startsWith('/api/auth/')) return res;
  // A session lasts 14 days. An app that stays open for longer gets a new one.
  session.token = await createSession(session.userId);
  return send();
}

self.onmessage = async (e: MessageEvent<ApiRequest>) => {
  const r = e.data;
  let res: Response;
  try { res = await answer(r); } catch (err) {
    res = Response.json({ error: `Weave could not open its database on this device. ${err instanceof Error ? err.message : ''}`.trim() }, { status: 503 });
  }
  const body = await res.arrayBuffer();
  post({ type: 'response', id: r.id, status: res.status, headers: [...res.headers], body }, [body]);
};
