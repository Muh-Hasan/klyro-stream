import { z } from 'zod';
import { clubParams, clubRole } from './club.schema.js';
import { paginationQuery } from './common.schema.js';

const memberParams = clubParams.extend({
  userId: z.uuid({ error: 'The user id must be a valid UUID.' }),
});

export const listMembersSchemas = {
  params: clubParams,
  query: paginationQuery,
};

export const updateMemberSchemas = {
  params: memberParams,
  body: z.object({ role: clubRole }),
};

export const removeMemberSchemas = {
  params: memberParams,
};

export const leaveClubSchemas = {
  params: clubParams,
};

export type ListMembersInput = z.output<typeof listMembersSchemas.query>;
export type UpdateMemberInput = z.output<typeof updateMemberSchemas.body>;
