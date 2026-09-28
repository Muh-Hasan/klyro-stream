import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { requestLogger } from './middleware/request-logger.middleware.js';
import { routes } from './routes/index.js';

export const createApp = (): Express => {
  const app = express();

  app.use(requestLogger);
  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true, // allow the refresh-token cookie
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
