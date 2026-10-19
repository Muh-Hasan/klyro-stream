/**
 * One logger for the whole process.
 * - Development: pretty, coloured lines.
 * - Production: one JSON object per line (what Loki/Alloy expect).
 * Always log objects first, message second: logger.info({ videoId }, 'transcode done')
 */
import { pino } from 'pino';
import { env } from '../config/env.js';

export type ServiceName = 'api' | 'worker';

let serviceName: ServiceName = 'api';

export const setServiceName = (name: ServiceName) => {
  serviceName = name;
};

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { env: env.NODE_ENV },
  mixin: () => ({ service: serviceName }),
  timestamp: pino.stdTimeFunctions.isoTime,
  // Secrets never reach the logs, even if a whole request or user object is logged by mistake.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[REDACTED]',
  },
  ...(env.isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service,env' },
    },
  }),
});

export type Logger = typeof logger;
