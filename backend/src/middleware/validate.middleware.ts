/**
 * Validate any part of a request with Zod, before the controller runs.
 *
 *   router.get('/:clubId/videos', validate(listVideosSchemas), controller.list)
 *
 * Parsed values (with defaults, coercion and transforms applied) are stored in
 * res.locals.valid, because Express 5 makes req.query read-only.
 * Controllers read them with getInput<typeof schemas>(res).
 */
import type { RequestHandler, Response } from 'express';
import { z, type ZodType } from 'zod';
import { ValidationError } from '../utils/errors.js';

export type RequestSchemas = {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
};

export type ValidatedInput<S extends RequestSchemas> = {
  [K in keyof S]: S[K] extends ZodType ? z.output<S[K]> : never;
};

const PARTS = ['params', 'query', 'body'] as const;

export const validate =
  (schemas: RequestSchemas): RequestHandler =>
  (req, res, next) => {
    const valid: Express.Locals['valid'] = {};
    const issues: Partial<Record<(typeof PARTS)[number], unknown>> = {};

    for (const part of PARTS) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) valid[part] = result.data;
      else issues[part] = z.flattenError(result.error).fieldErrors;
    }

    if (Object.keys(issues).length > 0) return next(new ValidationError(issues));
    res.locals.valid = valid;
    next();
  };

/** Typed access to what `validate` parsed. Pass the same schemas object used in the route. */
export const getInput = <S extends RequestSchemas>(res: Response): ValidatedInput<S> =>
  res.locals.valid as ValidatedInput<S>;
