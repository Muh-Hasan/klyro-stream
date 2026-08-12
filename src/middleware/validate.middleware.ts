import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

type RequestPart = 'body' | 'query' | 'params';

export const validate =
  (schema: ZodSchema, part: RequestPart = 'body') =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: z.treeifyError(result.error),
        },
      });
    }
    req[part] = result.data;
    next();
  };
