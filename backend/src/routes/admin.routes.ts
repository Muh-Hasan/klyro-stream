import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Router } from 'express';
import { env } from '../config/env.js';
import { videoQueue } from '../lib/queue/queues.js';
import { basicAuth } from '../middleware/basic-auth.middleware.js';
import { adminLimiter } from '../middleware/rate-limit.middleware.js';

export const BULL_BOARD_PATH = '/admin/queues';

const createAdminRouter = (user: string, password: string) => {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: [new BullMQAdapter(videoQueue)],
    serverAdapter,
    options: { uiConfig: { boardTitle: 'KlyroStream jobs' } },
  });

  const router = Router();
  router.use(
    adminLimiter,
    basicAuth(user, password, 'KlyroStream admin'),
    serverAdapter.getRouter() as Router,
  );
  return router;
};

export const adminRouter =
  env.BULL_BOARD_USER && env.BULL_BOARD_PASSWORD
    ? createAdminRouter(env.BULL_BOARD_USER, env.BULL_BOARD_PASSWORD)
    : undefined;
