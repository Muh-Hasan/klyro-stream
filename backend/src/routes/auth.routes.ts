import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import {
  forgotPasswordLimiter,
  loginLimiter,
  registerLimiter,
  resetPasswordLimiter,
} from '../middleware/rate-limit.middleware.js';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  forgotPasswordSchemas,
  loginSchemas,
  registerSchemas,
  resetPasswordSchemas,
} from '../validators/auth.schema.js';

export const authRouter = Router();

authRouter.post('/register', registerLimiter, validate(registerSchemas), authController.register);
authRouter.post('/login', loginLimiter, validate(loginSchemas), authController.login);
authRouter.get('/me', requireAuth, authController.me);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.post('/logout-all', requireAuth, authController.logoutAll);
authRouter.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate(forgotPasswordSchemas),
  authController.forgotPassword,
);
authRouter.post(
  '/reset-password',
  resetPasswordLimiter,
  validate(resetPasswordSchemas),
  authController.resetPassword,
);
