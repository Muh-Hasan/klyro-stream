import { z } from 'zod';
import { videoStatusEnum } from '../lib/db/schema.js';
import { clubParams } from './club.schema.js';
import { paginationQuery } from './common.schema.js';

export const VIDEO_TYPES = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
} as const;

export type VideoContentType = keyof typeof VIDEO_TYPES;

export const MAX_VIDEO_BYTES = 5 * 1024 ** 3;

const contentTypes = Object.keys(VIDEO_TYPES) as [VideoContentType, ...VideoContentType[]];

const title = z
  .string({ error: 'The title is required.' })
  .trim()
  .min(1, 'The title is required.')
  .max(255, 'The title must be at most 255 characters.');

const description = z
  .string({ error: 'The description must be a string.' })
  .trim()
  .max(5000, 'The description must be at most 5000 characters.');

export const initiateUploadSchemas = {
  params: clubParams,
  body: z.object({
    title,
    description: description.optional(),
    contentType: z.enum(contentTypes, {
      error: `The file must be one of: ${contentTypes.join(', ')}.`,
    }),
    sizeBytes: z
      .number({ error: 'The size must be a number of bytes.' })
      .int('The size must be a whole number of bytes.')
      .positive('The file is empty.')
      .max(MAX_VIDEO_BYTES, 'The file must be at most 5 GB.'),
  }),
};

export const videoParams = z.object({
  videoId: z.uuid({ error: 'The video id must be a valid UUID.' }),
});

export const MAX_PARTS_PER_BATCH = 100;

export const presignPartsSchemas = {
  params: videoParams,
  body: z.object({
    partNumbers: z
      .array(
        z
          .number({ error: 'Each part number must be a number.' })
          .int('Each part number must be a whole number.')
          .min(1, 'Part numbers start at 1.'),
        { error: 'partNumbers must be an array of part numbers.' },
      )
      .min(1, 'Ask for at least one part.')
      .max(MAX_PARTS_PER_BATCH, `Ask for at most ${MAX_PARTS_PER_BATCH} parts at a time.`)
      .refine((nums) => new Set(nums).size === nums.length, 'Part numbers must be unique.'),
  }),
};

export const uploadProgressSchemas = {
  params: videoParams,
};

export const completeUploadSchemas = {
  params: videoParams,
  body: z.object({
    parts: z
      .array(
        z.object({
          partNumber: z
            .number({ error: 'Each part number must be a number.' })
            .int('Each part number must be a whole number.')
            .min(1, 'Part numbers start at 1.'),
          etag: z
            .string({ error: 'Each part needs the ETag returned when it was uploaded.' })
            .trim()
            .min(1, 'Each part needs the ETag returned when it was uploaded.')
            .max(128, 'That ETag is too long.'),
        }),
        { error: 'parts must be an array of { partNumber, etag }.' },
      )
      .min(1, 'Send at least one part.')
      .max(10_000, 'An upload has at most 10000 parts.')
      .refine(
        (parts) => new Set(parts.map((p) => p.partNumber)).size === parts.length,
        'Part numbers must be unique.',
      ),
  }),
};

export const abortUploadSchemas = {
  params: videoParams,
};

export const MAX_SEARCH_LENGTH = 100;

export const listVideosSchemas = {
  params: clubParams,
  query: paginationQuery.extend({
    status: z
      .enum(videoStatusEnum.enumValues, {
        error: `The status must be one of: ${videoStatusEnum.enumValues.join(', ')}.`,
      })
      .optional(),
    q: z
      .string()
      .trim()
      .max(MAX_SEARCH_LENGTH, `The search must be at most ${MAX_SEARCH_LENGTH} characters.`)
      .optional()
      .transform((q) => q || undefined),
  }),
};

export const getVideoSchemas = {
  params: videoParams,
};

export const deleteVideoSchemas = {
  params: videoParams,
};

export const updateVideoSchemas = {
  params: videoParams,
  body: z
    .object({
      title: title.optional(),
      description: description
        .nullable()
        .optional()
        .transform((d) => (d === '' ? null : d)),
    })
    .refine((body) => body.title !== undefined || body.description !== undefined, {
      error: 'Send a title, a description, or both.',
    }),
};

export type UpdateVideoInput = z.output<typeof updateVideoSchemas.body>;
export type ListVideosInput = z.output<typeof listVideosSchemas.query>;
export type InitiateUploadInput = z.output<typeof initiateUploadSchemas.body>;
export type PresignPartsInput = z.output<typeof presignPartsSchemas.body>;
export type CompleteUploadInput = z.output<typeof completeUploadSchemas.body>;
