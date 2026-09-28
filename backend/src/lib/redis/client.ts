/**
 * Shared Redis connection for caching, token blacklists and rate limits.
 * BullMQ gets its OWN connection later (Sprint 5) because it needs `maxRetriesPerRequest: null`.
 */
import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true, // connect on the first command, not at import time (keeps scripts clean)
  maxRetriesPerRequest: 3,
  enableOfflineQueue: true,
});

redis.on('ready', () => logger.info('redis connected'));
redis.on('error', (err) => logger.error({ err }, 'redis error'));

export const closeRedis = async () => {
  if (redis.status === 'end' || redis.status === 'wait') return;
  await redis.quit();
};
