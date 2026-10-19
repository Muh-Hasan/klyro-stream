import { Counter, Gauge } from 'prom-client';
import { registry } from '../lib/metrics/registry.js';
import { realtime } from './rooms.js';

export const realtimeEvents = new Counter({
  name: 'realtime_events_total',
  help: 'Socket events sent to rooms, by event name',
  labelNames: ['event'] as const,
  registers: [registry],
});

export const socketConnections = new Gauge({
  name: 'socket_connections',
  help: 'Sockets connected to this API instance',
  registers: [registry],
  collect() {
    this.set(realtime()?.of('/').sockets.size ?? 0);
  },
});
