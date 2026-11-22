// The page side of the device build. It starts the API worker and sends every /api request to it.
// Export links also point at /api, so the page fetches those files itself and saves them on the device.
import { toast } from '../client/store';
import { saveFile } from '../client/ui';
import type { ApiRequest, WorkerMessage } from './worker';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const waiting = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>();
let nextId = 0;

/** Settles when the database is open: rejects with the reason if it cannot open. */
export const ready = new Promise<void>((resolve, reject) => {
  worker.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
    const m = e.data;
    if (m.type === 'ready') resolve();
    else if (m.type === 'failed') reject(new Error(m.message));
    else {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      w?.resolve(new Response([204, 205, 304].includes(m.status) ? null : m.body, { status: m.status, headers: m.headers }));
    }
  });
  // The worker stopped: nothing it was doing will answer. The client treats a rejected fetch as unreachable.
  worker.addEventListener('error', (e) => {
    const err = new TypeError(e.message || 'The database worker stopped.');
    reject(err);
    for (const w of waiting.values()) w.reject(err);
    waiting.clear();
  });
});

const browserFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return browserFetch(input, init);
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer();
  const msg: ApiRequest = { id: nextId++, method: req.method, path: url.pathname + url.search, headers: [...req.headers], body };
  return new Promise<Response>((resolve, reject) => {
    waiting.set(msg.id, { resolve, reject });
    worker.postMessage(msg, body ? [body] : []);
  });
};

// A WebView ignores window.print(). The Android app opens the system print dialog instead.
const android = (window as { WeaveAndroid?: { print(): void } }).WeaveAndroid;
if (android) window.print = () => android.print();

document.addEventListener('click', (e) => {
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || e.defaultPrevented || e.button !== 0) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return;
  e.preventDefault();
  void (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `The export failed (${res.status}).`);
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] || a.getAttribute('download') || url.pathname.split('/').pop()!;
      await saveFile(await res.blob(), name);
    } catch (err) { toast(err instanceof Error ? err.message : 'The export failed.', 'error'); }
  })();
});
