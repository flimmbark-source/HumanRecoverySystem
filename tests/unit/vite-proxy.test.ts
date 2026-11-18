import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer as createViteServer } from 'vite';
import { expect, test } from 'vitest';
import config from '../../vite.config';

test('Vite serves the client API module and forwards API requests', async () => {
  const backend = createServer((request, response) => {
    if (request.url === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<html></html>');
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const target = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  // Use the actual proxy keys with an isolated backend port.
  const proxy = Object.fromEntries(Object.keys(config.server?.proxy ?? {}).map((rule) => [rule, target]));
  try {
    const vite = await createViteServer({
      ...config,
      configFile: false,
      server: { host: '127.0.0.1', port: 0, hmr: false, proxy },
    });
    try {
      await vite.listen();
      const url = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
      const module = await fetch(`${url}/api.ts`);
      expect(module.headers.get('Content-Type')).toMatch(/javascript/i);
      expect(await module.text()).toContain('export');
      const health = await fetch(`${url}/api/health`);
      expect(await health.json()).toEqual({ ok: true });
    } finally {
      await vite.close();
    }
  } finally {
    backend.closeAllConnections();
    await new Promise<void>((resolve, reject) => backend.close((error) => error ? reject(error) : resolve()));
  }
});
