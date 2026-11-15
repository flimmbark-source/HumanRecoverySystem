import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from './app';
import { config } from './config';
import { pool } from './db';
import { migrate } from './migrate';
import { startWorker } from './research';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = [path.resolve(here, '../client'), path.resolve('dist/client')].find((d) => existsSync(path.join(d, 'index.html')));
if (clientDir) {
  const rel = path.relative(process.cwd(), clientDir) || '.';
  app.use('/assets/*', serveStatic({ root: rel }));
  const index = readFileSync(path.join(clientDir, 'index.html'), 'utf8');
  app.get('*', (c) => { c.header('Cache-Control', 'no-store'); c.header('X-Frame-Options', 'DENY'); c.header('Referrer-Policy', 'same-origin'); return c.html(index); });
}

await migrate({ quiet: true });
const server = serve({ fetch: app.fetch, port: config.port }, (info) => console.log(`[weave] listening on http://localhost:${info.port}${clientDir ? '' : ' (API only; run vite for the client)'}`));
const stop = config.runWorker ? startWorker() : null;

const shutdown = () => { stop?.(); server.close(() => pool.end().finally(() => process.exit(0))); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
