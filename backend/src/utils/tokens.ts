import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ACCESS_TOKEN_TTL = '15m';

export const signAccessToken = (userId: string): string =>
  jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: ACCESS_TOKEN_TTL });
