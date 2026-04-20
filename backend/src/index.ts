import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'express-async-errors';
import pinoHttp from 'pino-http';
import path from 'node:path';
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
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
app.use(pinoHttp({ logger }));

// Health check
app.use('/health', healthRoutes);

// Root endpoint for quick local verification
app.get('/', (_req, res) => {
  res.json({
    name: 'KWSA Backend API',
    status: 'running',
    environment: NODE_ENV,
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

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Server running in ${NODE_ENV} mode on port ${PORT}`);
});

export default app;
