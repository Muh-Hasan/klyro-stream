import type { Job } from 'bullmq';
import { sendMail } from '../lib/mail/mailer.js';
import type { EmailJob } from '../lib/queue/queues.js';
import { logger } from '../utils/logger.js';

export const processEmail = async (job: Job<EmailJob>) => {
  const log = logger.child({ jobId: job.id, attempt: job.attemptsMade + 1 });
  try {
    await sendMail(job.data);
  } catch (err) {
    log.warn({ err }, 'email not sent, will retry');
    throw err;
  }
  log.info({ subject: job.data.subject }, 'email sent');
};
