import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = 5173;
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env;
const forwardedHost = CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  ? `${CODESPACE_NAME}-${port}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
  : undefined;

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    port,
    ...(forwardedHost && {
      host: '127.0.0.1',
      strictPort: true,
      allowedHosts: [forwardedHost],
      hmr: { clientPort: 443 },
    }),
    proxy: { '/api': 'http://localhost:8787' },
  },
});
