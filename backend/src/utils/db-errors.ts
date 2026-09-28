/**
 * Postgres error codes you will actually handle.
 * Drizzle may wrap the driver error, so check both the error and its `cause`.
 * Full list: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PgCode = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
} as const;

const pgCodeOf = (err: unknown): string | undefined => {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
};

/** Two requests raced past a "does it exist?" check. Map to 409. */
export const isUniqueViolation = (err: unknown) => pgCodeOf(err) === PgCode.UNIQUE_VIOLATION;

/** Referenced row doesn't exist (or is still referenced on delete). Usually 404 or 409. */
export const isForeignKeyViolation = (err: unknown) =>
  pgCodeOf(err) === PgCode.FOREIGN_KEY_VIOLATION;

export const isCheckViolation = (err: unknown) => pgCodeOf(err) === PgCode.CHECK_VIOLATION;
