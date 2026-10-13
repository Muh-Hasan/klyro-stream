import { UnrecoverableError } from 'bullmq';
import { BUCKETS } from '../../lib/storage/client.js';
import { storageErrorName } from '../../lib/storage/multipart.js';
import { downloadObject } from '../../lib/storage/objects.js';

export const downloadSource = async (rawPath: string, filePath: string, signal?: AbortSignal) => {
  try {
    return await downloadObject(BUCKETS.raw, rawPath, filePath, signal);
  } catch (err) {
    if (storageErrorName(err) === 'NoSuchKey') {
      throw new UnrecoverableError(`Source object ${rawPath} does not exist`);
    }
    throw err;
  }
};
