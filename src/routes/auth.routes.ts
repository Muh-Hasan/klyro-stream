import { Router } from 'express';
import { validate } from '../middleware/validate.middleware.js';
import { RegisterSchema, LoginSchema, ForgotPasswordSchema, ResetPasswordSchema } from '../validators/auth.schema.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

router.post('/register', validate(RegisterSchema), authController.register);
router.post('/login', validate(LoginSchema), authController.login);
router.post('/forgot-password', validate(ForgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(ResetPasswordSchema), authController.resetPassword);

export default router;
