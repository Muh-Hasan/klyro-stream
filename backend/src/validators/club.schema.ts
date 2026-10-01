import { z } from 'zod';
import { userRoleEnum } from '../lib/db/schema.js';
import { paginationQuery } from './common.schema.js';

export const clubParams = z.object({
  clubId: z.uuid({ error: 'The club id must be a valid UUID.' }),
});

export const clubRole = z.enum(userRoleEnum.enumValues, {
  error: `The role must be one of: ${userRoleEnum.enumValues.join(', ')}.`,
});

const name = z
  .string({
    error: (issue) =>
      issue.input === undefined ? 'The name is required.' : 'The name must be a string.',
  })
  .trim()
  .min(1, 'The name is required.')
  .max(120, 'The name must be at most 120 characters.');

export const createClubSchemas = {
  body: z.object({ name }),
};

export const listClubsSchemas = {
  query: paginationQuery,
};

export const getClubSchemas = {
  params: clubParams,
};

export const updateClubSchemas = {
  params: clubParams,
  body: z.object({ name }),
};

export type CreateClubInput = z.output<typeof createClubSchemas.body>;
export type UpdateClubInput = z.output<typeof updateClubSchemas.body>;
export type ListClubsInput = z.output<typeof listClubsSchemas.query>;
