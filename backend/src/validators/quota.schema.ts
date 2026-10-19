import { z } from 'zod';
import { clubParams } from './club.schema.js';

export const MAX_QUOTA_LIMIT = 1_000_000;

export const getQuotaSchemas = {
  params: clubParams,
};

export const setQuotaLimitSchemas = {
  params: clubParams,
  body: z.object({
    limit: z
      .number({
        error: (issue) =>
          issue.input === undefined ? 'The limit is required.' : 'The limit must be a number.',
      })
      .int('The limit must be a whole number.')
      .min(0, 'The limit cannot be negative.')
      .max(MAX_QUOTA_LIMIT, `The limit must be at most ${MAX_QUOTA_LIMIT}.`),
  }),
};

export type SetQuotaLimitInput = z.output<typeof setQuotaLimitSchemas.body>;
