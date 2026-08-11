import bcrypt from 'bcrypt';
import * as userRepo from './user.service.js';
import { ConflictError, UnauthorizedError } from '../utils/errors.js';
import { signAccessToken } from './token.service.js';

const BCRYPT_COST = 12;

export const registerUser = async (input: { email: string; password: string }) => {
  const existing = await userRepo.findByEmail(input.email);
  if (existing) throw new ConflictError('Email already registered');

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const user = await userRepo.create({
    email: input.email,
    passwordHash,
    provider: 'local',
  });

  const accessToken = signAccessToken({ userId: user.id });
  return {
    user: { id: user.id, email: user.email },
    accessToken,
  };
};

export const loginUser = async (input: { email: string; password: string }) => {
  const user = await userRepo.findByEmail(input.email);
  if (!user || !user.passwordHash) throw new UnauthorizedError('Invalid credentials');

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new UnauthorizedError('Invalid credentials');

  const accessToken = signAccessToken({ userId: user.id });
  return {
    user: { id: user.id, email: user.email },
    accessToken,
  };
};
