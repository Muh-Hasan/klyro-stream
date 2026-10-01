import type { RequestHandler } from 'express';
import type { ClubRole } from '../lib/db/schema.js';
import * as clubRepo from '../repositories/club.repository.js';
import { currentUser } from '../utils/current-user.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

const rank: Record<ClubRole, number> = { viewer: 1, club_owner: 2, admin: 3 };

export const requireClubRole =
  (min: ClubRole, param = 'clubId'): RequestHandler =>
  async (req, res, next) => {
    const clubId = req.params[param];
    if (typeof clubId !== 'string') throw new NotFoundError('Club not found', 'CLUB_NOT_FOUND');

    const role = await clubRepo.getMemberRole(clubId, currentUser(req).id);
    if (!role) throw new NotFoundError('Club not found', 'CLUB_NOT_FOUND');
    if (rank[role] < rank[min]) throw new ForbiddenError(`Requires ${min} role`);

    res.locals.membership = { clubId, role };
    next();
  };
