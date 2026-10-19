import { Router } from 'express';
import * as videoController from '../controllers/video.controller.js';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  abortUploadSchemas,
  completeUploadSchemas,
  deleteVideoSchemas,
  getVideoSchemas,
  presignPartsSchemas,
  streamSchemas,
  updateVideoSchemas,
  uploadProgressSchemas,
} from '../validators/video.schema.js';

export const videosRouter = Router();

videosRouter.use(requireAuth);

videosRouter.get('/:videoId', validate(getVideoSchemas), videoController.get);
videosRouter.patch('/:videoId', validate(updateVideoSchemas), videoController.update);
videosRouter.delete('/:videoId', validate(deleteVideoSchemas), videoController.remove);
videosRouter.get(
  '/:videoId/stream/:rendition.m3u8',
  validate(streamSchemas),
  videoController.stream,
);

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
