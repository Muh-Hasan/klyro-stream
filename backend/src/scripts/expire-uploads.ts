import { expireAbandonedUploads } from '../services/video-recovery.service.js';
import { parseRecoveryArgs, runRecovery } from './recovery.js';

const options = parseRecoveryArgs('older-than-hours', 24, 3_600_000);
await runRecovery(options.dryRun ? 'expire-uploads (dry run)' : 'expire-uploads', () =>
  expireAbandonedUploads(options),
);
