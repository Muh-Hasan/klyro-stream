import { rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { redis } from '../lib/redis/client.js';
import { TooManyRequestsError } from '../utils/errors.js';

const MINUTE = 60 * 1000;

const failed = (promise: Promise<unknown>) =>
  promise.then(
    () => false,
    () => true,
  );
const quiet = <T>(promise: Promise<T>) => {
  promise.catch(() => undefined);
  return promise;
};

class RecoveringRedisStore extends RedisStore {
  override async increment(key: string) {
    try {
      return await super.increment(key);
    } catch (err) {
      if (await failed(this.incrementScriptSha)) {
        this.incrementScriptSha = quiet(this.loadIncrementScript());
      }
      if (await failed(this.getScriptSha)) this.getScriptSha = quiet(this.loadGetScript());
      throw err;
    }
  }
}

const limiter = (name: string, limit: number, windowMs: number) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    passOnStoreError: true,
    store: new RecoveringRedisStore({
      prefix: `rl:${name}:`,
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<RedisReply>,
    }),
    handler: (_req, _res, next) => next(new TooManyRequestsError()),
  });

export const loginLimiter = limiter('login', 5, 15 * MINUTE);
export const registerLimiter = limiter('register', 5, 60 * MINUTE);
export const forgotPasswordLimiter = limiter('forgot-password', 3, 60 * MINUTE);
export const resetPasswordLimiter = limiter('reset-password', 5, 15 * MINUTE);
