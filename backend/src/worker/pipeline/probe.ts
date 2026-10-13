import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';

const exec = promisify(execFile);

const PROBE_ARGS = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams'];

const probeOutput = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      duration: z.coerce.number().optional(),
      side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional(),
    }),
  ),
  format: z.object({ duration: z.coerce.number().optional() }),
});

export type ProbeResult = {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
  videoCodec: string;
};

const isMissingBinary = (err: unknown) =>
  err instanceof Error && 'code' in err && err.code === 'ENOENT';

const runProbe = async (filePath: string, signal?: AbortSignal) => {
  try {
    const { stdout } = await exec('ffprobe', [...PROBE_ARGS, path.basename(filePath)], {
      cwd: path.dirname(filePath),
      signal,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    if (isMissingBinary(err) || signal?.aborted) throw err;
    const stderr = err instanceof Error && 'stderr' in err ? String(err.stderr) : '';
    const reason = stderr
      .trim()
      .replaceAll(/\s*\n\s*/g, ' ')
      .slice(-300);
    throw new UnrecoverableError(`ffprobe could not read the file: ${reason}`);
  }
};

export const probe = async (filePath: string, signal?: AbortSignal): Promise<ProbeResult> => {
  const parsed = probeOutput.safeParse(JSON.parse(await runProbe(filePath, signal)));
  if (!parsed.success) throw new UnrecoverableError('ffprobe returned unexpected output');
  const { streams, format } = parsed.data;

  const video = streams.find((s) => s.codec_type === 'video' && s.width && s.height);
  if (!video?.width || !video.height) throw new UnrecoverableError('File has no video stream');

  const durationSeconds = format.duration ?? video.duration;
  if (!durationSeconds || durationSeconds <= 0) {
    throw new UnrecoverableError('Could not read the video duration');
  }

  const rotation = Math.abs(
    video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0,
  );
  const sideways = rotation === 90 || rotation === 270;

  return {
    durationSeconds,
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    videoCodec: video.codec_name ?? 'unknown',
  };
};
