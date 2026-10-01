import { Router } from 'express';
import * as clubController from '../controllers/club.controller.js';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  createClubSchemas,
  getClubSchemas,
  listClubsSchemas,
  updateClubSchemas,
} from '../validators/club.schema.js';

export const clubsRouter = Router();

clubsRouter.use(requireAuth);

clubsRouter.post('/', validate(createClubSchemas), clubController.create);
clubsRouter.get('/', validate(listClubsSchemas), clubController.list);
clubsRouter.get('/:clubId', validate(getClubSchemas), clubController.get);
clubsRouter.patch('/:clubId', validate(updateClubSchemas), clubController.update);
