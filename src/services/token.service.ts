import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessTokenPayload {
  userId: string;
}

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, {expiresIn: env.JWT_ACCESS_TTL});

export const verifyAccessToken = (token: string): AccessTokenPayload =>
  jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
