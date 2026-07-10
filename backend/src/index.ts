import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'express-async-errors';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { closeSharedPgPool } from './config/db.js';
import { closePublicReadOnlyPgPool } from './config/publicDb.js';
import { storageConfig } from './config/storage.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireAuth } from './middleware/requireAuth.js';
import { requireAuthNoAssociate } from './middleware/requireAuth.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import listingRoutes from './routes/listings.js';
import notificationsRoutes from './routes/notifications.js';
import transactionRoutes from './routes/transactions.js';
import associateRoutes from './routes/associates.js';
import agentsRoutes from './routes/agents.js';
import marketCentersRoutes from './routes/marketCenters.js';
import opsRoutes from './routes/ops.js';
import reportsRoutes from './routes/reports.js';
import teamsRoutes from './routes/teams.js';
import cmaRoutes from './routes/cma.js';
import marketingRoutes from './routes/marketing.js';
import loomRoutes from './routes/loom.js';
import listingTransferRoutes from './routes/listingTransfer.js';
import agentDeregistrationRoutes from './routes/agentDeregistration.js';
import mcDocumentHubRoutes from './routes/mcDocumentHub.js';
import trainingHubRoutes from './routes/trainingHub.js';
import frontdoorSubmissionsRoutes from './routes/frontdoorSubmissions.js';
import publicRoutes from './routes/public.js';
import loginActivityRoutes from './routes/loginActivity.js';
import communicationsRoutes from './routes/communications.js';
import portalRecoveryRoutes from './routes/portalRecovery.js';

import rentalsRoutes from './routes/rentals.js';

const app = express();

function isLocalDevOrigin(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function isKwHomesOrigin(origin: string): boolean {
  const normalized = origin.trim().toLowerCase();
  return normalized === 'https://kwhomes.co.za' || normalized === 'https://www.kwhomes.co.za';
}

// Middleware
app.set('trust proxy', env.trustProxy);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http:'],
    },
  },
}));
app.use((req, res, next) => {
  // The image proxy is a fully public read-only endpoint. Allow any origin so that
  // browser fetch() and html-to-image's internal fetch() can retrieve proxied images
  // cross-origin (required when frontend and backend are on separate Cloud Run origins).
  if (req.path === '/api/marketing/image-proxy') {
    return cors({ origin: '*' })(req, res, next);
  }
  return cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin) || isLocalDevOrigin(origin) || isKwHomesOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS origin is not allowed.'));
    },
    credentials: true,
  })(req, res, next);
});
// 60MB binary images are sent as base64 JSON payloads, which expands payload size significantly.
app.use(express.json({ limit: '100mb' }));
if (storageConfig.localUploadsEnabled) {
  app.use('/uploads', express.static(storageConfig.uploadsDir));
}
app.use(pinoHttp({ logger }));

// Health check
app.use('/health', healthRoutes);
app.use('/api/public', publicRoutes);

// Root endpoint for quick local verification
app.get('/', (_req, res) => {
  res.json({
    name: 'KWSA Backend API',
    status: 'running',
    environment: env.nodeEnv,
    endpoints: {
      health: '/health',
      listings: '/api/listings',
      transactions: '/api/transactions',
      associates: '/api/associates',
      agents: '/api/agents',
      marketCenters: '/api/market-centers'
    }
  });
});

// LOOM routes - use special auth that doesn't require associate status
app.use('/api/loom', requireAuthNoAssociate, loomRoutes);
if (env.communications.enabled) {
  app.use('/api/communications', communicationsRoutes);
}

// Public image proxy for marketing flyers — must be registered before requireAuth so
// <img src> tags (which cannot send Bearer tokens) can load proxied listing images.
// SSRF protection: only external https:// or backend-relative /uploads/ URLs are allowed;
// private IP ranges and metadata endpoints are blocked.
function isPrivateUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    // Block localhost, loopback, link-local (metadata), and RFC-1918 private ranges
    return /^(localhost|127\.|0\.0\.0\.0|::1$)/.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      /^192\.168\./.test(hostname);
  } catch {
    return true; // Malformed URL — treat as private/invalid
  }
}

app.get('/api/marketing/image-proxy', async (req, res) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!rawUrl) {
    res.status(400).json({ error: 'Missing image url.' });
    return;
  }

  let targetUrl = rawUrl;
  if (rawUrl.startsWith('/uploads/')) {
    const origin = `${req.protocol}://${req.get('host')}`;
    targetUrl = `${origin}${rawUrl}`;
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    res.status(400).json({ error: 'Only http(s) image urls are supported.' });
    return;
  }

  if (isPrivateUrl(targetUrl)) {
    res.status(400).json({ error: 'Image URL points to a disallowed host.' });
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      signal: AbortSignal.timeout(12000),
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    if (!upstream.ok) {
      res.status(502).json({ error: `Could not load image (${upstream.status}).` });
      return;
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      res.status(502).json({ error: 'Remote URL did not return an image.' });
      return;
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).send(bytes);
  } catch {
    res.status(502).json({ error: 'Could not load image from source.' });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
app.use('/api/listings', listingRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/associates', associateRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/market-centers', marketCentersRoutes);
app.use('/api/ops', opsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/cma', cmaRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/listing-transfer', listingTransferRoutes);
app.use('/api/agent-deregistration', agentDeregistrationRoutes);
app.use('/api/mc-document-hub', mcDocumentHubRoutes);
app.use('/api/training-hub', trainingHubRoutes);
app.use('/api/frontdoor-submissions', frontdoorSubmissionsRoutes);
app.use('/api/rentals', rentalsRoutes);
app.use('/api/login-activity', loginActivityRoutes);
app.use('/api/portal-recovery', portalRecoveryRoutes);

// Error handling (must be last)
app.use(errorHandler);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const server = app.listen(env.port, '0.0.0.0', () => {
  logger.info(
    {
      port: env.port,
      environment: env.nodeEnv,
      dbClient: env.database.client,
      storageBackend: env.storage.backend,
    },
    'Server running'
  );

  if (env.isProduction && env.storage.localUploadsEnabled) {
    logger.warn(
      'STORAGE_BACKEND=local uses ephemeral container disk. Uploads will not persist across Cloud Run instance restarts.'
    );
  }
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, 'Shutting down server');

  server.close(async (serverError) => {
    if (serverError) {
      logger.error({ err: serverError }, 'Error while closing HTTP server');
      process.exitCode = 1;
    }

    try {
      await closeSharedPgPool();
      await closePublicReadOnlyPgPool();
    } catch (poolError) {
      logger.error({ err: poolError }, 'Error while closing PostgreSQL pool');
      process.exitCode = 1;
    } finally {
      process.exit();
    }
  });
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

export default app;
