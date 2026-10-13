import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { uploadObject } from '../../lib/storage/objects.js';

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.jpg': 'image/jpeg',
};

const UPLOAD_CONCURRENCY = 4;

export const contentTypeFor = (filePath: string) => {
  const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
  if (!type) throw new Error(`No content type for ${path.basename(filePath)}`);
  return type;
};

export const uploadFile = (filePath: string, bucket: string, key: string, signal?: AbortSignal) =>
  uploadObject(bucket, key, filePath, contentTypeFor(filePath), signal);

export const uploadDir = async (
  dir: string,
  bucket: string,
  prefix: string,
  signal?: AbortSignal,
) => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
  files.forEach(contentTypeFor);

  let next = 0;
  let bytes = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < files.length) {
      const file = files[next++]!;
      const key = `${prefix}${path.relative(dir, file).split(path.sep).join('/')}`;
      try {
        const size = await uploadFile(file, bucket, key, signal);
        bytes += size;
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));

  return { files: files.length, bytes };
};
