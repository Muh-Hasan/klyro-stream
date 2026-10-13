import path from 'node:path';
import { runFfmpeg } from './transcode.js';

const THUMBNAIL_BOX = 640;
const THUMBNAIL_AT_SECONDS = 5;
const SHORT_CLIP_SECONDS = 10;

export const thumbnailTime = (durationSeconds: number) =>
  durationSeconds > SHORT_CLIP_SECONDS ? THUMBNAIL_AT_SECONDS : durationSeconds * 0.1;

export const makeThumbnail = async (
  source: string,
  outFile: string,
  durationSeconds: number,
  signal?: AbortSignal,
) => {
  const at = thumbnailTime(durationSeconds);
  const fit = `scale='min(${THUMBNAIL_BOX},iw)':'min(${THUMBNAIL_BOX},ih)':force_original_aspect_ratio=decrease`;
  await runFfmpeg(
    [
      '-y',
      '-ss',
      at.toFixed(3),
      '-i',
      source,
      '-frames:v',
      '1',
      '-vf',
      fit,
      '-q:v',
      '3',
      path.basename(outFile),
    ],
    { cwd: path.dirname(outFile), durationSeconds, signal },
  );
  return at;
};
