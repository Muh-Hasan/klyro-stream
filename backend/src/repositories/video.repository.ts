import { and, asc, count, desc, eq, ilike, inArray, lt } from 'drizzle-orm';
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

export type VideoListFilter = {
  clubId: string;
  statuses: readonly VideoStatus[];
  search?: string;
};

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

export const listForClub = async (
  { clubId, statuses, search }: VideoListFilter,
  limit: number,
  offset: number,
) => {
  const where = and(
    eq(videos.clubId, clubId),
    inArray(videos.status, [...statuses]),
    search ? ilike(videos.title, `%${escapeLike(search)}%`) : undefined,
  );
  const [items, [total]] = await Promise.all([
    db.query.videos.findMany({
      columns: {
        id: true,
        title: true,
        status: true,
        thumbnailPath: true,
        durationSeconds: true,
        sizeBytes: true,
        uploadedBy: true,
        createdAt: true,
      },
      where,
      orderBy: [desc(videos.createdAt), desc(videos.id)],
      limit,
      offset,
    }),
    db.select({ value: count() }).from(videos).where(where),
  ]);
  return { items, total: total?.value ?? 0 };
};

export const findWithUploader = (id: string) =>
  db.query.videos.findFirst({
    where: eq(videos.id, id),
    with: { uploader: { columns: { id: true, email: true } } },
  });

export type VideoDetails = Partial<Pick<NewVideo, 'title' | 'description'>>;

export const updateDetails = async (id: string, details: VideoDetails) => {
  const [video] = await db.update(videos).set(details).where(eq(videos.id, id)).returning();
  return video;
};

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
