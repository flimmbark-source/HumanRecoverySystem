import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { config } from './config';
import { one, pool, q, type Db } from './db';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const COOKIE = 'weave_session';
const SESSION_DAYS = 14;

export interface User { id: string; email: string; name: string }
export type Role = 'owner' | 'editor' | 'reader';
const RANK: Record<Role, number> = { reader: 1, editor: 2, owner: 3 };

export class HttpError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) { super(message); }
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(pw, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const actual = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const hashToken = (t: string) => createHash('sha256').update(t + config.sessionSecret).digest('hex');

export async function startSession(c: Context, userId: string) {
  const token = randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [hashToken(token), userId]);
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: config.cookieSecure, path: '/', maxAge: SESSION_DAYS * 86400 });
}
export async function endSession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashToken(token)]);
  deleteCookie(c, COOKIE, { path: '/' });
}

export type Env = { Variables: { user: User } };

export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  const user = token ? await one<User>(pool, `SELECT u.id, u.email, u.name FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [hashToken(token)]) : null;
  if (!user) throw new HttpError(401, 'Sign in to continue.');
  // Cookie-authenticated writes must come from our own pages.
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('origin'), host = c.req.header('host');
    if (origin && host && new URL(origin).host !== host && config.production) throw new HttpError(403, 'Cross-site request refused.');
  }
  c.set('user', user);
  await next();
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Resolves the caller's role on a project. Unknown and inaccessible projects are indistinguishable (404). */
export async function projectRole(db: Db, userId: string, projectId: string, min: Role = 'reader'): Promise<Role> {
  const row = UUID.test(projectId) ? await one<{ role: Role }>(db, 'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]) : null;
  if (!row) throw new HttpError(404, 'Project not found.');
  if (RANK[row.role] < RANK[min]) throw new HttpError(403, min === 'owner' ? 'Only a project owner can do this.' : 'You have read-only access to this project.');
  return row.role;
}

export async function createUser(db: Db, email: string, name: string, password: string): Promise<User> {
  const existing = await one(db, 'SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing) throw new HttpError(409, 'An account with this email already exists.');
  const [u] = await q<User>(db, 'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name', [email.trim(), name.trim() || email.split('@')[0], await hashPassword(password)]);
  const [org] = await q<{ id: string }>(db, 'INSERT INTO organizations (name) VALUES ($1) RETURNING id', [`${u.name}'s workspace`]);
  await db.query(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [org.id, u.id]);
  return u;
}
