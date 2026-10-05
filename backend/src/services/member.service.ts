import * as clubRepo from '../repositories/club.repository.js';
import * as memberRepo from '../repositories/member.repository.js';
import type { Membership } from '../types/express.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { paginated, toOffset } from '../utils/pagination.js';
import type { ListMembersInput, UpdateMemberInput } from '../validators/member.schema.js';

const assertNotCreator = async (clubId: string, userId: string, message: string) => {
  const club = await clubRepo.findById(clubId);
  if (!club) throw new NotFoundError('Club not found', 'CLUB_NOT_FOUND');
  if (club.ownerId === userId) throw new ForbiddenError(message, 'CLUB_CREATOR_PROTECTED');
};

export const listMembers = async ({ clubId }: Membership, { page, limit }: ListMembersInput) => {
  const { items, total } = await memberRepo.listForClub(clubId, limit, toOffset(page, limit));
  return paginated(items, total, page, limit);
};

export const changeMemberRole = async (
  { clubId }: Membership,
  userId: string,
  { role }: UpdateMemberInput,
) => {
  await assertNotCreator(clubId, userId, "The club creator's role cannot be changed");
  return { member: await memberRepo.changeRole(clubId, userId, role) };
};

export const removeMember = async ({ clubId }: Membership, userId: string) => {
  await assertNotCreator(clubId, userId, 'The club creator cannot be removed');
  await memberRepo.remove(clubId, userId);
};

export const leaveClub = async ({ clubId }: Membership, userId: string) => {
  await assertNotCreator(clubId, userId, 'The club creator cannot leave the club');
  await memberRepo.remove(clubId, userId);
};
