/**
 * One log line per request, with a request id that:
 * - reuses an incoming X-Request-Id (from a proxy or the frontend) or makes a new UUID,
 * - is echoed back in the X-Request-Id response header and in every error body,
 * - is available as req.id and on req.log (a child logger) for the rest of the request.
 */
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from '../utils/logger.js';

const HEADER = 'x-request-id';
const QUIET_PATHS = new Set(['/health']);
const NO_QUERY_PATHS = new Set(['/auth/google/callback']);

const pathOf = (url: string | undefined) => url?.split('?')[0] ?? '';

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers[HEADER];
    const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  autoLogging: {
    ignore: (req) =>
      QUIET_PATHS.has(pathOf(req.url)) ||
      (req.method === 'GET' && pathOf(req.url).startsWith('/admin/queues')),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Keep request logs small: method, url, status, duration and id are enough.
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: NO_QUERY_PATHS.has(pathOf(req.url)) ? pathOf(req.url) : req.url,
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
});
