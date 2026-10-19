import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type Job, UnrecoverableError, WaitingError } from 'bullmq';
import { env } from '../config/env.js';
import type { TranscodeJob, TranscodeOutput } from '../lib/queue/queues.js';
import { BUCKETS } from '../lib/storage/client.js';
import * as videoRepo from '../repositories/video.repository.js';
import { notifyVideoFailed, notifyVideoReady } from '../services/notification.service.js';
import * as videoService from '../services/video.service.js';
import { type Logger, logger } from '../utils/logger.js';
import { downloadSource } from './pipeline/download.js';
import { probe } from './pipeline/probe.js';
import { makeThumbnail } from './pipeline/thumbnail.js';
import { transcodeHls } from './pipeline/transcode.js';
import { uploadDir, uploadFile } from './pipeline/upload.js';

const WORK_ROOT = path.join(os.tmpdir(), 'klyro');

const PROGRESS = {
  downloaded: 10,
  transcodeStart: 10,
  transcodeEnd: 85,
  thumbnail: 90,
  uploaded: 100,
};

const shutdown = new AbortController();

export const stopActiveJobs = () => shutdown.abort();

const isFinalAttempt = (job: Job, err: unknown) =>
  err instanceof UnrecoverableError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

const reporter = (job: Job, log: Logger) => (percent: number) => {
  void job.updateProgress(Math.round(percent)).catch((err: unknown) => {
    log.warn({ err }, 'could not report progress');
  });
};

const produce = async (
  job: Job<TranscodeJob>,
  rawPath: string,
  dir: string,
  log: Logger,
): Promise<TranscodeOutput> => {
  const { videoId } = job.data;
  const signal = shutdown.signal;
  const progress = reporter(job, log);
  const timings: Record<string, number> = {};
  const timed = async <T>(phase: string, work: () => Promise<T>) => {
    const started = performance.now();
    try {
      return await work();
    } finally {
      timings[phase] = Math.round(performance.now() - started);
    }
  };

  const source = path.join(dir, 'source');
  const hlsDir = path.join(dir, 'hls');
  const thumbnail = path.join(dir, 'thumbnail.jpg');

  const sourceBytes = await timed('download', () => downloadSource(rawPath, source, signal));
  progress(PROGRESS.downloaded);
  if (Math.random() < env.FAIL_RATE) throw new Error('Simulated transient failure (FAIL_RATE)');

  const meta = await timed('probe', () => probe(source, signal));
  log.info({ sourceBytes, ...meta }, 'source probed');

  const span = PROGRESS.transcodeEnd - PROGRESS.transcodeStart;
  const renditions = await timed('transcode', () =>
    transcodeHls(source, hlsDir, meta, (f) => progress(PROGRESS.transcodeStart + f * span), signal),
  );
  await timed('thumbnail', () => makeThumbnail(source, thumbnail, meta.durationSeconds, signal));
  progress(PROGRESS.thumbnail);

  const keys = videoService.outputKeys(videoId);
  const uploaded = await timed('upload', async () => {
    const hls = await uploadDir(hlsDir, BUCKETS.hls, keys.hlsPrefix, signal);
    await uploadFile(thumbnail, BUCKETS.thumbnails, keys.thumbnailPath, signal);
    return hls;
  });
  progress(PROGRESS.uploaded);

  const totalMs = Object.values(timings).reduce((sum, ms) => sum + ms, 0);
  log.info(
    {
      timings,
      totalMs,
      sourceBytes,
      outputBytes: uploaded.bytes,
      outputFiles: uploaded.files,
      mediaSeconds: meta.durationSeconds,
      renditions: renditions.map((r) => r.name),
      secondsPerGb: Math.round(totalMs / (sourceBytes / 1e9) / 1000),
    },
    'outputs uploaded',
  );

  return {
    hlsPath: keys.hlsPath,
    thumbnailPath: keys.thumbnailPath,
    durationSeconds: Math.round(meta.durationSeconds),
    width: meta.width,
    height: meta.height,
  };
};

const transcode = async (job: Job<TranscodeJob>, log: Logger) => {
  const { videoId } = job.data;

  const video = await videoRepo.findById(videoId);
  if (!video) throw new UnrecoverableError('Video not found');
  if (video.status !== 'PROCESSING') {
    throw new UnrecoverableError(`Video is ${video.status}, expected PROCESSING`);
  }
  if (!video.rawPath) throw new UnrecoverableError('Video has no source file');

  let output = job.data.output;
  if (output) {
    log.info('outputs already uploaded by an earlier attempt, skipping to READY');
  } else {
    const dir = path.join(WORK_ROOT, String(job.id));
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    try {
      log.info('processing started');
      output = await produce(job, video.rawPath, dir, log);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    await job.updateData({ ...job.data, output });
  }

  const ready = await videoService.markVideoReady(videoId, output);
  if (!ready) throw new UnrecoverableError('Video left PROCESSING while it was being processed');
  await notifyVideoReady(videoId, job.data.requestId);

  log.info('processing complete');
  return { status: ready.status, ...output };
};

const failForGood = async (job: Job<TranscodeJob>, err: unknown, log: Logger) => {
  const { videoId } = job.data;
  const reason =
    err instanceof UnrecoverableError
      ? err.message
      : `Processing failed after ${job.attemptsMade + 1} attempts`;
  const failed = await videoService.markVideoFailed(videoId, reason).catch((markErr: unknown) => {
    log.error({ err: markErr }, 'could not mark video as ERROR');
    return undefined;
  });

  let deletedOutputs: number | undefined;
  if (failed) {
    await notifyVideoFailed(videoId, job.data.requestId);
    deletedOutputs = await videoService.deleteVideoOutputs(videoId).catch((cleanErr: unknown) => {
      log.error({ err: cleanErr }, 'could not delete partial outputs');
      return undefined;
    });
  }
  log.error({ err, markedError: Boolean(failed), deletedOutputs }, 'processing failed for good');
};

export const processVideo = async (job: Job<TranscodeJob>, token?: string) => {
  const { videoId, requestId } = job.data;
  const log = logger.child({ jobId: job.id, videoId, requestId, attempt: job.attemptsMade + 1 });

  try {
    return await transcode(job, log);
  } catch (err) {
    if (shutdown.signal.aborted) {
      await job.moveToWait(token);
      log.warn('worker is shutting down, job moved back to waiting');
      throw new WaitingError();
    }
    if (!isFinalAttempt(job, err)) {
      log.warn({ err }, 'attempt failed, will retry');
      throw err;
    }
    await failForGood(job, err, log);
    throw err;
  }
};
