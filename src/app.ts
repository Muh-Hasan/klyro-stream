import express from 'express';
import healthRoutes from './routes/health.routes.js';

export const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use('/health', healthRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  return app;
};