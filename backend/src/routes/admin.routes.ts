import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Router } from 'express';
import { env } from '../config/env.js';
import * as quotaController from '../controllers/quota.controller.js';
import { videoQueue } from '../lib/queue/queues.js';
import { basicAuth } from '../middleware/basic-auth.middleware.js';
import { adminLimiter } from '../middleware/rate-limit.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { setQuotaLimitSchemas } from '../validators/quota.schema.js';

export const ADMIN_PATH = '/admin';
export const BULL_BOARD_PATH = `${ADMIN_PATH}/queues`;

const createAdminRouter = (user: string, password: string) => {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: [new BullMQAdapter(videoQueue)],
    serverAdapter,
    options: { uiConfig: { boardTitle: 'KlyroStream jobs' } },
  });

  const router = Router();
  router.use(adminLimiter, basicAuth(user, password, 'KlyroStream admin'));
  router.use('/queues', serverAdapter.getRouter() as Router);
  router.patch('/clubs/:clubId/quota', validate(setQuotaLimitSchemas), quotaController.setLimit);
  return router;
};

export const adminRouter =
  env.BULL_BOARD_USER && env.BULL_BOARD_PASSWORD
    ? createAdminRouter(env.BULL_BOARD_USER, env.BULL_BOARD_PASSWORD)
    : undefined;
