import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'express-async-errors';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { closeSharedPgPool } from './config/db.js';
import { storageConfig } from './config/storage.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.js';
import listingRoutes from './routes/listings.js';
import transactionRoutes from './routes/transactions.js';
import associateRoutes from './routes/associates.js';
import agentsRoutes from './routes/agents.js';
import marketCentersRoutes from './routes/marketCenters.js';
import opsRoutes from './routes/ops.js';
const app = express();
// Middleware
app.set('trust proxy', env.trustProxy);
app.use(helmet());
app.use(cors({
    origin(origin, callback) {
        if (!origin || env.corsOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('CORS origin is not allowed.'));
    },
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
if (storageConfig.localUploadsEnabled) {
    app.use('/uploads', express.static(storageConfig.uploadsDir));
}
app.use(pinoHttp({ logger }));
// Health check
app.use('/health', healthRoutes);
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
// API Routes
app.use('/api/listings', listingRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/associates', associateRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/market-centers', marketCentersRoutes);
app.use('/api/ops', opsRoutes);
// Error handling (must be last)
app.use(errorHandler);
// 404 handler
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});
const server = app.listen(env.port, '0.0.0.0', () => {
    logger.info({
        port: env.port,
        environment: env.nodeEnv,
        dbClient: env.database.client,
        storageBackend: env.storage.backend,
    }, 'Server running');
    if (env.isProduction && env.storage.localUploadsEnabled) {
        logger.warn('STORAGE_BACKEND=local uses ephemeral container disk. Uploads will not persist across Cloud Run instance restarts.');
    }
});
let shuttingDown = false;
async function shutdown(signal) {
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
        }
        catch (poolError) {
            logger.error({ err: poolError }, 'Error while closing PostgreSQL pool');
            process.exitCode = 1;
        }
        finally {
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
//# sourceMappingURL=index.js.map