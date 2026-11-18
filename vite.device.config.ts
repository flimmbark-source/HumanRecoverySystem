// The build that runs entirely on the device (the Android app, or any modern browser): the React client,
// plus the API and its PostgreSQL database (PGlite) in a Web Worker. Server modules that need Node or a
// database server are swapped for device versions. All other modules are the code the server runs.
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** Server module → device module. Every importer of the server module gets the device module. */
export const DEVICE_MODULES: Record<string, string> = {
  'src/server/db.ts': 'src/device/db.ts',
  'src/server/config.ts': 'src/device/config.ts',
  'src/server/reports/fonts.ts': 'src/device/fonts.ts',
  'src/server/providers/anthropic.ts': 'src/device/anthropic.ts',
};

export function substitute(files: Record<string, string>): Plugin {
  const map = new Map(Object.entries(files).map(([from, to]) => [path.resolve(root, from), path.resolve(root, to)]));
  return {
    name: 'weave-device-modules',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      return (r && map.get(r.id)) ?? null;
    },
  };
}

const alias = [
  { find: /^node:crypto$/, replacement: path.resolve(root, 'src/device/node-crypto.ts') },
  { find: /^node:util$/, replacement: path.resolve(root, 'src/device/node-util.ts') },
  // The standalone build bundles the standard fonts and reads nothing from disk.
  { find: /^pdfkit$/, replacement: 'pdfkit/js/pdfkit.standalone.js' },
];

export default defineConfig({
  root: 'src/device',
  base: './',
  mode: 'device',
  plugins: [react(), substitute(DEVICE_MODULES)],
  resolve: { alias },
  worker: { format: 'es', plugins: () => [substitute(DEVICE_MODULES)] },
  build: { outDir: '../../dist/device', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000 },
});
