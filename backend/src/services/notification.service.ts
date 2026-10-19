import { env } from '../config/env.js';
import { enqueueEmail } from '../lib/queue/queues.js';
import * as videoRepo from '../repositories/video.repository.js';
import { logger } from '../utils/logger.js';

type VideoEmail = 'ready' | 'failed';

const oneLine = (text: string) => text.replace(/\p{Cc}+/gu, ' ').trim();

export const videoEmailJobId = (kind: VideoEmail, videoId: string) =>
  `email-video-${kind}-${videoId}`;

const queueVideoEmail = async (kind: VideoEmail, videoId: string, requestId?: string) => {
  const video = await videoRepo.findWithUploader(videoId);
  if (!video) return;

  const title = oneLine(video.title);
  const mail =
    kind === 'ready'
      ? {
          to: video.uploader.email,
          subject: `"${title}" is ready to watch`,
          text: `Your video "${title}" has finished processing and is ready to watch:\n\n${env.VIDEO_URL}/${video.id}\n`,
        }
      : {
          to: video.uploader.email,
          subject: `"${title}" could not be processed`,
          text: `We couldn't process your video "${title}".\n\nReason: ${video.errorMessage ?? 'unknown'}\n\nYou can delete it and upload the file again.\n`,
        };
  await enqueueEmail({ ...mail, requestId }, videoEmailJobId(kind, video.id));
};

const notify = (kind: VideoEmail, videoId: string, requestId?: string) =>
  queueVideoEmail(kind, videoId, requestId).catch((err: unknown) =>
    logger.error({ err, videoId, kind }, 'could not queue the video email'),
  );

export const notifyVideoReady = (videoId: string, requestId?: string) =>
  notify('ready', videoId, requestId);

export const notifyVideoFailed = (videoId: string, requestId?: string) =>
  notify('failed', videoId, requestId);
