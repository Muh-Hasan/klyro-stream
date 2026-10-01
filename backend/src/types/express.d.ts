/**
 * Type additions to Express. `req.log` and `req.id` come from pino-http's own types.
 */
import type { ClubRole } from '../lib/db/schema.js';

export type AuthUser = { id: string };
export type Membership = { clubId: string; role: ClubRole };

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth` (Sprint 2). Undefined on public routes. */
      user?: AuthUser;
    }
    interface Locals {
      /** Parsed, typed request input written by the `validate` middleware. */
      valid: { body?: unknown; query?: unknown; params?: unknown };
      membership?: Membership;
    }
  }
}
