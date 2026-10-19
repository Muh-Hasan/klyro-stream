import { QueueEvents } from 'bullmq';
import { queueConnection } from '../lib/queue/connection.js';
import { VIDEO_QUEUE, videoIdFromJobId } from '../lib/queue/queues.js';
import * as videoRepo from '../repositories/video.repository.js';
import { logger } from '../utils/logger.js';
import { clubRoom, managersRoom, type RealtimeServer } from './rooms.js';

export const PROGRESS_INTERVAL_MS = 1_000;

type Sent = { percent: number; at: number };

export const relayVideoEvents = (io: RealtimeServer) => {
  const events = new QueueEvents(VIDEO_QUEUE, { connection: queueConnection('events') });
  const lastSent = new Map<string, Sent>();
  const clubIds = new Map<string, Promise<string | undefined>>();

  const clubOf = (videoId: string) => {
    let clubId = clubIds.get(videoId);
    if (!clubId) {
      clubId = videoRepo.findById(videoId).then((video) => video?.clubId);
      clubIds.set(videoId, clubId);
    }
    return clubId;
  };

  const forget = (videoId: string) => {
    lastSent.delete(videoId);
    clubIds.delete(videoId);
  };

  const shouldSend = (videoId: string, percent: number) => {
    const now = Date.now();
    const last = lastSent.get(videoId);
    if (last && (percent === last.percent || now - last.at < PROGRESS_INTERVAL_MS)) return false;
    lastSent.set(videoId, { percent, at: now });
    return true;
  };

  const onProgress = async (videoId: string, percent: number) => {
    if (!shouldSend(videoId, percent)) return;
    const clubId = await clubOf(videoId);
    if (!clubId) return;
    io.local.to(managersRoom(clubId)).emit('video:progress', { videoId, clubId, percent });
  };

  const onCompleted = async (videoId: string) => {
    forget(videoId);
    const video = await videoRepo.findById(videoId);
    if (video?.status !== 'READY') return;
    io.local.to(clubRoom(video.clubId)).emit('video:ready', {
      videoId,
      clubId: video.clubId,
      title: video.title,
      durationSeconds: video.durationSeconds,
      resolution: video.width && video.height ? { width: video.width, height: video.height } : null,
    });
  };

  const onFailed = async (videoId: string) => {
    forget(videoId);
    const video = await videoRepo.findById(videoId);
    if (video?.status !== 'ERROR') return;
    io.local.to(managersRoom(video.clubId)).emit('video:failed', {
      videoId,
      clubId: video.clubId,
      title: video.title,
      reason: video.errorMessage,
    });
  };

  const relay = (event: string, jobId: string, work: (videoId: string) => Promise<void>) => {
    const videoId = videoIdFromJobId(jobId);
    if (!videoId) return;
    work(videoId).catch((err: unknown) =>
      logger.error({ err, event, jobId }, 'could not relay a video event'),
    );
  };

  events.on('progress', ({ jobId, data }) => {
    if (typeof data !== 'number') return;
    relay('progress', jobId, (id) => onProgress(id, Math.floor(data)));
  });
  events.on('completed', ({ jobId }) => relay('completed', jobId, onCompleted));
  events.on('failed', ({ jobId }) => relay('failed', jobId, onFailed));
  events.on('error', (err) => logger.error({ err, queue: VIDEO_QUEUE }, 'queue events error'));

  return events;
};
