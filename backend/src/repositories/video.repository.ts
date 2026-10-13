import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { db, type Tx } from '../lib/db/client.js';
import { type Video, type NewVideo, type VideoStatus, videos } from '../lib/db/schema.js';

export type { Video };

const TRANSITIONS: Record<VideoStatus, readonly VideoStatus[]> = {
  UPLOADING: ['PROCESSING', 'ERROR'],
  PROCESSING: ['READY', 'ERROR'],
  READY: [],
  ERROR: [],
};

export type VideoChanges = Partial<
  Pick<
    NewVideo,
    'uploadId' | 'sizeBytes' | 'hlsPath' | 'thumbnailPath' | 'durationSeconds' | 'errorMessage'
  >
>;

export class IllegalTransitionError extends Error {
  constructor(from: VideoStatus, to: VideoStatus) {
    super(`illegal video transition ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export const canTransition = (from: VideoStatus, to: VideoStatus) => TRANSITIONS[from].includes(to);

export const create = async (data: NewVideo): Promise<Video> => {
  const [video] = await db.insert(videos).values(data).returning();
  if (!video) throw new Error('insert into videos returned no row');
  return video;
};

export const findById = (id: string): Promise<Video | undefined> =>
  db.query.videos.findFirst({ where: eq(videos.id, id) });

export const findByStatus = (status: VideoStatus, limit: number): Promise<Video[]> =>
  db.query.videos.findMany({
    where: eq(videos.status, status),
    orderBy: desc(videos.updatedAt),
    limit,
  });

export const findProcessingSince = (
  before: Date,
  limit: number,
  clubId?: string,
): Promise<Video[]> =>
  db.query.videos.findMany({
    where: and(
      eq(videos.status, 'PROCESSING'),
      lt(videos.updatedAt, before),
      clubId ? eq(videos.clubId, clubId) : undefined,
    ),
    orderBy: asc(videos.updatedAt),
    limit,
  });

export const findUploadingCreatedBefore = (
  before: Date,
  limit: number,
  clubId?: string,
): Promise<Video[]> =>
  db.query.videos.findMany({
    where: and(
      eq(videos.status, 'UPLOADING'),
      lt(videos.createdAt, before),
      clubId ? eq(videos.clubId, clubId) : undefined,
    ),
    orderBy: asc(videos.createdAt),
    limit,
  });

export const transition = async (
  id: string,
  from: VideoStatus,
  to: VideoStatus,
  changes: VideoChanges = {},
  executor: typeof db | Tx = db,
): Promise<Video | undefined> => {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
  const [video] = await executor
    .update(videos)
    .set({ ...changes, status: to })
    .where(and(eq(videos.id, id), eq(videos.status, from)))
    .returning();
  return video;
};

export const withUploadLock = <T>(
  id: string,
  fn: (video: Video, tx: Tx) => Promise<T>,
): Promise<T | undefined> =>
  db.transaction(async (tx) => {
    const [video] = await tx
      .select()
      .from(videos)
      .where(and(eq(videos.id, id), eq(videos.status, 'UPLOADING')))
      .for('update');
    return video ? fn(video, tx) : undefined;
  });
