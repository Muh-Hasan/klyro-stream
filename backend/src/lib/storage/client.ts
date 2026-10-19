import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { env } from '../../config/env.js';

export const BUCKETS = {
  raw: 'raw-uploads',
  hls: 'hls-output',
  thumbnails: 'thumbnails',
} as const;

const base: S3ClientConfig = {
  region: env.S3_REGION,
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  requestHandler: { connectionTimeout: 3_000, requestTimeout: 30_000 },
};

export const s3 = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });

export const s3Public = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT });
