import { z } from 'zod';
import { email, newPassword, token } from './auth.schema.js';
import { clubParams, clubRole } from './club.schema.js';
import { paginationQuery } from './common.schema.js';

export const createInvitationSchemas = {
  params: clubParams,
  body: z.object({
    email,
    role: clubRole,
  }),
};

export const listInvitationsSchemas = {
  params: clubParams,
  query: paginationQuery,
};

export const revokeInvitationSchemas = {
  params: clubParams.extend({
    invitationId: z.uuid({ error: 'The invitation id must be a valid UUID.' }),
  }),
};

export const invitationTokenSchemas = {
  body: z.object({ token }),
};

export const registerFromInvitationSchemas = {
  body: z.object({ token, password: newPassword }),
};

export type CreateInvitationInput = z.output<typeof createInvitationSchemas.body>;
export type ListInvitationsInput = z.output<typeof listInvitationsSchemas.query>;
export type InvitationTokenInput = z.output<typeof invitationTokenSchemas.body>;
export type RegisterFromInvitationInput = z.output<typeof registerFromInvitationSchemas.body>;
