import type { ClubRole } from '../lib/db/schema.js';

export type RoomError = { code: string; message: string };

export type RoomResult =
  | { ok: true; clubId: string; role: ClubRole | null; rooms: string[] }
  | { ok: false; error: RoomError };

export type Ack = (result: RoomResult) => void;

export type ClientToServerEvents = {
  'club:join': (clubId: unknown, ack?: Ack) => void;
  'club:leave': (clubId: unknown, ack?: Ack) => void;
};

export type ServerToClientEvents = {
  'auth:expired': () => void;
  'club:membership': (change: { clubId: string; role: ClubRole | null }) => void;
};

export type InterServerEvents = Record<string, never>;

export type SocketData = { userId: string; expiresAt: number };
