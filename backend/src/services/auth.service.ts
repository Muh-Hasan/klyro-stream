import bcrypt from 'bcrypt';
import * as userRepo from '../repositories/user.repository.js';
import type { User } from '../repositories/user.repository.js';
import { isUniqueViolation } from '../utils/db-errors.js';
import { ConflictError, UnauthorizedError } from '../utils/errors.js';
import { signAccessToken } from '../utils/tokens.js';
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
  };
};
