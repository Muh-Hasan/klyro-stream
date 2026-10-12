import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

type Role = 'producer' | 'worker';

const createConnection = (role: Role) => {
  const connection = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableOfflineQueue: role === 'worker',
    connectionName: `klyro:${role}`,
  });
  connection.on('error', (err) => logger.error({ err, role }, 'queue redis error'));
  return connection;
};

export const producerConnection = createConnection('producer');
export const workerConnection = createConnection('worker');

export const closeQueueConnections = async () => {
  const open = [producerConnection, workerConnection].filter(
    (connection) => connection.status !== 'wait' && connection.status !== 'end',
  );
  for (const connection of open) if (connection.status !== 'ready') connection.disconnect();
  await Promise.all(open.filter((c) => c.status === 'ready').map((c) => c.quit()));
};
