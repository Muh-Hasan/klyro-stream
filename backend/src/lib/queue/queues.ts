import { setTimeout as sleep } from 'node:timers/promises';
import { Queue } from 'bullmq';
import { logger } from '../../utils/logger.js';
import { queueConnection } from './connection.js';

export const VIDEO_QUEUE = 'video-processing';

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

export const videoQueue = new Queue<TranscodeJob>(VIDEO_QUEUE, {
  connection: queueConnection('producer'),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

videoQueue.on('error', (err) => logger.error({ err, queue: VIDEO_QUEUE }, 'queue error'));

export const transcodeJobId = (videoId: string) => `video-${videoId}`;

export const removeTranscodeJob = async (videoId: string) =>
  (await videoQueue.remove(transcodeJobId(videoId))) === 1;

export const enqueueTranscode = async (videoId: string, requestId?: string) => {
  const timeout = new AbortController();
  try {
    return await Promise.race([
      videoQueue.add('transcode', { videoId, requestId }, { jobId: transcodeJobId(videoId) }),
      sleep(ENQUEUE_TIMEOUT_MS, undefined, { signal: timeout.signal }).then(() => {
        throw new Error(`Enqueue timed out after ${ENQUEUE_TIMEOUT_MS} ms`);
      }),
    ]);
  } finally {
    timeout.abort();
  }
};

export const closeQueues = async () => {
  await videoQueue.close();
};
