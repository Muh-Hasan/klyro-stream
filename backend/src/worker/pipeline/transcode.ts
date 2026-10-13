import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { UnrecoverableError } from 'bullmq';
import type { ProbeResult } from './probe.js';

export const SEGMENT_SECONDS = 6;

const LADDER = [
  { name: '1080p', shortSide: 1080, videoKbps: 5000, audioKbps: 128 },
  { name: '720p', shortSide: 720, videoKbps: 2800, audioKbps: 128 },
  { name: '480p', shortSide: 480, videoKbps: 1400, audioKbps: 96 },
] as const;

export type Rendition = {
  name: string;
  width: number;
  height: number;
  videoKbps: number;
  audioKbps: number;
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export const planRenditions = ({ width, height }: Pick<ProbeResult, 'width' | 'height'>) => {
  const shortSide = Math.min(width, height);
  const fits = LADDER.filter((rung) => rung.shortSide <= shortSide);
  const rungs = fits.length > 0 ? fits : [{ ...LADDER[2], name: `${even(shortSide)}p`, shortSide }];

  return rungs.map((rung): Rendition => {
    const scale = rung.shortSide / shortSide;
    return {
      name: rung.name,
      width: even(width * scale),
      height: even(height * scale),
      videoKbps: rung.videoKbps,
      audioKbps: rung.audioKbps,
    };
  });
};

export const buildHlsArgs = (source: string, renditions: Rendition[], hasAudio: boolean) => {
  const n = renditions.length;
  const split = `[0:v]split=${n}${renditions.map((_, i) => `[v${i}]`).join('')}`;
  const scales = renditions.map((r, i) => `[v${i}]scale=${r.width}:${r.height}[o${i}]`);

  const maps = renditions.flatMap((_, i) => [
    '-map',
    `[o${i}]`,
    ...(hasAudio ? ['-map', '0:a:0'] : []),
  ]);

  const rates = renditions.flatMap((r, i) => [
    `-b:v:${i}`,
    `${r.videoKbps}k`,
    `-maxrate:v:${i}`,
    `${Math.round(r.videoKbps * 1.07)}k`,
    `-bufsize:v:${i}`,
    `${r.videoKbps * 2}k`,
    ...(hasAudio ? [`-b:a:${i}`, `${r.audioKbps}k`] : []),
  ]);

  const streamMap = renditions
    .map((r, i) => (hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`))
    .join(' ');

  return [
    '-y',
    '-i',
    source,
    '-filter_complex',
    [split, ...scales].join(';'),
    ...maps,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-force_key_frames',
    `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
    '-sc_threshold',
    '0',
    ...(hasAudio ? ['-c:a', 'aac', '-ac', '2'] : []),
    ...rates,
    '-f',
    'hls',
    '-hls_time',
    String(SEGMENT_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    '%v/seg_%03d.ts',
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    streamMap,
    '%v/index.m3u8',
  ];
};

const STDERR_TAIL_BYTES = 2_000;
const BAD_INPUT =
  /Invalid data found when processing input|moov atom not found|could not find codec/i;

type RunOptions = {
  cwd: string;
  durationSeconds: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

export const runFfmpeg = (
  args: string[],
  { cwd, durationSeconds, onProgress, signal }: RunOptions,
) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-hide_banner', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1', ...args],
      { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES);
    });

    let pending = '';
    let lastPercent = -1;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const [key, value] = line.trim().split('=');
        if (key !== 'out_time_us' || !onProgress) continue;
        const fraction = Math.min(1, Math.max(0, Number(value) / (durationSeconds * 1e6)));
        const percent = Math.floor(fraction * 100);
        if (Number.isFinite(fraction) && percent > lastPercent) {
          lastPercent = percent;
          onProgress(fraction);
        }
      }
    });

    child.once('error', reject);
    child.once('close', (code, killedBy) => {
      if (code === 0) return resolve();
      if (signal?.aborted) return reject(new Error('FFmpeg was stopped'));
      const reason = stderr
        .trim()
        .replaceAll(/\s*\n\s*/g, ' ')
        .slice(-500);
      const message = `FFmpeg exited with ${killedBy ?? `code ${code}`}: ${reason}`;
      reject(BAD_INPUT.test(stderr) ? new UnrecoverableError(message) : new Error(message));
    });
  });

export const transcodeHls = async (
  source: string,
  outDir: string,
  meta: ProbeResult,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
) => {
  const renditions = planRenditions(meta);
  await mkdir(outDir, { recursive: true });
  await runFfmpeg(buildHlsArgs(source, renditions, meta.hasAudio), {
    cwd: outDir,
    durationSeconds: meta.durationSeconds,
    onProgress,
    signal,
  });
  return renditions;
};
