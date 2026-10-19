import type { Server } from 'socket.io';
import type { ClubRole } from '../lib/db/schema.js';
import { logger } from '../utils/logger.js';
import { isManager } from '../utils/roles.js';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './events.js';

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export const userRoom = (userId: string) => `user:${userId}`;
export const clubRoom = (clubId: string) => `club:${clubId}`;
export const managersRoom = (clubId: string) => `club:${clubId}:managers`;

export const roomsFor = (clubId: string, role: ClubRole) =>
  isManager(role) ? [clubRoom(clubId), managersRoom(clubId)] : [clubRoom(clubId)];

let current: RealtimeServer | undefined;

export const setRealtime = (io: RealtimeServer | undefined) => {
  current = io;
};

export const realtime = () => current;

const applyMembership = async (
  io: RealtimeServer,
  userId: string,
  clubId: string,
  role: ClubRole | null,
) => {
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  for (const socket of sockets) {
    if (!socket.rooms.has(clubRoom(clubId))) continue;
    if (role === null) socket.leave(clubRoom(clubId));
    if (role === null || !isManager(role)) socket.leave(managersRoom(clubId));
    else socket.join(managersRoom(clubId));
    socket.emit('club:membership', { clubId, role });
  }
  return sockets.length;
};

export const syncMembership = (userId: string, clubId: string, role: ClubRole | null) => {
  const io = current;
  if (!io) return;
  applyMembership(io, userId, clubId, role)
    .then((sockets) => logger.debug({ userId, clubId, role, sockets }, 'socket rooms synced'))
    .catch((err: unknown) =>
      logger.error({ err, userId, clubId, role }, 'could not update socket rooms'),
    );
};
