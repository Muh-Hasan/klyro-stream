import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { StateStore } from 'passport-oauth2';
import { env } from '../config/env.js';

const COOKIE = 'oauth_state';
const TTL_MS = 10 * 60 * 1000;

const cookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax' as const,
  path: '/auth/google',
};

const sameValue = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type StoreCallback = (err: Error | null, handle?: string) => void;
type VerifyCallback = (err: Error | null, verifier: string | false, info?: unknown) => void;

const store = {
  store(req: Request, verifier: string, _state: unknown, _meta: unknown, callback: StoreCallback) {
    const handle = randomBytes(24).toString('base64url');
    req.res?.cookie(COOKIE, `${handle}.${verifier}`, { ...cookieOptions, maxAge: TTL_MS });
    callback(null, handle);
  },

  verify(req: Request, providedState: unknown, callback: VerifyCallback) {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[COOKIE];
    req.res?.clearCookie(COOKIE, cookieOptions);

    if (typeof value !== 'string' || typeof providedState !== 'string')
      return callback(null, false, { message: 'Missing authorization request state' });

    const [handle, verifier] = value.split('.');
    if (!handle || !verifier || !sameValue(handle, providedState))
      return callback(null, false, { message: 'Invalid authorization request state' });

    callback(null, verifier);
  },
};

export const oauthStateStore = store as unknown as StateStore;
