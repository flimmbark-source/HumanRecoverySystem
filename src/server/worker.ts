// Standalone job worker for deployments that run jobs outside the web process (RUN_WORKER=0 on the web side).
import { pool } from './db';
import { migrate } from './migrate';
import { startWorker } from './research';

await migrate({ quiet: true });
const stop = startWorker();
const shutdown = () => { stop(); setTimeout(() => pool.end().finally(() => process.exit(0)), 500); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
