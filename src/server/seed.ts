// Synthetic seed: three demo accounts and one synthetic project. Safe to run repeatedly.
import { createUser, type User } from './auth';
import { one, pool, tx } from './db';
import { demoBundle } from './demo';
import { migrate } from './migrate';
import { audit, createProject, writeBundle } from './store';

export const SEED_PASSWORD = 'weave-demo-1';
export const SEED_USERS = [
  { email: 'owner@weave.test', name: 'Olu Owner', role: 'owner' }, { email: 'researcher@weave.test', name: 'Rae Researcher', role: 'editor' },
  { email: 'reader@weave.test', name: 'Remy Reader', role: 'reader' }, { email: 'outsider@weave.test', name: 'Odile Outsider', role: null },
] as const;

export async function seed(): Promise<{ projectId: string; users: Record<string, User> }> {
  return tx(async (db) => {
    const users: Record<string, User> = {};
    for (const u of SEED_USERS) users[u.email] = (await one<User>(db, 'SELECT id, email, name FROM users WHERE lower(email) = $1', [u.email])) ?? (await createUser(db, u.email, u.name, SEED_PASSWORD));
    const owner = users['owner@weave.test'];
    const existing = await one<{ id: string }>(db, `SELECT id FROM projects WHERE owner_id = $1 AND is_synthetic AND name = $2`, [owner.id, demoBundle().project.name]);
    if (existing) return { projectId: existing.id, users };
    const bundle = demoBundle();
    const projectId = await createProject(db, owner, bundle.project, { synthetic: true });
    await writeBundle(db, projectId, owner, bundle);
    for (const u of SEED_USERS) if (u.role && u.role !== 'owner') await db.query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)', [projectId, users[u.email].id, u.role]);
    await audit(db, projectId, owner, 'project.create', 'project', projectId, { template: 'seed' });
    return { projectId, users };
  });
}

if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  migrate({ quiet: true }).then(seed).then((r) => { console.log(`[seed] synthetic project ${r.projectId}\n[seed] sign in as owner@weave.test, researcher@weave.test or reader@weave.test with password "${SEED_PASSWORD}"`); return pool.end(); })
    .catch((e) => { console.error('[seed] failed:', e.message); process.exit(1); });
}
