import * as clubRepo from '../repositories/club.repository.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { paginated, toOffset } from '../utils/pagination.js';
import type {
  CreateClubInput,
  ListClubsInput,
  UpdateClubInput,
} from '../validators/club.schema.js';

export const createClub = async (userId: string, { name }: CreateClubInput) => {
  const club = await clubRepo.createWithOwner(name, userId);
  return {
    club: {
      id: club.id,
      name: club.name,
      ownerId: club.ownerId,
      createdAt: club.createdAt,
      role: 'admin' as const,
    },
  };
};

export const listMyClubs = async (userId: string, { page, limit }: ListClubsInput) => {
  const { items, total } = await clubRepo.listForUser(userId, limit, toOffset(page, limit));
  return paginated(items, total, page, limit);
};

export const getClub = async (userId: string, clubId: string) => {
  const club = await clubRepo.findForMember(clubId, userId);
  if (!club) throw new NotFoundError('Club not found', 'CLUB_NOT_FOUND');
  return { club };
};

export const updateClub = async (userId: string, clubId: string, { name }: UpdateClubInput) => {
  const member = await clubRepo.findForMember(clubId, userId);
  if (!member) throw new NotFoundError('Club not found', 'CLUB_NOT_FOUND');
  if (member.role !== 'admin') throw new ForbiddenError('Requires admin role');

  const club = await clubRepo.updateName(clubId, name);
  if (!club) throw new NotFoundError('Club not found', 'CLUB_NOT_FOUND');
  return {
    club: {
      id: club.id,
      name: club.name,
      ownerId: club.ownerId,
      createdAt: club.createdAt,
      role: member.role,
    },
  };
};
