import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
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

export const deleteObject = async (bucket: string, key: string): Promise<void> => {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};

export const deletePrefix = async (bucket: string, prefix: string): Promise<number> => {
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    const objects = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
    if (objects.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }),
      );
      deleted += objects.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
};
