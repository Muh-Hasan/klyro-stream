import { randomUUID } from 'node:crypto';
import { type ClubRole, type VideoStatus, videoStatusEnum } from '../lib/db/schema.js';
import { enqueueTranscode, removeTranscodeJob, type TranscodeOutput } from '../lib/queue/queues.js';
import { BUCKETS } from '../lib/storage/client.js';
import {
  abortUpload,
  completeUpload,
  deleteRawObject,
  getStoredSize,
  listUploadedParts,
  PART_URL_TTL_SECONDS,
  planParts,
  presignParts,
  startUpload,
  storageErrorName,
} from '../lib/storage/multipart.js';
import { deleteObject, deletePrefix, presignGet } from '../lib/storage/objects.js';
import * as clubRepo from '../repositories/club.repository.js';
import * as videoRepo from '../repositories/video.repository.js';
import type { Video } from '../repositories/video.repository.js';
import type { Membership } from '../types/express.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { paginated, toOffset } from '../utils/pagination.js';
import {
  type CompleteUploadInput,
  type InitiateUploadInput,
  type ListVideosInput,
  type UpdateVideoInput,
  type PresignPartsInput,
  VIDEO_TYPES,
} from '../validators/video.schema.js';

const UPLOADER_ROLES: readonly ClubRole[] = ['club_owner', 'admin'];

export const THUMBNAIL_URL_TTL_SECONDS = 600;

const thumbnailUrl = (key: string | null) =>
  key ? presignGet(BUCKETS.thumbnails, key, THUMBNAIL_URL_TTL_SECONDS) : null;

const visibleStatuses = (role: ClubRole): readonly VideoStatus[] =>
  UPLOADER_ROLES.includes(role) ? videoStatusEnum.enumValues : ['READY'];

export const listVideos = async (
  { clubId, role }: Membership,
  { page, limit, status, q }: ListVideosInput,
) => {
  const visible = visibleStatuses(role);
  const statuses = status ? visible.filter((s) => s === status) : visible;
  if (statuses.length === 0) return paginated([], 0, page, limit);

  const { items, total } = await videoRepo.listForClub(
    { clubId, statuses, search: q },
    limit,
    toOffset(page, limit),
  );
  const withThumbnails = await Promise.all(
    items.map(async ({ thumbnailPath, ...video }) => ({
      ...video,
      thumbnailUrl: await thumbnailUrl(thumbnailPath),
    })),
  );
  return paginated(withThumbnails, total, page, limit);
};

export const videoNotFound = () => new NotFoundError('Video not found', 'VIDEO_NOT_FOUND');

export const requireVisible = async <T extends Pick<Video, 'clubId' | 'status'>>(
  video: T | undefined,
  userId: string,
) => {
  if (!video) throw videoNotFound();
  const role = await clubRepo.getMemberRole(video.clubId, userId);
  if (!role || !visibleStatuses(role).includes(video.status)) throw videoNotFound();
  return { video, role };
};

const canManage = (video: Pick<Video, 'uploadedBy'>, role: ClubRole, userId: string) =>
  role === 'admin' || (video.uploadedBy === userId && UPLOADER_ROLES.includes(role));

type VideoWithUploader = Video & { uploader: { id: string; email: string } };

const toVideoResponse = async (video: VideoWithUploader) => ({
  video: {
    id: video.id,
    clubId: video.clubId,
    title: video.title,
    description: video.description,
    status: video.status,
    durationSeconds: video.durationSeconds,
    resolution: video.width && video.height ? { width: video.width, height: video.height } : null,
    sizeBytes: video.sizeBytes,
    errorMessage: video.errorMessage,
    uploader: video.uploader,
    thumbnailUrl: await thumbnailUrl(video.thumbnailPath),
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  },
});

export const getVideo = async (videoId: string, userId: string) => {
  const { video } = await requireVisible(await videoRepo.findWithUploader(videoId), userId);
  return toVideoResponse(video);
};

export const updateVideo = async (videoId: string, userId: string, input: UpdateVideoInput) => {
  const { video, role } = await requireVisible(await videoRepo.findWithUploader(videoId), userId);
  if (!canManage(video, role, userId)) {
    throw new ForbiddenError('You do not have permission to edit this video');
  }

  const updated = await videoRepo.updateDetails(videoId, input);
  if (!updated) throw videoNotFound();
  return toVideoResponse({ ...updated, uploader: video.uploader });
};

const rawPrefix = (clubId: string, videoId: string) => `clubs/${clubId}/videos/${videoId}/`;

const rawKey = (clubId: string, videoId: string, ext: string) =>
  `${rawPrefix(clubId, videoId)}original.${ext}`;

export const initiateUpload = async (
  membership: Membership,
  uploaderId: string,
  input: InitiateUploadInput,
) => {
  const videoId = randomUUID();
  const key = rawKey(membership.clubId, videoId, VIDEO_TYPES[input.contentType]);
  const { partSize, partCount } = planParts(input.sizeBytes);

  const uploadId = await startUpload(key, input.contentType);

  try {
    const video = await videoRepo.create({
      id: videoId,
      clubId: membership.clubId,
      uploadedBy: uploaderId,
      title: input.title,
      description: input.description,
      sizeBytes: input.sizeBytes,
      rawPath: key,
      uploadId,
    });
    return { videoId: video.id, status: video.status, partSize, partCount };
  } catch (err) {
    await abortUpload(key, uploadId).catch((abortErr: unknown) =>
      logger.error({ err: abortErr, key, uploadId }, 'failed to abort orphaned upload'),
    );
    throw err;
  }
};

const notInProgress = () =>
  new ConflictError('This upload is no longer in progress', 'UPLOAD_NOT_IN_PROGRESS');

const loadOwnUpload = async (videoId: string, userId: string) => {
  const video = await videoRepo.findById(videoId);
  const notFound = new NotFoundError('Upload not found', 'UPLOAD_NOT_FOUND');
  if (!video || video.uploadedBy !== userId) throw notFound;

  const role = await clubRepo.getMemberRole(video.clubId, userId);
  if (!role || !UPLOADER_ROLES.includes(role)) throw notFound;

  if (video.status !== 'UPLOADING' || !video.uploadId || !video.rawPath || !video.sizeBytes) {
    throw notInProgress();
  }
  return { ...video, uploadId: video.uploadId, rawPath: video.rawPath, sizeBytes: video.sizeBytes };
};

export const presignUploadParts = async (
  videoId: string,
  userId: string,
  input: PresignPartsInput,
) => {
  const video = await loadOwnUpload(videoId, userId);
  const { partCount } = planParts(video.sizeBytes);

  const outOfRange = input.partNumbers.filter((n) => n > partCount);
  if (outOfRange.length > 0) {
    throw new BadRequestError(`This upload has ${partCount} parts`, 'PART_OUT_OF_RANGE', {
      outOfRange,
    });
  }

  const expiresAt = new Date(Date.now() + PART_URL_TTL_SECONDS * 1000);
  const parts = await presignParts(video.rawPath, video.uploadId, input.partNumbers);
  return { expiresAt, parts };
};

export const getUploadProgress = async (videoId: string, userId: string) => {
  const video = await loadOwnUpload(videoId, userId);
  const { partSize, partCount } = planParts(video.sizeBytes);
  const uploaded = await listUploadedParts(video.rawPath, video.uploadId);

  const done = new Set(uploaded.map((p) => p.partNumber));
  const missing = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
  const uploadedBytes = uploaded.reduce((sum, p) => sum + p.size, 0);

  return { partSize, partCount, sizeBytes: video.sizeBytes, uploadedBytes, uploaded, missing };
};

const COMPLETE_ERRORS: Record<string, string> = {
  InvalidPart:
    'A part is missing in storage or its ETag does not match. Check the upload progress and retry.',
  InvalidPartOrder: 'Parts must be listed in ascending order.',
  EntityTooSmall: 'Every part except the last must be at least 5 MiB.',
};

export const completeVideoUpload = async (
  videoId: string,
  userId: string,
  input: CompleteUploadInput,
  requestId?: string,
) => {
  const { partCount } = planParts((await loadOwnUpload(videoId, userId)).sizeBytes);

  const sent = new Set(input.parts.map((p) => p.partNumber));
  const missing = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !sent.has(n));
  const unexpected = [...sent].filter((n) => n > partCount);
  if (missing.length > 0 || unexpected.length > 0) {
    throw new BadRequestError(
      `This upload needs exactly parts 1 to ${partCount}`,
      'PARTS_MISMATCH',
      {
        missing,
        unexpected,
      },
    );
  }

  const outcome = await videoRepo.withUploadLock(videoId, async (locked, tx) => {
    if (!locked.rawPath || !locked.uploadId || !locked.sizeBytes) throw notInProgress();
    try {
      await completeUpload(locked.rawPath, locked.uploadId, input.parts);
    } catch (err) {
      const name = storageErrorName(err);
      if (name === 'NoSuchUpload') throw notInProgress();
      const message = name ? COMPLETE_ERRORS[name] : undefined;
      if (message) throw new BadRequestError(message, 'UPLOAD_INCOMPLETE');
      throw err;
    }

    const declared = locked.sizeBytes;
    const actual = await getStoredSize(locked.rawPath);
    if (actual !== declared) {
      await deleteRawObject(locked.rawPath);
      const video = await videoRepo.transition(
        videoId,
        'UPLOADING',
        'ERROR',
        {
          uploadId: null,
          errorMessage: `Uploaded ${actual} bytes but ${declared} were declared`,
        },
        tx,
      );
      return { video, sizeMismatch: { declared, actual } };
    }

    const video = await videoRepo.transition(
      videoId,
      'UPLOADING',
      'PROCESSING',
      { uploadId: null },
      tx,
    );
    return { video };
  });
  if (!outcome?.video) throw notInProgress();

  if (outcome.sizeMismatch) {
    throw new BadRequestError(
      'The uploaded file does not match the declared size',
      'SIZE_MISMATCH',
      outcome.sizeMismatch,
    );
  }

  await enqueueTranscode(videoId, requestId).catch((err: unknown) =>
    logger.error({ err, videoId }, 'failed to enqueue transcode'),
  );
  return { videoId: outcome.video.id, status: outcome.video.status };
};

const abortLockedUpload = (videoId: string, errorMessage: string) =>
  videoRepo.withUploadLock(videoId, async (locked, tx) => {
    if (locked.rawPath && locked.uploadId) {
      await abortUpload(locked.rawPath, locked.uploadId).catch((err: unknown) => {
        if (storageErrorName(err) !== 'NoSuchUpload') throw err;
      });
    }
    return videoRepo.transition(
      videoId,
      'UPLOADING',
      'ERROR',
      { uploadId: null, errorMessage },
      tx,
    );
  });

export const abortVideoUpload = async (videoId: string, userId: string): Promise<void> => {
  await loadOwnUpload(videoId, userId);
  const video = await abortLockedUpload(videoId, 'Upload aborted by the uploader');
  if (!video) throw notInProgress();
};

export const expireUpload = (videoId: string, errorMessage: string) =>
  abortLockedUpload(videoId, errorMessage);

export const outputKeys = (videoId: string) => ({
  hlsPrefix: `${videoId}/`,
  hlsPath: `${videoId}/master.m3u8`,
  thumbnailPath: `${videoId}.jpg`,
});

export const markVideoReady = (videoId: string, output: TranscodeOutput) =>
  videoRepo.transition(videoId, 'PROCESSING', 'READY', output);

export const markVideoFailed = (videoId: string, errorMessage: string) =>
  videoRepo.transition(videoId, 'PROCESSING', 'ERROR', { errorMessage });

export const deleteVideoOutputs = async (videoId: string) => {
  const keys = outputKeys(videoId);
  const [segments] = await Promise.all([
    deletePrefix(BUCKETS.hls, keys.hlsPrefix),
    deleteObject(BUCKETS.thumbnails, keys.thumbnailPath),
  ]);
  return segments;
};

export const deleteVideo = async (videoId: string, userId: string) => {
  const { video, role } = await requireVisible(await videoRepo.findById(videoId), userId);
  if (!canManage(video, role, userId)) {
    throw new ForbiddenError('You do not have permission to delete this video');
  }

  if (video.status === 'UPLOADING') await abortLockedUpload(videoId, 'Video deleted');

  if (!(await removeTranscodeJob(videoId))) {
    throw new ConflictError(
      'This video is being processed. Try again when processing finishes.',
      'VIDEO_PROCESSING',
    );
  }

  const [raw, outputs] = await Promise.all([
    deletePrefix(BUCKETS.raw, rawPrefix(video.clubId, videoId)),
    deleteVideoOutputs(videoId),
  ]);
  if (!(await videoRepo.remove(videoId))) throw videoNotFound();
  logger.info(
    { videoId, status: video.status, rawObjects: raw, hlsObjects: outputs },
    'video deleted',
  );
};
