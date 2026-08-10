import { pgEnum, timestamp, uuid, varchar, text, pgTable } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['admin', 'club_owner', 'viewer']);
export const authProviderEnum = pgEnum('auth_provider', ['local', 'google']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 320 }).notNull(),
  passwordHash: text('password_hash'), // null for OAuth-only users
  provider: authProviderEnum('provider').notNull().default('local'),
  providerId: text('provider_id'), // google sub claim, null for local
  ...timestamps,
});
