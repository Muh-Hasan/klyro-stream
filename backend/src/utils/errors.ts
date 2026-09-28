/**
 * Every expected failure is thrown as an AppError subclass.
 * The error middleware turns it into: { error: { code, message, details? } }
 *
 * Rule: services and repositories throw these; controllers never build error responses by hand.
 */

export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_JSON: 'INVALID_JSON',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

// Feature-specific codes (e.g. 'QUOTA_EXCEEDED') are allowed too; they are just strings.
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode] | (string & {});

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCodeValue,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(
    message = 'Bad request',
    code: ErrorCodeValue = ErrorCode.BAD_REQUEST,
    details?: unknown,
  ) {
    super(400, code, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Invalid request') {
    super(400, ErrorCode.VALIDATION_ERROR, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code: ErrorCodeValue = ErrorCode.UNAUTHORIZED) {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have permission to do this',
    code: ErrorCodeValue = ErrorCode.FORBIDDEN,
  ) {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code: ErrorCodeValue = ErrorCode.NOT_FOUND) {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', code: ErrorCodeValue = ErrorCode.CONFLICT) {
    super(409, code, message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, try again later') {
    super(429, ErrorCode.RATE_LIMITED, message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(503, ErrorCode.SERVICE_UNAVAILABLE, message);
  }
}
