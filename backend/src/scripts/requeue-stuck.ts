import { requeueStuckVideos } from '../services/video-recovery.service.js';
import { parseRecoveryArgs, runRecovery } from './recovery.js';

const options = parseRecoveryArgs('min-age-minutes', 10, 60_000);
await runRecovery(options.dryRun ? 'requeue-stuck (dry run)' : 'requeue-stuck', () =>
  requeueStuckVideos(options),
);
