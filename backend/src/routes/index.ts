/**
 * The whole API surface in one file. Each feature exports a router; mount it here.
 * Reading this file should tell you every top-level path the service exposes.
 */
import { Router } from 'express';
import { ADMIN_PATH, adminRouter } from './admin.routes.js';
import { authRouter } from './auth.routes.js';
import { clubsRouter } from './clubs.routes.js';
import { healthRouter } from './health.routes.js';
import { invitationsRouter } from './invitations.routes.js';
import { videosRouter } from './videos.routes.js';

export const routes = Router();

routes.use('/health', healthRouter);
routes.use('/auth', authRouter);
routes.use('/clubs', clubsRouter);
routes.use('/invitations', invitationsRouter);
routes.use('/videos', videosRouter);

if (adminRouter) routes.use(ADMIN_PATH, adminRouter);
