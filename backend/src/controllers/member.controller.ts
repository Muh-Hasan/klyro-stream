import type { RequestHandler } from 'express';
import { getInput } from '../middleware/validate.middleware.js';
import * as memberService from '../services/member.service.js';
import { currentMembership } from '../utils/current-membership.js';
import { currentUser } from '../utils/current-user.js';
import type {
  listMembersSchemas,
  removeMemberSchemas,
  updateMemberSchemas,
} from '../validators/member.schema.js';

export const list: RequestHandler = async (_req, res) => {
  const { query } = getInput<typeof listMembersSchemas>(res);
  const result = await memberService.listMembers(currentMembership(res), query);
  res.json(result);
};

export const update: RequestHandler = async (_req, res) => {
  const { params, body } = getInput<typeof updateMemberSchemas>(res);
  const result = await memberService.changeMemberRole(currentMembership(res), params.userId, body);
  res.json(result);
};

export const remove: RequestHandler = async (_req, res) => {
  const { params } = getInput<typeof removeMemberSchemas>(res);
  await memberService.removeMember(currentMembership(res), params.userId);
  res.status(204).end();
};

export const leave: RequestHandler = async (req, res) => {
  await memberService.leaveClub(currentMembership(res), currentUser(req).id);
  res.status(204).end();
};
