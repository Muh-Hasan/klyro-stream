import { redis } from '../lib/redis/client.js';

const key = (jti: string) => `blacklist:token:${jti}`;
const ttlFor = (exp: number) => Math.max(exp - Math.floor(Date.now() / 1000), 1);

export const consume = async (jti: string, exp: number): Promise<boolean> =>
  (await redis.set(key(jti), '1', 'EX', ttlFor(exp), 'NX')) === 'OK';

export const revoke = async (jti: string, exp: number): Promise<void> => {
  await redis.set(key(jti), '1', 'EX', ttlFor(exp));
};
