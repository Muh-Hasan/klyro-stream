/**
 * Database schema. Change it here, then:
 *   npm run db:generate   -> writes a SQL migration into drizzle/ (commit it)
 *   npm run db:migrate    -> applies it
 * Never edit a migration that has already been applied; generate a new one.
 */
import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Enums ──────────────────────────────────────────────────────────────
export const userRoleEnum = pgEnum('user_role', ['admin', 'club_owner', 'viewer']);
export const authProviderEnum = pgEnum('auth_provider', ['local', 'google']);
export const videoStatusEnum = pgEnum('video_status', [
  'UPLOADING',
  'PROCESSING',
  'READY',
  'ERROR',
]);
export const invitationStatusEnum = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'rejected',
  'revoked',
  'expired',
]);

// ─── Shared columns ─────────────────────────────────────────────────────
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

// ─── users ──────────────────────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: text('password_hash'), // null for Google-only accounts
    provider: authProviderEnum('provider').notNull().default('local'),
    providerId: text('provider_id'),
    tokenVersion: integer('token_version').notNull().default(0), // bump to log out everywhere (Sprint 2)
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_uniq').on(t.email),
    uniqueIndex('users_provider_uniq').on(t.provider, t.providerId),
  ],
);

// ─── clubs ──────────────────────────────────────────────────────────────
export const clubs = pgTable(
  'clubs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [index('clubs_owner_idx').on(t.ownerId)],
);

// ─── club_members ───────────────────────────────────────────────────────
export const clubMembers = pgTable(
  'club_members',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.clubId] }),
    index('club_members_club_idx').on(t.clubId),
  ],
);

// ─── club_invitations ───────────────────────────────────────────────────
export const clubInvitations = pgTable(
  'club_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 320 }).notNull(),
    role: userRoleEnum('role').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    status: invitationStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('club_invitations_token_uniq').on(t.tokenHash),
    uniqueIndex('club_invitations_pending_uniq')
      .on(t.clubId, t.email)
      .where(sql`${t.status} = 'pending'`),
    index('club_invitations_email_idx').on(t.email),
  ],
);

// ─── videos ─────────────────────────────────────────────────────────────
export const videos = pgTable(
  'videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    status: videoStatusEnum('status').notNull().default('UPLOADING'),
    rawPath: text('raw_path'),
    hlsPath: text('hls_path'),
    thumbnailPath: text('thumbnail_path'),
    durationSeconds: integer('duration_seconds'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    errorMessage: text('error_message'),
    ...timestamps,
  },
  (t) => [
    index('videos_club_idx').on(t.clubId),
    index('videos_status_idx').on(t.status),
    index('videos_club_created_idx').on(t.clubId, t.createdAt),
  ],
);

// ─── download_quotas ────────────────────────────────────────────────────
export const downloadQuotas = pgTable('download_quotas', {
  clubId: uuid('club_id')
    .primaryKey()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  quotaLimit: integer('quota_limit').notNull().default(100),
  usedCount: integer('used_count').notNull().default(0),
  ...timestamps,
});

// ─── download_logs ──────────────────────────────────────────────────────
export const downloadLogs = pgTable(
  'download_logs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('download_logs_video_idx').on(t.videoId),
    index('download_logs_user_idx').on(t.userId),
  ],
);

// ─── Relations (enable db.query.* with `with: {...}`) ───────────────────
export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(clubMembers),
  ownedClubs: many(clubs),
  uploads: many(videos),
}));

export const clubsRelations = relations(clubs, ({ one, many }) => ({
  owner: one(users, { fields: [clubs.ownerId], references: [users.id] }),
  members: many(clubMembers),
  invitations: many(clubInvitations),
  videos: many(videos),
  quota: one(downloadQuotas, { fields: [clubs.id], references: [downloadQuotas.clubId] }),
}));

export const clubMembersRelations = relations(clubMembers, ({ one }) => ({
  user: one(users, { fields: [clubMembers.userId], references: [users.id] }),
  club: one(clubs, { fields: [clubMembers.clubId], references: [clubs.id] }),
}));

export const clubInvitationsRelations = relations(clubInvitations, ({ one }) => ({
  club: one(clubs, { fields: [clubInvitations.clubId], references: [clubs.id] }),
  inviter: one(users, { fields: [clubInvitations.invitedBy], references: [users.id] }),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  club: one(clubs, { fields: [videos.clubId], references: [clubs.id] }),
  uploader: one(users, { fields: [videos.uploadedBy], references: [users.id] }),
  downloads: many(downloadLogs),
}));

// ─── Inferred types: never hand-write these ─────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Club = typeof clubs.$inferSelect;
export type NewClub = typeof clubs.$inferInsert;
export type ClubMember = typeof clubMembers.$inferSelect;
export type ClubRole = (typeof userRoleEnum.enumValues)[number];
export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type VideoStatus = (typeof videoStatusEnum.enumValues)[number];
export type DownloadQuota = typeof downloadQuotas.$inferSelect;
export type DownloadLog = typeof downloadLogs.$inferSelect;
export type ClubInvitation = typeof clubInvitations.$inferSelect;
export type InvitationStatus = (typeof invitationStatusEnum.enumValues)[number];
