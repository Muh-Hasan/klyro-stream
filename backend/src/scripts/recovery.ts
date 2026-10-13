import { parseArgs } from 'node:util';
import { closeDb } from '../lib/db/client.js';
import { closeQueueConnections } from '../lib/queue/connection.js';
import { closeQueues } from '../lib/queue/queues.js';
import { closeRedis } from '../lib/redis/client.js';
import { logger } from '../utils/logger.js';

export const parseRecoveryArgs = (ageOption: string, defaultAge: number, unitMs: number) => {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      club: { type: 'string' },
      [ageOption]: { type: 'string', default: String(defaultAge) },
    },
  });
  const age = Number(values[ageOption]);
  if (!Number.isFinite(age) || age < 0) throw new Error(`--${ageOption} must be a number ≥ 0`);
  return {
    dryRun: values['dry-run'] === true,
    clubId: typeof values.club === 'string' ? values.club : undefined,
    olderThan: new Date(Date.now() - age * unitMs),
  };
};

export const runRecovery = async (name: string, task: () => Promise<{ action: string }[]>) => {
  try {
    const results = await task();
    for (const result of results) logger.info(result, name);
    const counts: Record<string, number> = {};
    for (const { action } of results) counts[action] = (counts[action] ?? 0) + 1;
    logger.info({ total: results.length, ...counts }, `${name} done`);
  } catch (err) {
    logger.error({ err }, `${name} failed`);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([
      closeQueues().finally(closeQueueConnections),
      closeDb(),
      closeRedis(),
    ]);
  }
};
