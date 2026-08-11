import { Router } from 'express';
import { validate } from '../middleware/validate.middleware.js';
import { RegisterSchema, LoginSchema } from '../validators/auth.schema.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

router.post('/register', validate(RegisterSchema), authController.register);
router.post('/login', validate(LoginSchema), authController.login);

export default router;