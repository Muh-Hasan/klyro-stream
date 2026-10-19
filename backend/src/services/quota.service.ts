import type { DownloadQuota } from '../lib/db/schema.js';
import * as downloadRepo from '../repositories/download.repository.js';
import { NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const toQuota = ({ limit, used }: { limit: number; used: number }) => ({
  limit,
  used,
  remaining: Math.max(0, limit - used),
});

const toQuotaResponse = (quota: DownloadQuota) => ({
  quota: {
    ...toQuota({ limit: quota.quotaLimit, used: quota.usedCount }),
    updatedAt: quota.updatedAt,
  },
});

const clubNotFound = () => new NotFoundError('Club not found', 'CLUB_NOT_FOUND');

export const getQuota = async (clubId: string) => {
  const quota = await downloadRepo.findQuota(clubId);
  if (!quota) throw clubNotFound();
  return toQuotaResponse(quota);
};

export const setQuotaLimit = async (clubId: string, limit: number) => {
  const quota = await downloadRepo.setQuotaLimit(clubId, limit);
  if (!quota) throw clubNotFound();
  logger.info({ clubId, limit, used: quota.usedCount }, 'download quota limit changed');
  return toQuotaResponse(quota);
};
