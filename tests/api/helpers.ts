import { app } from '../../src/server/app';
import { migrate } from '../../src/server/migrate';
import { seed, SEED_PASSWORD } from '../../src/server/seed';

export class Client {
  cookie = '';
  async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; res: Response }> {
    const res = await app.request('/api' + path, { method, headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, json: type.includes('json') ? await res.clone().json() : null, res };
  }
  get = (p: string) => this.call('GET', p);
  post = (p: string, b?: unknown) => this.call('POST', p, b ?? {});
  put = (p: string, b?: unknown) => this.call('PUT', p, b ?? {});
  patch = (p: string, b?: unknown) => this.call('PATCH', p, b ?? {});
  del = (p: string) => this.call('DELETE', p);
}
export async function login(email: string): Promise<Client> {
  const c = new Client();
  const r = await c.post('/auth/login', { email, password: SEED_PASSWORD });
  if (r.status !== 200) throw new Error('login failed for ' + email);
  return c;
}
export async function freshDb() {
  await migrate({ reset: true, quiet: true });
  return seed();
}
export const ok = (r: { status: number; json: any }) => { if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.json)}`); return r.json; };
