import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { BUCKETS, s3 } from '../lib/storage/client.js';
import { logger } from '../utils/logger.js';

const isMissing = (err: unknown) =>
  err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404;

const ensureBucket = async (bucket: string) => {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    logger.info({ bucket }, 'bucket exists');
  } catch (err) {
    if (!isMissing(err)) throw err;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    logger.info({ bucket }, 'bucket created');
  }
};

const allowBrowser = async (bucket: string, methods: string[]) => {
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: env.FRONTEND_URL,
            AllowedMethods: methods,
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  logger.info({ bucket, methods, origins: env.FRONTEND_URL }, 'cors applied');
};

try {
  for (const bucket of Object.values(BUCKETS)) await ensureBucket(bucket);
  await allowBrowser(BUCKETS.raw, ['PUT', 'GET']);
  await allowBrowser(BUCKETS.hls, ['GET']);
  logger.info('storage ready');
} catch (err) {
  logger.error({ err }, 'storage init failed');
  process.exitCode = 1;
}
