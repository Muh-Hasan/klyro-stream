import type { Job, Worker } from 'bullmq';
import { Counter, Gauge, Histogram } from 'prom-client';
import { registry } from '../lib/metrics/registry.js';
import { notificationQueue, VIDEO_QUEUE, videoQueue } from '../lib/queue/queues.js';
import { logger } from '../utils/logger.js';

const DEPTH_STATES = ['waiting', 'prioritized', 'active', 'delayed', 'failed'] as const;

const jobsTotal = new Counter({
  name: 'queue_jobs_total',
  help: 'Jobs finished by this worker, by queue and outcome (completed, retried, failed)',
  labelNames: ['queue', 'status'] as const,
  registers: [registry],
});

const activeJobs = new Gauge({
  name: 'queue_active_jobs',
  help: 'Jobs this worker process is running right now',
  labelNames: ['queue'] as const,
  registers: [registry],
});

const processingDuration = new Histogram({
  name: 'video_processing_duration_seconds',
  help: 'Duration of one transcode attempt, by outcome',
  labelNames: ['status'] as const,
  buckets: [5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800],
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Jobs in each queue by state, read from Redis on every scrape',
  labelNames: ['queue', 'state'] as const,
  registers: [registry],
  async collect() {
    for (const queue of [videoQueue, notificationQueue]) {
      try {
        const counts = await queue.getJobCounts(...DEPTH_STATES);
        for (const state of DEPTH_STATES) {
          this.set({ queue: queue.name, state }, counts[state] ?? 0);
        }
      } catch (err) {
        logger.warn({ err, queue: queue.name }, 'could not read queue depth');
      }
    }
  },
});

const seconds = (job: Job) => (Date.now() - (job.processedOn ?? Date.now())) / 1000;

const isFinal = (job: Job) => job.attemptsMade >= (job.opts.attempts ?? 1);

export const instrument = (worker: Worker) => {
  const queue = worker.name;
  worker.on('active', () => activeJobs.inc({ queue }));
  worker.on('completed', (job) => {
    activeJobs.dec({ queue });
    jobsTotal.inc({ queue, status: 'completed' });
    if (queue === VIDEO_QUEUE) processingDuration.observe({ status: 'completed' }, seconds(job));
  });
  worker.on('failed', (job) => {
    activeJobs.dec({ queue });
    if (!job) return;
    const status = isFinal(job) ? 'failed' : 'retried';
    jobsTotal.inc({ queue, status });
    if (queue === VIDEO_QUEUE) processingDuration.observe({ status }, seconds(job));
  });
};
