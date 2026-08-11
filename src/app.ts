import express from 'express';
import { errorHandler } from './middleware/error.middleware.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';

export const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);

  return app;
};
