import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { getDb } from './server/db.ts';
import { createApiRouter } from './server/routes.ts';
import { verifyCsrfOnCookieMutation } from './server/security.ts';
import { attachWebSocketServer } from './server/ws.ts';

export async function createAppServer(options?: { customDbPath?: string; skipVite?: boolean }) {
  const db = getDb(options?.customDbPath);
  const app = express();
  app.set('trust proxy', 1);

  // Security headers (iframe-safe CSP without X-Frame-Options)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.get('/sitemap.xml', (req, res) => {
    const rawOrigin = process.env.APP_URL || `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
    let safeOrigin = 'http://localhost:3000';
    try {
      const parsed = new URL(rawOrigin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        safeOrigin = parsed.origin;
      }
    } catch {
      safeOrigin = 'http://localhost:3000';
    }
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${safeOrigin}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`
    );
  });

  app.use('/api/v1/ai/transcribe', express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1', verifyCsrfOnCookieMutation, createApiRouter(db));

  const server = http.createServer(app);
  if (!options?.skipVite) {
    attachWebSocketServer(server, db);
  }

  if (!options?.skipVite) {
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          allowedHosts: true,
          hmr: {
            server,
            path: '/__vite_hmr',
          },
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.resolve(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  return { app, server, db };
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  const PORT = Number(process.env.PORT || 3000);
  createAppServer().then(({ server }) => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`AbroadConnect India server listening on http://0.0.0.0:${PORT}`);
    });
  });
}
