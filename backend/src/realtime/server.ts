import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { readAccessToken } from '../utils/tokens.js';
import { registerClubHandlers } from './club-handlers.js';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './events.js';
import { type RealtimeServer, setRealtime, userRoom } from './rooms.js';

type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

const MAX_MESSAGE_BYTES = 16 * 1024;

const unauthorized = (message: string) =>
  Object.assign(new Error(message), { data: { code: 'UNAUTHORIZED' } });

const authenticate = (socket: RealtimeSocket, next: (err?: Error) => void) => {
  const token: unknown = socket.handshake.auth.token;
  if (typeof token !== 'string' || token === '') {
    next(unauthorized('Missing access token'));
    return;
  }
  try {
    const { userId, expiresAt } = readAccessToken(token);
    socket.data.userId = userId;
    socket.data.expiresAt = expiresAt;
    next();
  } catch {
    next(unauthorized('Invalid or expired access token'));
  }
};

const disconnectAtExpiry = (socket: RealtimeSocket) => {
  const timer = setTimeout(() => {
    socket.emit('auth:expired');
    socket.disconnect(true);
  }, socket.data.expiresAt - Date.now());
  socket.once('disconnect', () => clearTimeout(timer));
};

const onConnection = (socket: RealtimeSocket) => {
  const { userId } = socket.data;
  void socket.join(userRoom(userId));
  disconnectAtExpiry(socket);
  registerClubHandlers(socket);

  logger.debug({ socketId: socket.id, userId }, 'socket connected');
  socket.once('disconnect', (reason) =>
    logger.debug({ socketId: socket.id, userId, reason }, 'socket disconnected'),
  );
};

export const createRealtime = (httpServer: HttpServer): RealtimeServer => {
  const io: RealtimeServer = new Server(httpServer, {
    cors: { origin: env.FRONTEND_URL },
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
  });
  io.use(authenticate);
  io.on('connection', onConnection);
  setRealtime(io);
  return io;
};

export const closeRealtime = async (io: RealtimeServer) => {
  setRealtime(undefined);
  await io.close();
};
