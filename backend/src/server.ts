/**
 * API entry point: start listening, and shut down cleanly.
 *
 * Graceful shutdown on SIGTERM/SIGINT (what Docker and Kubernetes send):
 *   1. stop accepting connections and let in-flight requests finish
 *   2. close Postgres and Redis
 *   3. force-exit after 10 s if something hangs
 */
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb } from './lib/db/client.js';
import { closeRedis } from './lib/redis/client.js';
import { logger } from './utils/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const server: Server = createApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API listening');
});

let shuttingDown = false;

const shutdown = async (reason: string, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections(); // drop idle keep-alive sockets now; busy ones finish first
  });

  const results = await Promise.allSettled([closeDb(), closeRedis()]);
  for (const result of results) {
    if (result.status === 'rejected') logger.error({ err: result.reason }, 'error during shutdown');
  }

  logger.info('shutdown complete');
  process.exit(exitCode);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// A bug escaped every handler. The process state is unknown: log it and restart cleanly.
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  void shutdown('uncaughtException', 1);
});
