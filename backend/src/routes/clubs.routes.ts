import { Router } from 'express';
import * as clubController from '../controllers/club.controller.js';
import * as invitationController from '../controllers/invitation.controller.js';
import * as memberController from '../controllers/member.controller.js';
import * as videoController from '../controllers/video.controller.js';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import { requireClubRole } from '../middleware/require-club-role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  createClubSchemas,
  getClubSchemas,
  listClubsSchemas,
  updateClubSchemas,
} from '../validators/club.schema.js';
import {
  createInvitationSchemas,
  listInvitationsSchemas,
  revokeInvitationSchemas,
} from '../validators/invitation.schema.js';
import {
  leaveClubSchemas,
  listMembersSchemas,
  removeMemberSchemas,
  updateMemberSchemas,
} from '../validators/member.schema.js';
import { initiateUploadSchemas } from '../validators/video.schema.js';

export const clubsRouter = Router();

clubsRouter.use(requireAuth);

clubsRouter.post('/', validate(createClubSchemas), clubController.create);
clubsRouter.get('/', validate(listClubsSchemas), clubController.list);
clubsRouter.get(
  '/:clubId',
  validate(getClubSchemas),
  requireClubRole('viewer'),
  clubController.get,
);
clubsRouter.patch(
  '/:clubId',
  validate(updateClubSchemas),
  requireClubRole('admin'),
  clubController.update,
);

clubsRouter.post(
  '/:clubId/invitations',
  validate(createInvitationSchemas),
  requireClubRole('admin'),
  invitationController.create,
);
clubsRouter.get(
  '/:clubId/invitations',
  validate(listInvitationsSchemas),
  requireClubRole('admin'),
  invitationController.list,
);
clubsRouter.delete(
  '/:clubId/invitations/:invitationId',
  validate(revokeInvitationSchemas),
  requireClubRole('admin'),
  invitationController.revoke,
);

clubsRouter.get(
  '/:clubId/members',
  validate(listMembersSchemas),
  requireClubRole('viewer'),
  memberController.list,
);
clubsRouter.patch(
  '/:clubId/members/:userId',
  validate(updateMemberSchemas),
  requireClubRole('admin'),
  memberController.update,
);
clubsRouter.delete(
  '/:clubId/members/:userId',
  validate(removeMemberSchemas),
  requireClubRole('admin'),
  memberController.remove,
);
clubsRouter.post(
  '/:clubId/leave',
  validate(leaveClubSchemas),
  requireClubRole('viewer'),
  memberController.leave,
);

clubsRouter.post(
  '/:clubId/videos/uploads',
  validate(initiateUploadSchemas),
  requireClubRole('club_owner'),
  videoController.initiateUpload,
);
