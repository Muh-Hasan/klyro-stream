import type { RequestHandler } from 'express';
import { getInput } from '../middleware/validate.middleware.js';
import * as authService from '../services/auth.service.js';
import { clearRefreshCookie, getRefreshCookie, setRefreshCookie } from '../utils/cookies.js';
import { currentUser } from '../utils/current-user.js';
import { UnauthorizedError } from '../utils/errors.js';
import type { loginSchemas, registerSchemas } from '../validators/auth.schema.js';

export const register: RequestHandler = async (_req, res) => {
  const { body } = getInput<typeof registerSchemas>(res);
  const result = await authService.registerUser(body);
  res.status(201).json(result);
};

export const login: RequestHandler = async (_req, res) => {
  const { body } = getInput<typeof loginSchemas>(res);
  const { refreshToken, ...result } = await authService.loginUser(body);
  setRefreshCookie(res, refreshToken);
  res.json(result);
};

export const me: RequestHandler = async (req, res) => {
  const result = await authService.getMe(currentUser(req).id);
  res.json(result);
};

export const refresh: RequestHandler = async (req, res) => {
  const token = getRefreshCookie(req);
  if (!token) throw new UnauthorizedError('Refresh token missing');

  const { refreshToken, ...result } = await authService.refreshSession(token);
  setRefreshCookie(res, refreshToken);
  res.json(result);
};

export const logout: RequestHandler = async (req, res) => {
  await authService.logoutSession(getRefreshCookie(req));
  clearRefreshCookie(res);
  res.status(204).end();
};

export const logoutAll: RequestHandler = async (req, res) => {
  await authService.logoutAllSessions(currentUser(req).id);
  clearRefreshCookie(res);
  res.status(204).end();
};
