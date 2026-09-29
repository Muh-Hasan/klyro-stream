import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;

export const signAccessToken = (userId: string): string =>
  jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: ACCESS_TOKEN_TTL });

export const signRefreshToken = (userId: string): string =>
  jwt.sign({}, env.JWT_REFRESH_SECRET, { subject: userId, expiresIn: REFRESH_TOKEN_TTL });

const verify = (token: string, secret: string): string => {
  const payload = jwt.verify(token, secret);
  if (typeof payload === 'string' || !payload.sub) throw new Error('Malformed token');
  return payload.sub;
};

export const verifyAccessToken = (token: string): string => verify(token, env.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token: string): string => verify(token, env.JWT_REFRESH_SECRET);
