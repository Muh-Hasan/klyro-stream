import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const app = buildApp();

const server = app.listen(env.PORT, () => {
  logger.info({ env: env.NODE_ENV, port: env.PORT }, 'API listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Received shutdown signal, shutting down gracefully');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));