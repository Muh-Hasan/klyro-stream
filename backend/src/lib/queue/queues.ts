import { Queue } from 'bullmq';
import { logger } from '../../utils/logger.js';
import { producerConnection } from './connection.js';

export const VIDEO_QUEUE = 'video-processing';

export type TranscodeJob = {
  videoId: string;
  requestId?: string;
};

export const videoQueue = new Queue<TranscodeJob>(VIDEO_QUEUE, {
  connection: producerConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

videoQueue.on('error', (err) => logger.error({ err, queue: VIDEO_QUEUE }, 'queue error'));

export const transcodeJobId = (videoId: string) => `video-${videoId}`;

export const enqueueTranscode = (videoId: string, requestId?: string) =>
  videoQueue.add('transcode', { videoId, requestId }, { jobId: transcodeJobId(videoId) });

export const closeQueues = async () => {
  await videoQueue.close();
};
