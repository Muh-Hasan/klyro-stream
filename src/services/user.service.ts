import { eq } from 'drizzle-orm';
import { db } from '../lib/db/client.js';
import { users, NewUser } from '../lib/db/schema.js';

export const findByEmail = async (userEmail: string) => {
  return await db.query.users.findFirst({
    where({ email }, { eq }) {
      eq(email, userEmail);
    },
  });
};

export const findById = async (userId: string) => {
  return await db.query.users.findFirst({
    where({ id }, { eq }) {
      eq(id, userId);
    },
  });
};

export const create = async (data: NewUser) => {
  const [user] = await db.insert(users).values(data).returning();
  return user;
};
