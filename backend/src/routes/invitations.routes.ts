import { Router } from 'express';
import * as invitationController from '../controllers/invitation.controller.js';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  invitationTokenSchemas,
  registerFromInvitationSchemas,
} from '../validators/invitation.schema.js';

export const invitationsRouter = Router();

invitationsRouter.post('/preview', validate(invitationTokenSchemas), invitationController.preview);
invitationsRouter.post(
  '/accept',
  requireAuth,
  validate(invitationTokenSchemas),
  invitationController.accept,
);
invitationsRouter.post(
  '/register',
  validate(registerFromInvitationSchemas),
  invitationController.register,
);
invitationsRouter.post('/reject', validate(invitationTokenSchemas), invitationController.reject);
