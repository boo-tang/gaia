// The whole site on one origin: the web build (`yarn workspace @gaia/web build`) and the HTTP API
// under `/api`, as the Vite proxy has it in development. The app has no client routes, so a path
// that is not a file gets 404.
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

export const createSite = (api: Hono, webDir: string) => {
  const site = new Hono();

  site.use(async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    if (c.res.status === 200 && !c.req.path.startsWith('/api/')) {
      // Vite puts a content hash in each file name under assets/, so these files never change.
      const immutable = c.req.path.startsWith('/assets/');
      c.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
  });

  site.route('/api', api);
  site.use(serveStatic({ root: webDir }));

  return site;
};
