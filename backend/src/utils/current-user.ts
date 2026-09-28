import type { Request } from 'express';
import type { AuthUser } from '../types/express.js';
import { UnauthorizedError } from './errors.js';

/**
 * The signed-in user on a route guarded by `requireAuth`.
 * Use this instead of `req.user!`: if a route forgets the guard, you get a clean 401, not a crash.
 */
export const currentUser = (req: Request): AuthUser => {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
};
