import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';
import { REFRESH_TOKEN_TTL } from './tokens.js';

const REFRESH_COOKIE = 'rt';

const options: CookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax',
  path: '/auth',
};

export const setRefreshCookie = (res: Response, token: string) =>
  res.cookie(REFRESH_COOKIE, token, { ...options, maxAge: REFRESH_TOKEN_TTL * 1000 });

export const clearRefreshCookie = (res: Response) => res.clearCookie(REFRESH_COOKIE, options);

export const getRefreshCookie = (req: Request): string | undefined => {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const token = cookies?.[REFRESH_COOKIE];
  return typeof token === 'string' ? token : undefined;
};
