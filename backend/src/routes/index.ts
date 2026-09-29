/**
 * The whole API surface in one file. Each feature exports a router; mount it here.
 * Reading this file should tell you every top-level path the service exposes.
 */
import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { healthRouter } from './health.routes.js';

export const routes = Router();

routes.use('/health', healthRouter);
routes.use('/auth', authRouter);

// Add feature routers as they are built:
// routes.use('/clubs', clubsRouter);    // Sprint 3
// routes.use('/videos', videosRouter);  // Sprint 4
