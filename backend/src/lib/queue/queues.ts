import { setTimeout as sleep } from 'node:timers/promises';
import { Queue } from 'bullmq';
import { logger } from '../../utils/logger.js';
import { queueConnection } from './connection.js';

export const VIDEO_QUEUE = 'video-processing';
export const NOTIFICATION_QUEUE = 'notifications';

const ENQUEUE_TIMEOUT_MS = 2_000;

export type TranscodeOutput = {
  hlsPath: string;
  thumbnailPath: string;
  durationSeconds: number;
  width?: number;
  height?: number;
};

export type TranscodeJob = {
  videoId: string;
  requestId?: string;
  output?: TranscodeOutput;
};

export type EmailJob = { to: string; subject: string; text: string; requestId?: string };

export const videoQueue = new Queue<TranscodeJob>(VIDEO_QUEUE, {
  connection: queueConnection('producer'),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

export const notificationQueue = new Queue<EmailJob>(NOTIFICATION_QUEUE, {
  connection: queueConnection('producer'),
  defaultJobOptions: {
    attempts: 8,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 60 * 60 },
    removeOnFail: { age: 24 * 60 * 60 },
  },
});

videoQueue.on('error', (err) => logger.error({ err, queue: VIDEO_QUEUE }, 'queue error'));
notificationQueue.on('error', (err) =>
  logger.error({ err, queue: NOTIFICATION_QUEUE }, 'queue error'),
);

const withTimeout = async <T>(work: Promise<T>): Promise<T> => {
  const timeout = new AbortController();
  try {
    return await Promise.race([
      work,
      sleep(ENQUEUE_TIMEOUT_MS, undefined, { signal: timeout.signal }).then(() => {
        throw new Error(`Enqueue timed out after ${ENQUEUE_TIMEOUT_MS} ms`);
      }),
    ]);
  } finally {
    timeout.abort();
  }
};

export const transcodeJobId = (videoId: string) => `video-${videoId}`;

export const videoIdFromJobId = (jobId: string) =>
  jobId.startsWith('video-') ? jobId.slice('video-'.length) : undefined;

export const removeTranscodeJob = async (videoId: string) =>
  (await videoQueue.remove(transcodeJobId(videoId))) === 1;

export const enqueueTranscode = (videoId: string, requestId?: string) =>
  withTimeout(
    videoQueue.add('transcode', { videoId, requestId }, { jobId: transcodeJobId(videoId) }),
  );

export const enqueueEmail = (mail: EmailJob, jobId?: string) =>
  withTimeout(notificationQueue.add('send-email', mail, { jobId }));

export const closeQueues = async () => {
  await Promise.all([videoQueue.close(), notificationQueue.close()]);
};
