import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { closeDb } from './lib/db/client.js';
import { closeMailer } from './lib/mail/mailer.js';
import { closeQueueConnections, queueConnection } from './lib/queue/connection.js';
import {
  closeQueues,
  type EmailJob,
  NOTIFICATION_QUEUE,
  type TranscodeJob,
  VIDEO_QUEUE,
} from './lib/queue/queues.js';
import { closeRedis } from './lib/redis/client.js';
import { logger } from './utils/logger.js';
import { processEmail } from './worker/notification.processor.js';
import { processVideo, stopActiveJobs } from './worker/video.processor.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;
const EMAIL_CONCURRENCY = 5;

const videoWorker = new Worker<TranscodeJob>(VIDEO_QUEUE, processVideo, {
  connection: queueConnection('worker'),
  concurrency: env.WORKER_CONCURRENCY,
});

videoWorker.on('ready', () =>
  logger.info({ queue: VIDEO_QUEUE, concurrency: env.WORKER_CONCURRENCY }, 'worker ready'),
);
videoWorker.on('completed', (job) => logger.info({ jobId: job.id }, 'job completed'));
videoWorker.on('failed', (job, err) => logger.debug({ jobId: job?.id, err }, 'job failed'));
videoWorker.on('stalled', (jobId) => logger.warn({ jobId }, 'job stalled, moved back to waiting'));
videoWorker.on('error', (err) => logger.error({ err, queue: VIDEO_QUEUE }, 'worker error'));

const emailWorker = new Worker<EmailJob>(NOTIFICATION_QUEUE, processEmail, {
  connection: queueConnection('worker'),
  concurrency: EMAIL_CONCURRENCY,
});

emailWorker.on('ready', () =>
  logger.info({ queue: NOTIFICATION_QUEUE, concurrency: EMAIL_CONCURRENCY }, 'worker ready'),
);
emailWorker.on('failed', (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    logger.error({ jobId: job.id, err, to: job.data.to }, 'email gave up after every retry');
  }
});
emailWorker.on('error', (err) => logger.error({ err, queue: NOTIFICATION_QUEUE }, 'worker error'));

let shuttingDown = false;

const shutdown = async (reason: string, exitCode = 0) => {
  if (shuttingDown) {
    logger.warn({ reason }, 'second signal, exiting without waiting for active jobs');
    process.exit(1);
  }
  shuttingDown = true;
  logger.info({ reason }, 'shutting down, returning active jobs to the queue');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  const closing = Promise.all([videoWorker.close(), emailWorker.close()]);
  stopActiveJobs();
  await closing;
  closeMailer();
  logger.info('worker closed');

  const results = await Promise.allSettled([
    closeQueues().finally(closeQueueConnections),
    closeDb(),
    closeRedis(),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') logger.error({ err: result.reason }, 'error during shutdown');
  }

  logger.info('shutdown complete');
  process.exit(exitCode);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  void shutdown('uncaughtException', 1);
});
