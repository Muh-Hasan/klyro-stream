import type { RequestHandler } from 'express';
import { getInput } from '../middleware/validate.middleware.js';
import * as invitationService from '../services/invitation.service.js';
import { setRefreshCookie } from '../utils/cookies.js';
import { currentMembership } from '../utils/current-membership.js';
import { currentUser } from '../utils/current-user.js';
import type {
  createInvitationSchemas,
  invitationTokenSchemas,
  listInvitationsSchemas,
  registerFromInvitationSchemas,
  revokeInvitationSchemas,
} from '../validators/invitation.schema.js';

export const create: RequestHandler = async (req, res) => {
  const { body } = getInput<typeof createInvitationSchemas>(res);
  const result = await invitationService.inviteMember(
    currentMembership(res),
    currentUser(req).id,
    body,
  );
  res.status(201).json(result);
};

export const list: RequestHandler = async (_req, res) => {
  const { query } = getInput<typeof listInvitationsSchemas>(res);
  const result = await invitationService.listInvitations(currentMembership(res), query);
  res.json(result);
};

export const revoke: RequestHandler = async (_req, res) => {
  const { params } = getInput<typeof revokeInvitationSchemas>(res);
  await invitationService.revokeInvitation(currentMembership(res), params.invitationId);
  res.status(204).end();
};

export const preview: RequestHandler = async (_req, res) => {
  const { body } = getInput<typeof invitationTokenSchemas>(res);
  const result = await invitationService.previewInvitation(body);
  res.json(result);
};

export const accept: RequestHandler = async (req, res) => {
  const { body } = getInput<typeof invitationTokenSchemas>(res);
  const result = await invitationService.acceptInvitation(currentUser(req).id, body);
  res.json(result);
};

export const register: RequestHandler = async (_req, res) => {
  const { body } = getInput<typeof registerFromInvitationSchemas>(res);
  const { refreshToken, ...result } = await invitationService.registerFromInvitation(body);
  setRefreshCookie(res, refreshToken);
  res.status(201).json(result);
};

export const reject: RequestHandler = async (_req, res) => {
  const { body } = getInput<typeof invitationTokenSchemas>(res);
  await invitationService.rejectInvitation(body);
  res.status(204).end();
};
