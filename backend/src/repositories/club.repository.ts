import { and, count, desc, eq, inArray } from 'drizzle-orm';
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

export const findById = (clubId: string): Promise<Club | undefined> =>
  db.query.clubs.findFirst({ where: eq(clubs.id, clubId) });

export const updateName = async (clubId: string, name: string): Promise<Club | undefined> => {
  const [club] = await db.update(clubs).set({ name }).where(eq(clubs.id, clubId)).returning();
  return club;
};

export const getMemberRole = async (
  clubId: string,
  userId: string,
): Promise<ClubRole | undefined> => {
  const member = await db.query.clubMembers.findFirst({
    columns: { role: true },
    where: and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId)),
  });
  return member?.role;
};

export const listForUser = async (userId: string, limit: number, offset: number) => {
  const isMember = eq(clubMembers.userId, userId);
  const [rows, [total]] = await Promise.all([
    db.query.clubs.findMany({
      columns: { id: true, name: true, ownerId: true, createdAt: true },
      where: inArray(
        clubs.id,
        db.select({ clubId: clubMembers.clubId }).from(clubMembers).where(isMember),
      ),
      with: { members: { columns: { role: true }, where: isMember } },
      orderBy: [desc(clubs.createdAt), desc(clubs.id)],
      limit,
      offset,
    }),
    db.select({ value: count() }).from(clubMembers).where(isMember),
  ]);
  const items = rows.flatMap(({ members, ...club }) =>
    members[0] ? [{ ...club, role: members[0].role }] : [],
  );
  return { items, total: total?.value ?? 0 };
};
