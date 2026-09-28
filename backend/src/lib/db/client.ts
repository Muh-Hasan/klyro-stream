/**
 * Database access for the whole process (API and worker).
 * Only repositories import `db`. Services and controllers never do.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import * as schema from './schema.js';

// postgres.js connects lazily, on the first query.
export const queryClient = postgres(env.DATABASE_URL, {
  max: env.DB_POOL_MAX,
  idle_timeout: 20, // seconds before an idle connection is closed
  connect_timeout: 10,
  onnotice: () => {}, // silence Postgres NOTICE messages (e.g. "relation already exists")
});

export const db = drizzle(queryClient, {
  schema,
  logger:
    env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
      ? { logQuery: (query, params) => logger.debug({ query, params }, 'sql') }
      : false,
});

export type Db = typeof db;
/** The transaction handle type, for repository functions that accept `tx`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const closeDb = async () => {
  await queryClient.end({ timeout: 5 });
};
