import type { RequestHandler } from 'express';
import { getInput } from '../middleware/validate.middleware.js';
import * as authService from '../services/auth.service.js';
import type { loginSchemas, registerSchemas } from '../validators/auth.schema.js';

export const register: RequestHandler = async (_req, res) => {
  const { body } = getInput<typeof registerSchemas>(res);
  const result = await authService.registerUser(body);
  res.status(201).json(result);
};

export const login: RequestHandler = async (_req, res) => {
  const { body } = getInput<typeof loginSchemas>(res);
  const result = await authService.loginUser(body);
  res.json(result);
};
