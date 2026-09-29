import { randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env.js';

const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;
export type RefreshPayload = { userId: string; jti: string; exp: number; ver: number };

export const signAccessToken = (userId: string): string =>
  jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: ACCESS_TOKEN_TTL });

export const signRefreshToken = (userId: string, tokenVersion: number): string =>
  jwt.sign({ ver: tokenVersion }, env.JWT_REFRESH_SECRET, {
    subject: userId,
    expiresIn: REFRESH_TOKEN_TTL,
    jwtid: randomUUID(),
  });

type VerifiedPayload = JwtPayload & { sub: string };

const verify = (token: string, secret: string): VerifiedPayload => {
  const payload = jwt.verify(token, secret);
  if (typeof payload === 'string' || !payload.sub) throw new Error('Malformed token');
  return payload as VerifiedPayload;
};

export const verifyAccessToken = (token: string): string =>
  verify(token, env.JWT_ACCESS_SECRET).sub;

export const verifyRefreshToken = (token: string): RefreshPayload => {
  const { sub, jti, exp, ver: rawVer } = verify(token, env.JWT_REFRESH_SECRET);
  const ver: unknown = rawVer;
  if (!jti || !exp || typeof ver !== 'number') throw new Error('Malformed token');
  return { userId: sub, jti, exp, ver };
};
