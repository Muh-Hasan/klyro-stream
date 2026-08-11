import 'dotenv/config';
import { z } from 'zod';
import type { StringValue } from 'ms';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),

  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z
    .string()
    .default('15m')
    .transform((value) => value as StringValue),

  JWT_REFRESH_TTL: z
    .string()
    .default('7d')
    .transform((value) => value as StringValue),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
