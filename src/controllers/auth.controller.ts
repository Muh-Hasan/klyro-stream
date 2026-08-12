import { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import type { RegisterSchemaType, LoginSchemaType } from '../validators/auth.schema.js';

export const register = async (req: Request, res: Response) => {
  const result = await authService.registerUser(req.body as RegisterSchemaType);
  res.status(201).json(result);
};

export const login = async (req: Request, res: Response) => {
  const result = await authService.loginUser(req.body as LoginSchemaType);
  res.json(result);
};

