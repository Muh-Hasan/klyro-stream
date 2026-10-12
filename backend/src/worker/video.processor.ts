import { setTimeout as sleep } from 'node:timers/promises';
import { type Job, UnrecoverableError } from 'bullmq';
import { env } from '../config/env.js';
import type { TranscodeJob } from '../lib/queue/queues.js';
import * as videoRepo from '../repositories/video.repository.js';
import * as videoService from '../services/video.service.js';
import { type Logger, logger } from '../utils/logger.js';

const STUB_STEPS = 5;
const STUB_STEP_MS = 500;

const isFinalAttempt = (job: Job, err: unknown) =>
  err instanceof UnrecoverableError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

const transcode = async (job: Job<TranscodeJob>, log: Logger) => {
  const { videoId } = job.data;

  const video = await videoRepo.findById(videoId);
  if (!video) throw new UnrecoverableError('Video not found');
  if (video.status !== 'PROCESSING') {
    throw new UnrecoverableError(`Video is ${video.status}, expected PROCESSING`);
  }

  log.info('processing started');
  for (let step = 1; step <= STUB_STEPS; step++) {
    await sleep(STUB_STEP_MS);
    if (step === 3 && Math.random() < env.FAIL_RATE) {
      throw new Error('Simulated transient failure (FAIL_RATE)');
    }
    await job.updateProgress(Math.round((step / STUB_STEPS) * 100));
  }

  const ready = await videoService.markVideoReady(videoId);
  if (!ready) throw new UnrecoverableError('Video left PROCESSING while it was being processed');

  log.info('processing complete');
  return { status: ready.status };
};

export const processVideo = async (job: Job<TranscodeJob>) => {
  const { videoId, requestId } = job.data;
  const log = logger.child({ jobId: job.id, videoId, requestId, attempt: job.attemptsMade + 1 });

  try {
    return await transcode(job, log);
  } catch (err) {
    if (!isFinalAttempt(job, err)) {
      log.warn({ err }, 'attempt failed, will retry');
      throw err;
    }
    const reason = err instanceof Error ? err.message : 'Processing failed';
    const failed = await videoService.markVideoFailed(videoId, reason).catch((markErr: unknown) => {
      log.error({ err: markErr }, 'could not mark video as ERROR');
      return undefined;
    });
    log.error({ err, markedError: Boolean(failed) }, 'processing failed for good');
    throw err;
  }
};
