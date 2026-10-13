import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from './client.js';

export const downloadObject = async (
  bucket: string,
  key: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<number> => {
  const { Body, ContentLength } = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { abortSignal: signal },
  );
  if (!(Body instanceof Readable)) throw new Error(`GetObject ${key} returned no stream`);

  await pipeline(Body, createWriteStream(filePath), { signal });

  const { size } = await stat(filePath);
  if (ContentLength !== undefined && size !== ContentLength) {
    throw new Error(`Downloaded ${size} of ${ContentLength} bytes for ${key}`);
  }
  return size;
};

export const uploadObject = async (
  bucket: string,
  key: string,
  filePath: string,
  contentType: string,
  signal?: AbortSignal,
): Promise<number> => {
  const { size } = await stat(filePath);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: size,
      ContentType: contentType,
    }),
    { abortSignal: signal },
  );
  return size;
};
