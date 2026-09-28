/**
 * The last middleware. Every error in the app ends up here and leaves as:
 *   { error: { code, message, details? }, requestId }
 * Known errors (AppError) keep their status and message.
 * Unknown errors are logged with a stack and returned as a generic 500, so internals never leak.
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, ErrorCode, NotFoundError } from '../utils/errors.js';

type BodyParserError = Error & { type?: string; status?: number };

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  // Headers already sent (e.g. a stream failed half way): let Express close the connection.
  if (res.headersSent) return next(err);

  const requestId = typeof req.id === 'string' ? req.id : undefined;

  if (err instanceof AppError) {
    if (err.statusCode >= 500) req.log.error({ err }, err.message);
    else req.log.debug({ code: err.code }, err.message);
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
      requestId,
    });
    return;
  }

  // Errors thrown by express.json() before any route runs.
  const parserError = err as BodyParserError;
  if (parserError.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: ErrorCode.INVALID_JSON, message: 'Request body is not valid JSON' },
      requestId,
    });
    return;
  }
  if (parserError.type === 'entity.too.large') {
    res.status(413).json({
      error: { code: ErrorCode.PAYLOAD_TOO_LARGE, message: 'Request body is too large' },
      requestId,
    });
    return;
  }

  req.log.error({ err }, 'unhandled error');
  res.status(500).json({
    error: { code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong' },
    requestId,
  });
};
