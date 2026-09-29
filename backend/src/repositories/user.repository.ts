import { eq } from 'drizzle-orm';
import { db } from '../lib/db/client.js';
import { users } from '../lib/db/schema.js';

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const findByEmail = async (email: string): Promise<User | undefined> => {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
};

export const create = async (data: NewUser): Promise<User> => {
  const [user] = await db.insert(users).values(data).returning();
  if (!user) throw new Error('insert into users returned no row');
  return user;
};
