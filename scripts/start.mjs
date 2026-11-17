import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as util from 'node:util';

function useCodespaceDemo() {
  if (process.env.CODESPACES !== 'true' || existsSync('.weave-codespace/no-autostart')) return false;

  const envFile = existsSync('.env') ? util.parseEnv(readFileSync('.env', 'utf8')) : {};
  const databaseUrl = process.env.DATABASE_URL ?? envFile.DATABASE_URL;
  const production = (process.env.NODE_ENV ?? envFile.NODE_ENV) === 'production';
  return !production && (!databaseUrl || databaseUrl === 'postgres://weave:weave@localhost:5432/weave');
}

if (useCodespaceDemo()) {
  const result = spawnSync('bash', ['.devcontainer/start-weave.sh'], { stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} else {
  await import('../dist/server/main.js');
}
