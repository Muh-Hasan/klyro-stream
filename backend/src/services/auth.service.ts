import bcrypt from 'bcrypt';
import * as tokenBlacklist from '../repositories/token-blacklist.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import type { User } from '../repositories/user.repository.js';
import { isUniqueViolation } from '../utils/db-errors.js';
import { ConflictError, UnauthorizedError } from '../utils/errors.js';
import {
  type RefreshPayload,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/tokens.js';
import type { LoginInput, RegisterInput } from '../validators/auth.schema.js';

const BCRYPT_COST = 10;

export const registerUser = async ({ email, password }: RegisterInput) => {
  if (await userRepo.findByEmail(email))
    throw new ConflictError('Email is already registered', 'EMAIL_TAKEN');

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  let user: User;
  try {
    user = await userRepo.create({ email, passwordHash, provider: 'local' });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ConflictError('Email is already registered', 'EMAIL_TAKEN');
    throw err;
  }

  return {
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
  };
};

export const loginUser = async ({ email, password }: LoginInput) => {
  const user = await userRepo.findByEmail(email);

  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  return {
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    accessToken: signAccessToken(user.id),
    refreshToken: signRefreshToken(user.id, user.tokenVersion),
  };
};

export const getMe = async (userId: string) => {
  const user = await userRepo.findById(userId);

  if (!user) throw new UnauthorizedError();

  return { user: { id: user.id, email: user.email, createdAt: user.createdAt } };
};

export const refreshSession = async (refreshToken: string) => {
  let payload: RefreshPayload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token', 'INVALID_TOKEN');
  }

  const user = await userRepo.findById(payload.userId);
  if (!user) throw new UnauthorizedError('Invalid or expired refresh token', 'INVALID_TOKEN');

  if (payload.ver !== user.tokenVersion) {
    throw new UnauthorizedError('Session has been revoked', 'SESSION_REVOKED');
  }

  if (!(await tokenBlacklist.consume(payload.jti, payload.exp))) {
    await userRepo.bumpTokenVersion(user.id);
    throw new UnauthorizedError('Refresh token already used', 'TOKEN_REUSED');
  }

  return {
    accessToken: signAccessToken(user.id),
    refreshToken: signRefreshToken(user.id, user.tokenVersion),
  };
};

export const logoutSession = async (refreshToken: string | undefined) => {
  if (!refreshToken) return;

  let payload: RefreshPayload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return;
  }

  await tokenBlacklist.revoke(payload.jti, payload.exp);
};

export const logoutAllSessions = async (userId: string) => {
  await userRepo.bumpTokenVersion(userId);
};
