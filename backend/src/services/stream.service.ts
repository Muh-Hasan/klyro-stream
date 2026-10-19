import { env } from '../config/env.js';
import { BUCKETS } from '../lib/storage/client.js';
import { storageErrorName } from '../lib/storage/multipart.js';
import { presignGet, readText } from '../lib/storage/objects.js';
import * as videoRepo from '../repositories/video.repository.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import { requireVisible } from './video.service.js';

const VARIANT_LINE = /^(\d{3,4}p)\/index\.m3u8$/;
const SEGMENT_LINE = /^[\w-]+\.ts$/;

const requirePlayable = async (videoId: string, userId: string) => {
  const { video } = await requireVisible(await videoRepo.findById(videoId), userId);
  if (video.status !== 'READY' || !video.hlsPath) {
    throw new ConflictError('This video is not ready to play yet', 'VIDEO_NOT_READY');
  }
  return video;
};

const readPlaylist = async (key: string) => {
  try {
    return await readText(BUCKETS.hls, key);
  } catch (err) {
    if (storageErrorName(err) === 'NoSuchKey') {
      throw new NotFoundError('This rendition does not exist', 'RENDITION_NOT_FOUND');
    }
    throw err;
  }
};

const lines = (text: string) => text.split(/\r?\n/);

const isUri = (line: string) => line !== '' && !line.startsWith('#');

const unexpected = (line: string) => new Error(`Unexpected URI in playlist: ${line}`);

const variantRoute = (line: string) => {
  const variant = VARIANT_LINE.exec(line)?.[1];
  if (!variant) throw unexpected(line);
  return `${variant}.m3u8`;
};

const signSegment = (videoId: string, rendition: string, line: string) => {
  if (!SEGMENT_LINE.test(line)) throw unexpected(line);
  return presignGet(BUCKETS.hls, `${videoId}/${rendition}/${line}`, env.STREAM_URL_TTL_SECONDS);
};

export const masterPlaylist = async (videoId: string, userId: string) => {
  const video = await requirePlayable(videoId, userId);
  const text = await readPlaylist(`${video.id}/master.m3u8`);
  return lines(text)
    .map((line) => (isUri(line) ? variantRoute(line) : line))
    .join('\n');
};

export const variantPlaylist = async (videoId: string, rendition: string, userId: string) => {
  const video = await requirePlayable(videoId, userId);
  const text = await readPlaylist(`${video.id}/${rendition}/index.m3u8`);
  const signed = await Promise.all(
    lines(text).map((line) =>
      isUri(line) ? signSegment(video.id, rendition, line) : Promise.resolve(line),
    ),
  );
  return signed.join('\n');
};
