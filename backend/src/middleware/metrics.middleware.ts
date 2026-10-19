import type { Request, RequestHandler } from 'express';
import { Counter, Histogram } from 'prom-client';
import { registry } from '../lib/metrics/registry.js';

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests by method, route pattern and status code',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration by method and route pattern',
  labelNames: ['method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const segments = (path: string) => path.split('/').filter(Boolean);

const routeOf = (req: Request) => {
  const path: unknown = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string') return 'unmatched';
  const pattern = segments(path);
  const url = segments(req.originalUrl.split('?')[0] ?? '');
  const mount = url.slice(0, Math.max(0, url.length - pattern.length));
  return `/${[...mount, ...pattern].join('/')}`;
};

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const end = httpDuration.startTimer();
  res.once('close', () => {
    const route = routeOf(req);
    httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
    end({ method: req.method, route });
  });
  next();
};
