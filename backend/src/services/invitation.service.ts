import { env } from '../config/env.js';
import type { ClubRole } from '../lib/db/schema.js';
import { enqueueEmail } from '../lib/queue/queues.js';
import * as clubRepo from '../repositories/club.repository.js';
import * as invitationRepo from '../repositories/invitation.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import type { Membership } from '../types/express.js';
import { isUniqueViolation } from '../utils/db-errors.js';
import type { User } from '../repositories/user.repository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { paginated, toOffset } from '../utils/pagination.js';
import { hashPassword } from '../utils/password.js';
import { generateToken, hashToken, signAccessToken, signRefreshToken } from '../utils/tokens.js';
import type {
  CreateInvitationInput,
  InvitationTokenInput,
  ListInvitationsInput,
  RegisterFromInvitationInput,
} from '../validators/invitation.schema.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const roleLabel: Record<ClubRole, string> = {
  admin: 'an admin',
  club_owner: 'a club owner',
  viewer: 'a viewer',
};

const pendingConflict = () =>
  new ConflictError('An invitation is already pending for this email', 'INVITATION_PENDING');

export const inviteMember = async (
  { clubId }: Membership,
  inviterId: string,
  { email, role }: CreateInvitationInput,
) => {
  const invitee = await userRepo.findByEmail(email);
  if (invitee && (await clubRepo.getMemberRole(clubId, invitee.id)))
    throw new ConflictError('This user is already a member of the club', 'ALREADY_MEMBER');

  const existing = await invitationRepo.findPending(clubId, email);
  if (existing) {
    if (existing.expiresAt > new Date()) throw pendingConflict();
    await invitationRepo.markExpired(existing.id);
  }

  const [club, inviter] = await Promise.all([
    clubRepo.findById(clubId),
    userRepo.findById(inviterId),
  ]);
  if (!club || !inviter) throw new NotFoundError('Club not found', 'CLUB_NOT_FOUND');

  const token = generateToken();
  let invitation: invitationRepo.Invitation;
  try {
    invitation = await invitationRepo.create({
      clubId,
      email,
      role,
      invitedBy: inviterId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw pendingConflict();
    throw err;
  }

  const link = `${env.INVITE_URL}?token=${token}`;
  void enqueueEmail(
    {
      to: email,
      subject: `You're invited to join ${club.name} on KlyroStream`,
      text: `${inviter.email} invited you to join ${club.name} as ${roleLabel[role]}.\n\nAccept or decline here (valid for 7 days):\n\n${link}\n\nIf you weren't expecting this, you can ignore this email.`,
    },
    `email-invitation-${invitation.id}`,
  ).catch((err: unknown) =>
    logger.error({ err, invitationId: invitation.id }, 'could not queue the invitation email'),
  );

  return {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    },
  };
};

export const listInvitations = async (
  { clubId }: Membership,
  { page, limit }: ListInvitationsInput,
) => {
  const { items, total } = await invitationRepo.listPending(clubId, limit, toOffset(page, limit));
  return paginated(items, total, page, limit);
};

export const revokeInvitation = async ({ clubId }: Membership, invitationId: string) => {
  if (!(await invitationRepo.revoke(clubId, invitationId)))
    throw new NotFoundError('Invitation not found', 'INVITATION_NOT_FOUND');
};

const invalidInvitation = () =>
  new NotFoundError('Invitation is invalid or has expired', 'INVALID_INVITATION');

const accountExists = () =>
  new ConflictError(
    'An account already exists for this email; sign in to accept',
    'ACCOUNT_EXISTS',
  );

const findUsable = async (token: string) => {
  const invitation = await invitationRepo.findByTokenHash(hashToken(token));
  if (!invitation || invitation.status !== 'pending') throw invalidInvitation();
  if (invitation.expiresAt <= new Date()) {
    await invitationRepo.markExpired(invitation.id);
    throw invalidInvitation();
  }
  return invitation;
};

export const previewInvitation = async ({ token }: InvitationTokenInput) => {
  const invitation = await findUsable(token);
  return {
    invitation: {
      club: invitation.club,
      invitedBy: invitation.invitedBy,
      role: invitation.role,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    },
    accountExists: Boolean(await userRepo.findByEmail(invitation.email)),
  };
};

export const acceptInvitation = async (userId: string, { token }: InvitationTokenInput) => {
  const invitation = await findUsable(token);
  const user = await userRepo.findById(userId);
  if (!user) throw new UnauthorizedError();
  if (user.email !== invitation.email)
    throw new ForbiddenError(
      'This invitation was sent to a different email',
      'INVITATION_EMAIL_MISMATCH',
    );

  if (!(await invitationRepo.acceptForUser(invitation.id, user.id))) throw invalidInvitation();
  return { club: { ...invitation.club, role: invitation.role } };
};

export const registerFromInvitation = async ({ token, password }: RegisterFromInvitationInput) => {
  const invitation = await findUsable(token);
  if (await userRepo.findByEmail(invitation.email)) throw accountExists();

  const passwordHash = await hashPassword(password);
  let user: User | undefined;
  try {
    user = await invitationRepo.acceptForNewUser(invitation.id, invitation.email, passwordHash);
  } catch (err) {
    if (isUniqueViolation(err)) throw accountExists();
    throw err;
  }
  if (!user) throw invalidInvitation();

  return {
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    club: { ...invitation.club, role: invitation.role },
    accessToken: signAccessToken(user.id),
    refreshToken: signRefreshToken(user.id, user.tokenVersion),
  };
};

export const rejectInvitation = async ({ token }: InvitationTokenInput) => {
  const invitation = await findUsable(token);
  if (!(await invitationRepo.reject(invitation.id))) throw invalidInvitation();
};
