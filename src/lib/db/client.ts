import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../../config/env.js';
import * as schema from './schema.js';

const queryClient = postgres(env.DATABASE_URL, { max: 10 });

export const db = drizzle(queryClient, {
  schema,
  logger: env.NODE_ENV === 'development',
});
export type DB = typeof db;