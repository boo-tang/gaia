import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

import { deploymentPlugin, resolveDeploymentFile } from './deployment-plugin';

// The tests always use the fixture, so they do not need a local deployment.
const TEST_DEPLOYMENT_FILE = 'packages/web/test/fixtures/deployment.json';

export default defineConfig(({ mode }) => {
  // All variables of the env files and the shell, also the ones without the `VITE_` prefix. Only
  // the `VITE_` variables go to the browser.
  const env = loadEnv(mode, import.meta.dirname, '');
  const deploymentFile = resolveDeploymentFile(mode === 'test' ? TEST_DEPLOYMENT_FILE : env.DEPLOYMENT_FILE);

  return {
    plugins: [react(), deploymentPlugin(deploymentFile)],
    // The MapLibre worker is an ES module (src/map/maplibre-worker.ts).
    worker: { format: 'es' },
    server: {
      proxy: {
        // The server has no CORS. In development, the browser calls `/api/*` on the Vite server,
        // which sends the request to the Gaia server without the `/api` prefix.
        '/api': {
          target: env.API_PROXY_TARGET || 'http://localhost:8787',
          changeOrigin: true,
          rewrite: (requestPath: string) => requestPath.replace(/^\/api/, ''),
          // The stream (SSE) through the proxy: the proxy sends the response headers only with
          // the first message, so the browser does not see that the stream is open. And when the
          // server stops, the proxy keeps the browser's connection open. Send the headers at
          // once, and close the browser's connection with the server's.
          configure: proxy => {
            proxy.on('proxyRes', (proxyRes, _request, response) => {
              if (proxyRes.headers['content-type']?.startsWith('text/event-stream')) {
                // The proxy sets the headers after this event.
                setImmediate(() => response.flushHeaders());
              }
              proxyRes.on('close', () => {
                if (!response.writableEnded) {
                  response.destroy();
                }
              });
            });
          },
        },
      },
    },
    test: {
      include: ['test/**/*.test.{ts,tsx}'],
    },
  };
});
