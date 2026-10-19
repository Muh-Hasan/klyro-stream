import type { RequestHandler } from 'express';
import { getInput } from '../middleware/validate.middleware.js';
import * as videoService from '../services/video.service.js';
import { currentMembership } from '../utils/current-membership.js';
import { currentUser } from '../utils/current-user.js';
import type {
  abortUploadSchemas,
  completeUploadSchemas,
  deleteVideoSchemas,
  getVideoSchemas,
  initiateUploadSchemas,
  listVideosSchemas,
  presignPartsSchemas,
  updateVideoSchemas,
  uploadProgressSchemas,
} from '../validators/video.schema.js';

export const list: RequestHandler = async (_req, res) => {
  const { query } = getInput<typeof listVideosSchemas>(res);
  const result = await videoService.listVideos(currentMembership(res), query);
  res.json(result);
};

export const get: RequestHandler = async (req, res) => {
  const { params } = getInput<typeof getVideoSchemas>(res);
  const result = await videoService.getVideo(params.videoId, currentUser(req).id);
  res.json(result);
};

export const update: RequestHandler = async (req, res) => {
  const { params, body } = getInput<typeof updateVideoSchemas>(res);
  const result = await videoService.updateVideo(params.videoId, currentUser(req).id, body);
  res.json(result);
};

export const remove: RequestHandler = async (req, res) => {
  const { params } = getInput<typeof deleteVideoSchemas>(res);
  await videoService.deleteVideo(params.videoId, currentUser(req).id);
  res.status(204).end();
};

export const initiateUpload: RequestHandler = async (req, res) => {
  const { body } = getInput<typeof initiateUploadSchemas>(res);
  const result = await videoService.initiateUpload(
    currentMembership(res),
    currentUser(req).id,
    body,
  );
  res.status(201).json(result);
};

export const presignParts: RequestHandler = async (req, res) => {
  const { params, body } = getInput<typeof presignPartsSchemas>(res);
  const result = await videoService.presignUploadParts(params.videoId, currentUser(req).id, body);
  res.json(result);
};

export const uploadProgress: RequestHandler = async (req, res) => {
  const { params } = getInput<typeof uploadProgressSchemas>(res);
  const result = await videoService.getUploadProgress(params.videoId, currentUser(req).id);
  res.json(result);
};

export const completeUpload: RequestHandler = async (req, res) => {
  const { params, body } = getInput<typeof completeUploadSchemas>(res);
  const requestId = typeof req.id === 'string' ? req.id : undefined;
  const result = await videoService.completeVideoUpload(
    params.videoId,
    currentUser(req).id,
    body,
    requestId,
  );
  res.json(result);
};

export const abortUpload: RequestHandler = async (req, res) => {
  const { params } = getInput<typeof abortUploadSchemas>(res);
  await videoService.abortVideoUpload(params.videoId, currentUser(req).id);
  res.status(204).end();
};
