import type { RequestHandler } from 'express';
import { getInput } from '../middleware/validate.middleware.js';
import * as quotaService from '../services/quota.service.js';
import { currentMembership } from '../utils/current-membership.js';
import type { setQuotaLimitSchemas } from '../validators/quota.schema.js';

export const get: RequestHandler = async (_req, res) => {
  const result = await quotaService.getQuota(currentMembership(res).clubId);
  res.json(result);
};

export const setLimit: RequestHandler = async (_req, res) => {
  const { params, body } = getInput<typeof setQuotaLimitSchemas>(res);
  const result = await quotaService.setQuotaLimit(params.clubId, body.limit);
  res.json(result);
};
