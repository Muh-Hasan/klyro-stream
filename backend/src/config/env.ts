import { config } from 'dotenv';
import { z } from 'zod';

config({ quiet: true });

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

const optional = <T extends z.ZodType>(type: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), type.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_METRICS_PORT: z.coerce.number().int().positive().default(9465),
  WORKER_METRICS_PORT: z.coerce.number().int().positive().default(9464),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),

  FRONTEND_URL: csv.pipe(z.array(z.url()).min(1)),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().default('KlyroStream <no-reply@klyro.local>'),
  PASSWORD_RESET_URL: z.url(),
  INVITE_URL: z.url(),
  VIDEO_URL: z.url().default('http://localhost:5173/videos'),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.url(),
  OAUTH_SUCCESS_REDIRECT: z.url(),

  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  STREAM_URL_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),

  BULL_BOARD_USER: optional(z.string()),
  BULL_BOARD_PASSWORD: optional(z.string().min(12)),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  FAIL_RATE: z.coerce.number().min(0).max(1).default(0),
});

const parsed = schema
  .refine((value) => value.NODE_ENV !== 'production' || value.FAIL_RATE === 0, {
    message: 'FAIL_RATE must be 0 in production.',
    path: ['FAIL_RATE'],
  })
  .refine((value) => Boolean(value.BULL_BOARD_USER) === Boolean(value.BULL_BOARD_PASSWORD), {
    message: 'Set both BULL_BOARD_USER and BULL_BOARD_PASSWORD, or neither.',
    path: ['BULL_BOARD_PASSWORD'],
  })
  .safeParse(process.env);

if (!parsed.success) {
  // The logger isn't available yet (it depends on env), so this is the one allowed console call.
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isDevelopment: parsed.data.NODE_ENV === 'development',
});

export type Env = typeof env;
