import path from 'node:path';
import { BUCKETS } from '../lib/storage/client.js';
import { getStoredSize, storageErrorName } from '../lib/storage/multipart.js';
import { presignGet } from '../lib/storage/objects.js';
import * as downloadRepo from '../repositories/download.repository.js';
import * as videoRepo from '../repositories/video.repository.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { toQuota } from './quota.service.js';
import { requireVisible } from './video.service.js';

export const DOWNLOAD_URL_TTL_SECONDS = 300;

const MAX_FILENAME_LENGTH = 100;

export const downloadFilename = (title: string, rawPath: string) => {
  const base = title
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, MAX_FILENAME_LENGTH)
    .trim();
  return `${base || 'video'}${path.extname(rawPath)}`;
};

const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const attachment = (filename: string) => {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
};

const storedSize = async (key: string) => {
  try {
    return await getStoredSize(key);
  } catch (err) {
    if (storageErrorName(err) === 'NotFound') {
      throw new NotFoundError('The original file for this video is missing', 'VIDEO_FILE_MISSING');
    }
    throw err;
  }
};

export const createDownload = async (videoId: string, userId: string) => {
  const { video } = await requireVisible(await videoRepo.findById(videoId), userId);
  if (video.status !== 'READY' || !video.rawPath) {
    throw new ConflictError('This video is not ready to download yet', 'VIDEO_NOT_READY');
  }
  const sizeBytes = await storedSize(video.rawPath);

  const quota = await downloadRepo.consumeQuotaAndLog({
    clubId: video.clubId,
    videoId: video.id,
    userId,
  });
  if (!quota) throw new ForbiddenError('This club has used its download quota', 'QUOTA_EXCEEDED');

  const filename = downloadFilename(video.title, video.rawPath);
  const url = await presignGet(
    BUCKETS.raw,
    video.rawPath,
    DOWNLOAD_URL_TTL_SECONDS,
    attachment(filename),
  );
  return {
    download: {
      url,
      filename,
      sizeBytes,
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    },
    quota: toQuota(quota),
  };
};
