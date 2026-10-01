import bcrypt from 'bcrypt';

const BCRYPT_COST = 10;

export const hashPassword = (password: string): Promise<string> =>
  bcrypt.hash(password, BCRYPT_COST);

export const verifyPassword = (password: string, hash: string): Promise<boolean> =>
  bcrypt.compare(password, hash);
