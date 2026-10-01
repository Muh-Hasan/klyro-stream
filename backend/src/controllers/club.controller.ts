import type { RequestHandler } from 'express';
import { getInput } from '../middleware/validate.middleware.js';
import * as clubService from '../services/club.service.js';
import { currentMembership } from '../utils/current-membership.js';
import { currentUser } from '../utils/current-user.js';
import type {
  createClubSchemas,
  listClubsSchemas,
  updateClubSchemas,
} from '../validators/club.schema.js';

export const create: RequestHandler = async (req, res) => {
  const { body } = getInput<typeof createClubSchemas>(res);
  const result = await clubService.createClub(currentUser(req).id, body);
  res.status(201).json(result);
};

export const list: RequestHandler = async (req, res) => {
  const { query } = getInput<typeof listClubsSchemas>(res);
  const result = await clubService.listMyClubs(currentUser(req).id, query);
  res.json(result);
};

export const get: RequestHandler = async (_req, res) => {
  const result = await clubService.getClub(currentMembership(res));
  res.json(result);
};

export const update: RequestHandler = async (_req, res) => {
  const { body } = getInput<typeof updateClubSchemas>(res);
  const result = await clubService.updateClub(currentMembership(res), body);
  res.json(result);
};
