import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

/** Tiny reverse-proxy plugin so the browser never makes cross-origin requests. */
function corsProxy(): Plugin {
  return {
    name: 'cors-proxy',
    configureServer(server) {
      server.middlewares.use('/api/proxy', (req, res) => {
        const target = req.headers['x-target-url'] as string | undefined;
        if (!target) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing x-target-url header');
          return;
        }

        const parsed = new URL(target);
        const mod = parsed.protocol === 'https:' ? https : http;

        const proxyReq = mod.request(
          parsed,
          { method: req.method, headers: { host: parsed.host } },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
          },
        );

        proxyReq.on('error', (err) => {
          console.error('[cors-proxy]', err.message);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
          }
          res.end('Proxy error: ' + err.message);
        });

        req.pipe(proxyReq, { end: true });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), corsProxy()],
})
