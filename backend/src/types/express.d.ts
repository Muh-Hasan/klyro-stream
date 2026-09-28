/**
 * Type additions to Express. `req.log` and `req.id` come from pino-http's own types.
 */
export type AuthUser = { id: string };

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth` (Sprint 2). Undefined on public routes. */
      user?: AuthUser;
    }
    interface Locals {
      /** Parsed, typed request input written by the `validate` middleware. */
      valid: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}
