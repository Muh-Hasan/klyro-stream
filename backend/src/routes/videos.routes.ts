import { Router } from 'express';
import * as videoController from '../controllers/video.controller.js';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  abortUploadSchemas,
  completeUploadSchemas,
  presignPartsSchemas,
  uploadProgressSchemas,
} from '../validators/video.schema.js';

export const videosRouter = Router();

videosRouter.use(requireAuth);

videosRouter.post(
  '/:videoId/upload/parts',
  validate(presignPartsSchemas),
  videoController.presignParts,
);
videosRouter.get(
  '/:videoId/upload/parts',
  validate(uploadProgressSchemas),
  videoController.uploadProgress,
);
videosRouter.post(
  '/:videoId/upload/complete',
  validate(completeUploadSchemas),
  videoController.completeUpload,
);
videosRouter.delete('/:videoId/upload', validate(abortUploadSchemas), videoController.abortUpload);
