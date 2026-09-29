import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { loginSchemas, registerSchemas } from '../validators/auth.schema.js';

export const authRouter = Router();

authRouter.post('/register', validate(registerSchemas), authController.register);
authRouter.post('/login', validate(loginSchemas), authController.login);
authRouter.get('/me', requireAuth, authController.me);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.post('/logout-all', requireAuth, authController.logoutAll);
