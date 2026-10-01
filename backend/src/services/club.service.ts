import type { ClubRole } from '../lib/db/schema.js';
import * as clubRepo from '../repositories/club.repository.js';
import type { Club } from '../repositories/club.repository.js';
import type { Membership } from '../types/express.js';
import { NotFoundError } from '../utils/errors.js';
import { paginated, toOffset } from '../utils/pagination.js';
import type {
  CreateClubInput,
  ListClubsInput,
  UpdateClubInput,
} from '../validators/club.schema.js';

const toClubResponse = (club: Club, role: ClubRole) => ({
  club: {
    id: club.id,
    name: club.name,
    ownerId: club.ownerId,
    createdAt: club.createdAt,
    role,
  },
});

export const createClub = async (userId: string, { name }: CreateClubInput) => {
  const club = await clubRepo.createWithOwner(name, userId);
  return toClubResponse(club, 'admin');
};

export const listMyClubs = async (userId: string, { page, limit }: ListClubsInput) => {
  const { items, total } = await clubRepo.listForUser(userId, limit, toOffset(page, limit));
  return paginated(items, total, page, limit);
};

export const getClub = async ({ clubId, role }: Membership) => {
  const club = await clubRepo.findById(clubId);
  if (!club) throw new NotFoundError('Club not found', 'CLUB_NOT_FOUND');
  return toClubResponse(club, role);
};

export const updateClub = async ({ clubId, role }: Membership, { name }: UpdateClubInput) => {
  const club = await clubRepo.updateName(clubId, name);
  if (!club) throw new NotFoundError('Club not found', 'CLUB_NOT_FOUND');
  return toClubResponse(club, role);
};
