import * as memberRepo from '../repositories/member.repository.js';
import type { Membership } from '../types/express.js';
import { paginated, toOffset } from '../utils/pagination.js';
import type { ListMembersInput, UpdateMemberInput } from '../validators/member.schema.js';

export const listMembers = async ({ clubId }: Membership, { page, limit }: ListMembersInput) => {
  const { items, total } = await memberRepo.listForClub(clubId, limit, toOffset(page, limit));
  return paginated(items, total, page, limit);
};

export const changeMemberRole = async (
  { clubId }: Membership,
  userId: string,
  { role }: UpdateMemberInput,
) => ({ member: await memberRepo.changeRole(clubId, userId, role) });

export const removeMember = async ({ clubId }: Membership, userId: string) => {
  await memberRepo.remove(clubId, userId);
};
