/**
 * One logger for the whole process.
 * - Development: pretty, coloured lines.
 * - Production: one JSON object per line (what Loki/Alloy expect).
 * Always log objects first, message second: logger.info({ videoId }, 'transcode done')
 */
import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'klyro-api', env: env.NODE_ENV },
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
