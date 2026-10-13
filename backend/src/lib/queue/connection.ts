import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

type Role = 'producer' | 'worker';

const connections = new Map<Role, Redis>();

const createConnection = (role: Role) => {
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: role === 'worker',
    connectionName: `klyro:${role}`,
  });
  connection.on('error', (err) => logger.error({ err, role }, 'queue redis error'));
  return connection;
};

export const queueConnection = (role: Role) => {
  let connection = connections.get(role);
  if (!connection) {
    connection = createConnection(role);
    connections.set(role, connection);
  }
  return connection;
};

export const closeQueueConnections = async () => {
  const open = [...connections.values()].filter((connection) => connection.status !== 'end');
  for (const connection of open) if (connection.status !== 'ready') connection.disconnect();
  await Promise.all(open.filter((c) => c.status === 'ready').map((c) => c.quit()));
};
