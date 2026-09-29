import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/tokens.js';

export const requireAuth: RequestHandler = (req, _res, next) => {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) throw new UnauthorizedError();

  try {
    req.user = { id: verifyAccessToken(token) };
  } catch {
    throw new UnauthorizedError('Invalid or expired access token', 'INVALID_TOKEN');
  }
  next();
};
