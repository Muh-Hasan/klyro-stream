import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { loginSchemas, registerSchemas } from '../validators/auth.schema.js';

export const authRouter = Router();

authRouter.post('/register', validate(registerSchemas), authController.register);
authRouter.post('/login', validate(loginSchemas), authController.login);
