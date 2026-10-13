import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../utils/errors.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const parse = (header: string | undefined) => {
  if (!header?.startsWith('Basic ')) return undefined;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon === -1) return undefined;
  return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
};

export const basicAuth = (user: string, password: string, realm: string): RequestHandler => {
  return (req, res, next) => {
    const credentials = parse(req.headers.authorization);
    const userOk = safeEqual(credentials?.user ?? '', user);
    const passwordOk = safeEqual(credentials?.password ?? '', password);
    if (credentials && userOk && passwordOk) return next();

    if (credentials) req.log.warn({ user: credentials.user }, 'basic auth failed');
    res.setHeader('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
    next(new UnauthorizedError('Invalid credentials'));
  };
};
