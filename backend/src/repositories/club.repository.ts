import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../lib/db/client.js';
import { type ClubRole, clubMembers, clubs, downloadQuotas } from '../lib/db/schema.js';

export type Club = typeof clubs.$inferSelect;

export const createWithOwner = (name: string, ownerId: string): Promise<Club> =>
  db.transaction(async (tx) => {
    const [club] = await tx.insert(clubs).values({ name, ownerId }).returning();
    if (!club) throw new Error('insert into clubs returned no row');
    await tx.insert(clubMembers).values({ clubId: club.id, userId: ownerId, role: 'admin' });
    await tx.insert(downloadQuotas).values({ clubId: club.id });
    return club;
  });

export const findById = async (clubId: string): Promise<Club | undefined> => {
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId)).limit(1);
  return club;
};

export const updateName = async (clubId: string, name: string): Promise<Club | undefined> => {
  const [club] = await db.update(clubs).set({ name }).where(eq(clubs.id, clubId)).returning();
  return club;
};

export const getMemberRole = async (
  clubId: string,
  userId: string,
): Promise<ClubRole | undefined> => {
  const [member] = await db
    .select({ role: clubMembers.role })
    .from(clubMembers)
    .where(and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)))
    .limit(1);
  return member?.role;
};

export const listForUser = async (userId: string, limit: number, offset: number) => {
  const [items, [total]] = await Promise.all([
    db
      .select({
        id: clubs.id,
        name: clubs.name,
        ownerId: clubs.ownerId,
        createdAt: clubs.createdAt,
        role: clubMembers.role,
      })
      .from(clubMembers)
      .innerJoin(clubs, eq(clubs.id, clubMembers.clubId))
      .where(eq(clubMembers.userId, userId))
      .orderBy(desc(clubs.createdAt), desc(clubs.id))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(clubMembers).where(eq(clubMembers.userId, userId)),
  ]);
  return { items, total: total?.value ?? 0 };
};
