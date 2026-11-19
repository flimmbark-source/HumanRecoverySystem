// The server configuration (src/server/config.ts) for the device build: one person on one device,
// no sign-up, no research provider and no background job worker.
import type { config as serverConfig } from '../server/config';

export const config: typeof serverConfig = {
  production: true,
  port: 0,
  databaseUrl: 'idb://weave',
  sessionSecret: 'weave-device',
  cookieSecure: false,
  allowSignup: false,
  // Imports arrive from the page, not over a network, so a server's larger workspace exports still fit.
  maxBodyBytes: 40_000_000,
  provider: 'none',
  researchModel: 'claude-opus-5-5',
  budgetSeconds: 300,
  maxAttempts: 2,
  maxSearches: 6,
  runWorker: false,
  jobPollMs: 2000,
  allowDbReset: false,
  // The researcher's own Claude key, saved on the phone, comes with each split request.
  userKeys: true,
};
