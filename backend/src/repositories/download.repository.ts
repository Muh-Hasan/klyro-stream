import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../lib/db/client.js';
import { downloadLogs, downloadQuotas } from '../lib/db/schema.js';

export type DownloadRecord = { clubId: string; videoId: string; userId: string };

export const consumeQuotaAndLog = (record: DownloadRecord) =>
  db.transaction(async (tx) => {
    const [quota] = await tx
      .update(downloadQuotas)
      .set({ usedCount: sql`${downloadQuotas.usedCount} + 1` })
      .where(
        and(
          eq(downloadQuotas.clubId, record.clubId),
          lt(downloadQuotas.usedCount, downloadQuotas.quotaLimit),
        ),
      )
      .returning({ limit: downloadQuotas.quotaLimit, used: downloadQuotas.usedCount });
    if (!quota) return undefined;

    await tx.insert(downloadLogs).values(record);
    return quota;
  });
