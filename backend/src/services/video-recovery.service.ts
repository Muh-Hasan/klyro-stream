import { transcodeJobId, enqueueTranscode, videoQueue } from '../lib/queue/queues.js';
import * as videoRepo from '../repositories/video.repository.js';
import * as videoService from './video.service.js';

const BATCH_LIMIT = 500;
const LIVE_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

export type StuckAction = 'in-queue' | 'requeued' | 'marked-error' | 'changed-meanwhile';
export type ExpireAction = 'expired' | 'changed-meanwhile';

type Options = { olderThan: Date; dryRun: boolean; clubId?: string };

const decideStuck = async (videoId: string) => {
  const job = await videoQueue.getJob(transcodeJobId(videoId));
  const state = job ? await job.getState() : 'missing';
  if (LIVE_STATES.has(state)) return { state, action: 'in-queue' as const };
  if (job && state === 'failed') {
    return { state, action: 'marked-error' as const, reason: job.failedReason };
  }
  return { state, action: 'requeued' as const, job };
};

export const requeueStuckVideos = async ({ olderThan, dryRun, clubId }: Options) => {
  const videos = await videoRepo.findProcessingSince(olderThan, BATCH_LIMIT, clubId);
  const results: { videoId: string; jobState: string; action: StuckAction }[] = [];

  for (const { id: videoId } of videos) {
    const decision = await decideStuck(videoId);
    let action: StuckAction = decision.action;

    if (!dryRun && decision.action === 'marked-error') {
      const reason = `Processing failed: ${decision.reason || 'unknown reason'}`;
      if (!(await videoService.markVideoFailed(videoId, reason))) action = 'changed-meanwhile';
    }
    if (!dryRun && decision.action === 'requeued') {
      await decision.job?.remove();
      await enqueueTranscode(videoId);
    }
    results.push({ videoId, jobState: decision.state, action });
  }
  return results;
};

export const expireAbandonedUploads = async ({ olderThan, dryRun, clubId }: Options) => {
  const videos = await videoRepo.findUploadingCreatedBefore(olderThan, BATCH_LIMIT, clubId);
  const hours = Math.round((Date.now() - olderThan.getTime()) / 3_600_000);
  const reason = `Upload abandoned: not completed within ${hours} h`;
  const results: { videoId: string; createdAt: Date; action: ExpireAction }[] = [];

  for (const { id: videoId, createdAt } of videos) {
    let action: ExpireAction = 'expired';
    if (!dryRun && !(await videoService.expireUpload(videoId, reason))) {
      action = 'changed-meanwhile';
    }
    results.push({ videoId, createdAt, action });
  }
  return results;
};
