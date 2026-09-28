/**
 * Reusable schema pieces. Feature validators compose these instead of redefining them.
 */
import { z } from 'zod';

/** For routes like /videos/:id */
export const idParams = z.object({ id: z.uuid() });

/** ?page=2&limit=20  (strings from the URL are coerced to numbers) */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Trimmed, non-empty text with a max length. */
export const text = (max: number) => z.string().trim().min(1).max(max);
