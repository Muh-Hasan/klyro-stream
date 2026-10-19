import { parseArgs } from 'node:util';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../realtime/events.js';

const { values } = parseArgs({
  options: {
    club: { type: 'string' },
    api: { type: 'string', default: process.env.API_URL ?? 'http://localhost:4000' },
    email: { type: 'string', default: process.env.KLYRO_EMAIL },
  },
});

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const usage =
  'usage: npm run socket:listen -- --club <clubId> [--email you@x.com] [--api http://localhost:4000]\n' +
  '       password is read from KLYRO_PASSWORD';
const clubId = values.club ?? fail(usage);
const email = values.email ?? fail('pass --email or set KLYRO_EMAIL\n' + usage);
const password = process.env.KLYRO_PASSWORD ?? fail('KLYRO_PASSWORD is not set\n' + usage);

const time = () => new Date().toISOString().slice(11, 19);
const say = (event: string, detail = '') =>
  process.stdout.write(`${time()}  ${event.padEnd(16)} ${detail}\n`);
const short = (id: string) => id.slice(0, 8);

let refreshCookie = '';

const authenticate = async (route: '/auth/login' | '/auth/refresh') => {
  const res = await fetch(`${values.api}${route}`, {
    method: 'POST',
    headers:
      route === '/auth/login' ? { 'content-type': 'application/json' } : { cookie: refreshCookie },
    body: route === '/auth/login' ? JSON.stringify({ email, password }) : undefined,
  });
  if (!res.ok) throw new Error(`${route} failed: ${res.status} ${res.statusText}`);
  const rt = res.headers.getSetCookie().find((c) => c.startsWith('rt='));
  if (rt) refreshCookie = rt.split(';')[0] ?? '';
  return ((await res.json()) as { accessToken: string }).accessToken;
};

const freshToken = async () => {
  if (refreshCookie) {
    try {
      return await authenticate('/auth/refresh');
    } catch {
      refreshCookie = '';
    }
  }
  return authenticate('/auth/login');
};

let token = await freshToken().catch((err: unknown) => fail(String(err)));

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(values.api, {
  auth: (send) => send({ token }),
  transports: ['websocket'],
});

socket.on('connect', () => {
  say('connected', socket.id);
  socket.emit('club:join', clubId, (result) => {
    if (!result.ok) {
      say('join refused', `${result.error.code}: ${result.error.message}`);
      process.exit(1);
    }
    say('joined', `${result.role ?? ''} · rooms ${result.rooms.join(', ')}`);
  });
});

socket.on('connect_error', (err) => say('connect error', err.message));
socket.on('disconnect', (reason) => say('disconnected', reason));

socket.on('auth:expired', () => {
  say('token expired', 'getting a new one and reconnecting');
  freshToken()
    .then((next) => {
      token = next;
      socket.connect();
    })
    .catch((err: unknown) => fail(String(err)));
});

socket.on('club:membership', ({ role }) => {
  if (role) return say('role changed', role);
  say('removed', 'you are no longer a member of this club');
  process.exit(0);
});

socket.on('video:progress', ({ videoId, percent }) =>
  say('progress', `${short(videoId)}  ${percent}%`),
);
socket.on('video:ready', ({ videoId, title, durationSeconds, resolution }) =>
  say(
    'video:ready',
    `${short(videoId)}  "${title}" · ${durationSeconds ?? '?'} s · ${resolution ? `${resolution.width}×${resolution.height}` : '?'}`,
  ),
);
socket.on('video:failed', ({ videoId, title, reason }) =>
  say('video:failed', `${short(videoId)}  "${title}" · ${reason ?? 'unknown reason'}`),
);

const stop = () => {
  socket.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
