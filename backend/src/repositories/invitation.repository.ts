import { and, count, desc, eq, gt } from 'drizzle-orm';
import { db, type Tx } from '../lib/db/client.js';
import { clubInvitations, clubMembers, users } from '../lib/db/schema.js';

export type Invitation = typeof clubInvitations.$inferSelect;
export type NewInvitation = typeof clubInvitations.$inferInsert;

const isPending = (clubId: string) =>
  and(eq(clubInvitations.clubId, clubId), eq(clubInvitations.status, 'pending'));

export const findPending = (clubId: string, email: string): Promise<Invitation | undefined> =>
  db.query.clubInvitations.findFirst({
    where: and(isPending(clubId), eq(clubInvitations.email, email)),
  });

export const create = async (data: NewInvitation): Promise<Invitation> => {
  const [invitation] = await db.insert(clubInvitations).values(data).returning();
  if (!invitation) throw new Error('insert into club_invitations returned no row');
  return invitation;
};

export const markExpired = async (id: string): Promise<void> => {
  await db
    .update(clubInvitations)
    .set({ status: 'expired' })
    .where(and(eq(clubInvitations.id, id), eq(clubInvitations.status, 'pending')));
};

export const listPending = async (clubId: string, limit: number, offset: number) => {
  const where = and(isPending(clubId), gt(clubInvitations.expiresAt, new Date()));
  const [rows, [total]] = await Promise.all([
    db.query.clubInvitations.findMany({
      columns: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      with: { inviter: { columns: { id: true, email: true } } },
      where,
      orderBy: [desc(clubInvitations.createdAt), desc(clubInvitations.id)],
      limit,
      offset,
    }),
    db.select({ value: count() }).from(clubInvitations).where(where),
  ]);
  const items = rows.map(({ inviter, ...invitation }) => ({ ...invitation, invitedBy: inviter }));
  return { items, total: total?.value ?? 0 };
};

export const findByTokenHash = async (tokenHash: string) => {
  const invitation = await db.query.clubInvitations.findFirst({
    columns: { id: true, email: true, role: true, status: true, expiresAt: true },
    with: {
      club: { columns: { id: true, name: true } },
      inviter: { columns: { email: true } },
    },
    where: eq(clubInvitations.tokenHash, tokenHash),
  });
  if (!invitation) return undefined;
  const { inviter, ...rest } = invitation;
  return { ...rest, invitedBy: inviter };
};

const claim = async (tx: Tx, id: string, status: 'accepted' | 'rejected') => {
  const [claimed] = await tx
    .update(clubInvitations)
    .set({ status, respondedAt: new Date() })
    .where(
      and(
        eq(clubInvitations.id, id),
        eq(clubInvitations.status, 'pending'),
        gt(clubInvitations.expiresAt, new Date()),
      ),
    )
    .returning({ clubId: clubInvitations.clubId, role: clubInvitations.role });
  return claimed;
};

export const acceptForUser = (id: string, userId: string): Promise<boolean> =>
  db.transaction(async (tx) => {
    const claimed = await claim(tx, id, 'accepted');
    if (!claimed) return false;
    await tx
      .insert(clubMembers)
      .values({ clubId: claimed.clubId, userId, role: claimed.role })
      .onConflictDoNothing();
    return true;
  });

export const acceptForNewUser = (id: string, email: string, passwordHash: string) =>
  db.transaction(async (tx) => {
    const claimed = await claim(tx, id, 'accepted');
    if (!claimed) return undefined;
    const [user] = await tx
      .insert(users)
      .values({ email, passwordHash, provider: 'local' })
      .returning();
    if (!user) throw new Error('insert into users returned no row');
    await tx
      .insert(clubMembers)
      .values({ clubId: claimed.clubId, userId: user.id, role: claimed.role });
    return user;
  });

export const reject = (id: string): Promise<boolean> =>
  db.transaction(async (tx) => Boolean(await claim(tx, id, 'rejected')));

export const revoke = async (clubId: string, id: string): Promise<boolean> => {
  const revoked = await db
    .update(clubInvitations)
    .set({ status: 'revoked', respondedAt: new Date() })
    .where(and(eq(clubInvitations.id, id), isPending(clubId)))
    .returning({ id: clubInvitations.id });
  return revoked.length > 0;
};
