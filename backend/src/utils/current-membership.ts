import type { Response } from 'express';
import type { Membership } from '../types/express.js';

export const currentMembership = (res: Response): Membership => {
  if (!res.locals.membership) throw new Error('requireClubRole must run before this handler');
  return res.locals.membership;
};
