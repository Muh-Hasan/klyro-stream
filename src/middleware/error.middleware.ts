import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
  }
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  });
};