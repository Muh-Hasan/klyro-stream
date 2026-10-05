import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BUCKETS, s3, s3Public } from './client.js';

const MiB = 1024 * 1024;
const MIN_PART_SIZE = 8 * MiB;
const MAX_PARTS = 10_000;

export const planParts = (size: number) => {
  const partSize = Math.max(MIN_PART_SIZE, Math.ceil(size / MAX_PARTS));
  return { partSize, partCount: Math.ceil(size / partSize) };
};

export const startUpload = async (key: string, contentType: string): Promise<string> => {
  const { UploadId } = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKETS.raw, Key: key, ContentType: contentType }),
  );
  if (!UploadId) throw new Error('CreateMultipartUpload returned no UploadId');
  return UploadId;
};

export const abortUpload = async (key: string, uploadId: string): Promise<void> => {
  await s3.send(
    new AbortMultipartUploadCommand({ Bucket: BUCKETS.raw, Key: key, UploadId: uploadId }),
  );
};

export const PART_URL_TTL_SECONDS = 3600;

export const presignParts = (key: string, uploadId: string, partNumbers: number[]) =>
  Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await getSignedUrl(
        s3Public,
        new UploadPartCommand({
          Bucket: BUCKETS.raw,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: PART_URL_TTL_SECONDS },
      ),
    })),
  );

export type UploadedPart = { partNumber: number; etag: string; size: number };

export const listUploadedParts = async (key: string, uploadId: string): Promise<UploadedPart[]> => {
  const parts: UploadedPart[] = [];
  let marker: string | undefined;
  do {
    const page = await s3.send(
      new ListPartsCommand({
        Bucket: BUCKETS.raw,
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: marker,
      }),
    );
    for (const p of page.Parts ?? []) {
      if (p.PartNumber && p.ETag) {
        parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size ?? 0 });
      }
    }
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);
  return parts;
};

export const storageErrorName = (err: unknown): string | undefined =>
  err instanceof S3ServiceException ? err.name : undefined;

export const quoteEtag = (etag: string) => `"${etag.replaceAll('"', '')}"`;

export const completeUpload = async (
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> => {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKETS.raw,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sorted.map((p) => ({ PartNumber: p.partNumber, ETag: quoteEtag(p.etag) })),
      },
    }),
  );
};

export const getStoredSize = async (key: string): Promise<number> => {
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKETS.raw, Key: key }));
  return head.ContentLength ?? 0;
};

export const deleteRawObject = async (key: string): Promise<void> => {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKETS.raw, Key: key }));
};
