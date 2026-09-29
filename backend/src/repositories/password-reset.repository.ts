import { redis } from '../lib/redis/client.js';

const RESET_TOKEN_TTL = 30 * 60;

const key = (tokenHash: string) => `pwreset:${tokenHash}`;

export const save = async (tokenHash: string, userId: string): Promise<void> => {
  await redis.set(key(tokenHash), userId, 'EX', RESET_TOKEN_TTL);
};

export const consume = async (tokenHash: string): Promise<string | null> =>
  redis.getdel(key(tokenHash));
