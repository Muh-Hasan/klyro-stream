import type { ClubRole } from '../lib/db/schema.js';

const rank: Record<ClubRole, number> = { viewer: 1, club_owner: 2, admin: 3 };

export const hasRole = (role: ClubRole, min: ClubRole) => rank[role] >= rank[min];

export const isManager = (role: ClubRole) => hasRole(role, 'club_owner');
