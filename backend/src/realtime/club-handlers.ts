import type { Socket } from 'socket.io';
import { z } from 'zod';
import * as clubRepo from '../repositories/club.repository.js';
import { logger } from '../utils/logger.js';
import type {
  Ack,
  ClientToServerEvents,
  InterServerEvents,
  RoomResult,
  ServerToClientEvents,
  SocketData,
} from './events.js';
import { clubRoom, managersRoom, roomsFor } from './rooms.js';

type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

const clubId = z.uuid();

const fail = (code: string, message: string): RoomResult => ({
  ok: false,
  error: { code, message },
});

const invalidClubId = fail('VALIDATION_ERROR', 'The club id must be a valid UUID.');
const clubNotFound = fail('CLUB_NOT_FOUND', 'Club not found');

const handle =
  (socket: RealtimeSocket, event: string, work: (clubId: string) => Promise<RoomResult>) =>
  (input: unknown, ack?: Ack) => {
    const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
    const parsed = clubId.safeParse(input);
    if (!parsed.success) {
      reply(invalidClubId);
      return;
    }
    work(parsed.data)
      .then(reply)
      .catch((err: unknown) => {
        logger.error(
          { err, event, socketId: socket.id, userId: socket.data.userId },
          'socket handler failed',
        );
        reply(fail('INTERNAL_ERROR', 'Something went wrong'));
      });
  };

export const registerClubHandlers = (socket: RealtimeSocket) => {
  socket.on(
    'club:join',
    handle(socket, 'club:join', async (id) => {
      const role = await clubRepo.getMemberRole(id, socket.data.userId);
      if (!role) return clubNotFound;
      const rooms = roomsFor(id, role);
      await socket.leave(managersRoom(id));
      await socket.join(rooms);
      return { ok: true, clubId: id, role, rooms };
    }),
  );

  socket.on(
    'club:leave',
    handle(socket, 'club:leave', async (id) => {
      if (!socket.rooms.has(clubRoom(id))) return clubNotFound;
      await socket.leave(clubRoom(id));
      await socket.leave(managersRoom(id));
      return { ok: true, clubId: id, role: null, rooms: [] };
    }),
  );
};
