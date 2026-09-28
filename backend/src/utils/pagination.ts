/**
 * The one list-response shape used by every list endpoint:
 * { items, page, limit, total, totalPages }
 */
export type Paginated<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export const toOffset = (page: number, limit: number) => (page - 1) * limit;

export const paginated = <T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> => ({
  items,
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});
