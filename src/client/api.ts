export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any = {}) { super(message); }
  get offline() { return this.status === 0; }
}

export async function api<T = any>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Your work is kept in this browser.');
  }
  const json = (res.headers.get('content-type') ?? '').includes('json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/') && path !== '/me') window.dispatchEvent(new Event('weave:signed-out'));
    throw new ApiError(res.status, json.error ?? `Request failed (${res.status})`, json);
  }
  return json as T;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}, h: Record<string, string> = {}) => api<T>('POST', p, b, h);
export const put = <T = any>(p: string, b: unknown = {}) => api<T>('PUT', p, b);
export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

export function issuesText(e: unknown): string {
  if (e instanceof ApiError) {
    const issues = (e.body?.issues ?? []) as { path: string; message: string }[];
    return issues.length ? `${e.message} ${issues.slice(0, 4).map((i) => `${i.path}: ${i.message}`).join('; ')}${issues.length > 4 ? ` (+${issues.length - 4} more)` : ''}` : e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}
