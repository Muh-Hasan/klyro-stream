import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
};
const CONCURRENCY = 4;
const PRESIGN_BATCH = 32;
const MAX_ATTEMPTS = 4;
const STATE_DIR = path.resolve('.upload-state');

type Part = { partNumber: number; etag: string };
type Plan = { videoId: string; partSize: number; partCount: number };
type Progress = {
  partSize: number;
  partCount: number;
  uploadedBytes: number;
  uploaded: (Part & { size: number })[];
  missing: number[];
};

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    club: { type: 'string' },
    title: { type: 'string' },
    api: { type: 'string', default: process.env.API_URL ?? 'http://localhost:4000' },
    email: { type: 'string', default: process.env.KLYRO_EMAIL },
  },
});

const say = (message: string) => process.stdout.write(`${message}\n`);

const fail = (message: string): never => {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
};

const file = positionals[0] ? path.resolve(positionals[0]) : undefined;
const usage =
  'usage: npm run upload -- <file> --club <clubId> [--title "…"] [--email you@x.com]\n' +
  '       password is read from KLYRO_PASSWORD';
if (!file || !values.club) fail(usage);
const password = process.env.KLYRO_PASSWORD ?? fail('KLYRO_PASSWORD is not set\n' + usage);
const email = values.email ?? fail('pass --email or set KLYRO_EMAIL\n' + usage);
const contentType =
  CONTENT_TYPES[path.extname(file!).toLowerCase()] ??
  fail('only .mp4, .mov and .avi are supported');

let token = '';
let refreshCookie = '';

const authenticate = async (route: '/auth/login' | '/auth/refresh') => {
  const res = await fetch(`${values.api}${route}`, {
    method: 'POST',
    headers:
      route === '/auth/login' ? { 'content-type': 'application/json' } : { cookie: refreshCookie },
    body: route === '/auth/login' ? JSON.stringify({ email, password }) : undefined,
  });
  if (!res.ok) {
    const reason = res.status === 429 ? 'too many login attempts, try again later' : res.statusText;
    throw new ApiError(res.status, 'AUTH_FAILED', `${route} failed: ${reason}`);
  }
  token = ((await res.json()) as { accessToken: string }).accessToken;
  const rt = res.headers.getSetCookie().find((c) => c.startsWith('rt='));
  if (rt) refreshCookie = rt.split(';')[0] ?? '';
};

const login = () => authenticate('/auth/login');

const renew = async () => {
  try {
    await authenticate('/auth/refresh');
  } catch {
    await login();
  }
};

const api = async <T>(
  method: string,
  route: string,
  body?: unknown,
  retried = false,
): Promise<T> => {
  const res = await fetch(`${values.api}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) {
    await renew();
    return api(method, route, body, true);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as T & { error?: { code: string; message: string } };
  if (!res.ok)
    throw new ApiError(res.status, json.error?.code ?? 'UNKNOWN', json.error?.message ?? '');
  return json;
};

const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const progressBar = (total: number, alreadyDone: number) => {
  let done = alreadyDone;
  let sent = 0;
  const started = Date.now();
  const draw = () => {
    const ratio = total ? done / total : 1;
    const filled = Math.round(ratio * 30);
    const seconds = (Date.now() - started) / 1000;
    const speed = seconds > 0 ? sent / seconds : 0;
    process.stdout.write(
      `\r[${'#'.repeat(filled)}${'.'.repeat(30 - filled)}] ${(ratio * 100).toFixed(1).padStart(5)}%  ` +
        `${formatMB(done)} / ${formatMB(total)}  ${formatMB(speed)}/s   `,
    );
  };
  draw();
  return {
    add: (bytes: number) => {
      done += bytes;
      sent += bytes;
      draw();
    },
    finish: () => process.stdout.write('\n'),
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const putPart = async (url: string, body: Buffer): Promise<string> => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method: 'PUT', body });
      const etag = res.headers.get('etag');
      if (res.ok && etag) return etag;
      throw new Error(`storage answered ${res.status}`);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }
};

const main = async () => {
  const info = await stat(file!);
  const fingerprint = createHash('sha256')
    .update(`${file}|${info.size}|${info.mtimeMs}`)
    .digest('hex')
    .slice(0, 16);
  const stateFile = path.join(STATE_DIR, `${fingerprint}.json`);

  await login();

  let plan: Plan | undefined;
  let progress: Progress | undefined;
  const saved = await readFile(stateFile, 'utf8').catch(() => undefined);
  if (saved) {
    plan = JSON.parse(saved) as Plan;
    try {
      progress = await api<Progress>('GET', `/videos/${plan.videoId}/upload/parts`);
      say(
        `resuming ${plan.videoId}: ${progress.uploaded.length}/${progress.partCount} parts already stored`,
      );
    } catch (err) {
      if (!(err instanceof ApiError) || ![404, 409].includes(err.status)) throw err;
      say(`previous upload ${plan.videoId} is gone (${err.code}), starting over`);
      plan = undefined;
    }
  }

  if (!plan) {
    plan = await api<Plan>('POST', `/clubs/${values.club}/videos/uploads`, {
      title: values.title ?? path.parse(file!).name,
      contentType,
      sizeBytes: info.size,
    });
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(stateFile, JSON.stringify(plan));
    say(
      `started ${plan.videoId}: ${plan.partCount} parts of ${formatMB(plan.partSize)}, ${CONCURRENCY} at a time`,
    );
    progress = {
      partSize: plan.partSize,
      partCount: plan.partCount,
      uploadedBytes: 0,
      uploaded: [],
      missing: Array.from({ length: plan.partCount }, (_, i) => i + 1),
    };
  }

  const { videoId, partSize } = plan;
  const receipts = new Map<number, string>(progress!.uploaded.map((p) => [p.partNumber, p.etag]));
  const bar = progressBar(info.size, progress!.uploadedBytes);
  const handle = await open(file!, 'r');

  process.on('SIGINT', () => {
    bar.finish();
    say('interrupted - run the same command again to resume');
    process.exit(130);
  });

  try {
    const missing = [...progress!.missing];
    while (missing.length > 0) {
      const batch = missing.splice(0, PRESIGN_BATCH);
      const { parts } = await api<{ parts: { partNumber: number; url: string }[] }>(
        'POST',
        `/videos/${videoId}/upload/parts`,
        { partNumbers: batch },
      );
      const queue = [...parts];
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const start = (next.partNumber - 1) * partSize;
          const length = Math.min(partSize, info.size - start);
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, start);
          receipts.set(next.partNumber, await putPart(next.url, buffer));
          bar.add(length);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    }
  } finally {
    await handle.close();
  }
  bar.finish();

  const parts: Part[] = [...receipts].map(([partNumber, etag]) => ({ partNumber, etag }));
  const result = await api<{ status: string }>('POST', `/videos/${videoId}/upload/complete`, {
    parts,
  });
  await rm(stateFile, { force: true });
  say(`done: video ${videoId} is ${result.status}`);
};

main().catch((err: unknown) => {
  const message =
    err instanceof ApiError
      ? `API ${err.status} ${err.code}: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  process.stderr.write(`\n${message}\n`);
  process.exitCode = 1;
});
