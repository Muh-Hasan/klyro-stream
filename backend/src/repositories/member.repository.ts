import { and, asc, count, eq } from 'drizzle-orm';
import { db, type Tx } from '../lib/db/client.js';
import { type ClubRole, clubMembers, users } from '../lib/db/schema.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';

const memberFields = {
  userId: clubMembers.userId,
  email: users.email,
  role: clubMembers.role,
  joinedAt: clubMembers.createdAt,
};

const isMember = (clubId: string, userId: string) =>
  and(eq(clubMembers.clubId, clubId), eq(clubMembers.userId, userId));

const lastAdminError = () => new ConflictError('A club must keep at least one admin', 'LAST_ADMIN');

const lockMember = async (tx: Tx, clubId: string, userId: string) => {
  const admins = await tx
    .select({ userId: clubMembers.userId })
    .from(clubMembers)
    .where(and(eq(clubMembers.clubId, clubId), eq(clubMembers.role, 'admin')))
    .orderBy(asc(clubMembers.userId))
    .for('update');

  const [member] = await tx
    .select({ role: clubMembers.role })
    .from(clubMembers)
    .where(isMember(clubId, userId))
    .for('update');
  if (!member) throw new NotFoundError('Member not found', 'MEMBER_NOT_FOUND');

  return { role: member.role, isLastAdmin: member.role === 'admin' && admins.length === 1 };
};

export const listForClub = async (clubId: string, limit: number, offset: number) => {
  const where = eq(clubMembers.clubId, clubId);
  const [items, [total]] = await Promise.all([
    db
      .select(memberFields)
      .from(clubMembers)
      .innerJoin(users, eq(users.id, clubMembers.userId))
      .where(where)
      .orderBy(asc(clubMembers.createdAt), asc(clubMembers.userId))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(clubMembers).where(where),
  ]);
  return { items, total: total?.value ?? 0 };
};

export const changeRole = (clubId: string, userId: string, role: ClubRole) =>
  db.transaction(async (tx) => {
    const member = await lockMember(tx, clubId, userId);
    if (member.isLastAdmin && role !== 'admin') throw lastAdminError();

    await tx.update(clubMembers).set({ role }).where(isMember(clubId, userId));
    const [updated] = await tx
      .select(memberFields)
      .from(clubMembers)
      .innerJoin(users, eq(users.id, clubMembers.userId))
      .where(isMember(clubId, userId));
    if (!updated) throw new NotFoundError('Member not found', 'MEMBER_NOT_FOUND');
    return updated;
  });

export const remove = (clubId: string, userId: string) =>
  db.transaction(async (tx) => {
    const member = await lockMember(tx, clubId, userId);
    if (member.isLastAdmin) throw lastAdminError();
    await tx.delete(clubMembers).where(isMember(clubId, userId));
  });
