import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { env, ROOT } from './config/env.js';
import { errorHandler } from './middleware/validate.js';
import authRoutes from './routes/auth.js';
import serverRoutes from './routes/servers.js';
import channelRoutes from './routes/channels.js';
import iptvUserRoutes from './routes/iptvUsers.js';
import overviewRoutes from './routes/overview.js';
import publicRoutes from './routes/public.js';

export function createApp({ serveClient = true } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  if (env.LOG_REQUESTS && env.NODE_ENV !== 'test') {
    app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  }

  app.use(cors(env.CORS_ORIGIN ? { origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()) } : {}));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', driver: env.DB_DRIVER, uptime: Math.round(process.uptime()) });
  });

  // Public (no panel login): Flussonic auth backend + subscriber playlists.
  app.use(publicRoutes);

  app.use('/api/auth', authRoutes);
  app.use('/api/servers', serverRoutes);
  app.use('/api/channels', channelRoutes);
  app.use('/api/iptv-users', iptvUserRoutes);
  app.use('/api/overview', overviewRoutes);

  app.use('/api', (req, res) => res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl}` }));

  if (serveClient) {
    const dist = path.join(ROOT, 'client', 'dist');
    const indexHtml = path.join(dist, 'index.html');
    if (fs.existsSync(indexHtml)) {
      app.use(express.static(dist, { index: false, maxAge: '1h' }));
      // SPA fallback: any non-API path renders the React app.
      app.get('*', (req, res) => res.sendFile(indexHtml));
    } else {
      app.get('*', (req, res) =>
        res
          .status(503)
          .type('text/plain')
          .send('Front-end not built yet.\n\nRun:  npm run build\n\nThen restart the server.')
      );
    }
  }

  app.use(errorHandler);
  return app;
}
