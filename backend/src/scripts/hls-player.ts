import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { closeDb } from '../lib/db/client.js';
import { BUCKETS } from '../lib/storage/client.js';
import { storageErrorName } from '../lib/storage/multipart.js';
import { openObject } from '../lib/storage/objects.js';
import * as videoRepo from '../repositories/video.repository.js';
import { logger } from '../utils/logger.js';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4100' },
    kbps: { type: 'string', default: '0' },
    api: { type: 'string', default: 'http://localhost:4000' },
  },
});
const port = Number(values.port);
let kbps = Number(values.kbps);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const HLS_ROUTE = new RegExp(`^/hls/(${UUID})/((?:[\\w-]+/)?[\\w-]+\\.(?:m3u8|ts))$`);
const THUMB_ROUTE = new RegExp(`^/thumb/(${UUID})\\.jpg$`);
const WATCH_ROUTE = new RegExp(`^/watch/(${UUID})$`);
const SPEEDS = [0, 8000, 3000, 1500, 800];
const LOCAL_ORIGIN = /^http:\/\/localhost:\d{2,5}$/;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const throttle = (limitKbps: number) =>
  new Transform({
    transform(chunk: Buffer, _encoding, done) {
      if (!limitKbps) return done(null, chunk);
      setTimeout(() => done(null, chunk), (chunk.length * 8) / limitKbps);
    },
  });

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:960px;padding:16px;background:#111;color:#eee}
a{color:#8cf}video{width:100%;background:#000;border-radius:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.card img{width:100%;border-radius:6px;display:block}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}
button{background:#222;color:#eee;border:1px solid #444;border-radius:4px;padding:4px 10px;cursor:pointer}
button.on{background:#2e7d32;border-color:#2e7d32}
.stat{font:600 18px ui-monospace,monospace}
#log{font:13px ui-monospace,monospace;background:#000;padding:8px;border-radius:6px;height:220px;overflow:auto;white-space:pre}
</style></head><body>${body}</body></html>`;

const listPage = async () => {
  const videos = (await videoRepo.findByStatus('READY', 50)).filter((v) => v.hlsPath);
  const cards = videos
    .map(
      (v) => `<div class="card"><a href="/watch/${v.id}"><img src="/thumb/${v.id}.jpg" alt="">
<div>${escapeHtml(v.title)} · ${v.durationSeconds ?? '?'} s</div></a>
<a href="/watch/${v.id}?api=${encodeURIComponent(values.api)}">play through the API</a></div>`,
    )
    .join('');
  return page(
    'KlyroStream player',
    `<h1>READY videos</h1><div class="grid">${cards || 'No READY videos yet.'}</div>`,
  );
};

const watchPage = (videoId: string, title: string, api: string | null) =>
  page(
    title,
    `<p><a href="/">← all videos</a></p><h1>${escapeHtml(title)}</h1>
${
  api
    ? `<div class="bar">API mode: ${escapeHtml(api)} · access token
<input id="token" type="password" size="40" autocomplete="off"><button id="play">Play</button></div>`
    : ''
}
<video id="v" controls muted autoplay playsinline></video>
<div class="bar">Quality: <span class="stat" id="level">–</span> · estimate <span class="stat" id="bw">–</span></div>
<div class="bar" id="levels"><button data-level="-1" class="on">Auto</button></div>
<div class="bar" id="speeds">Network: ${SPEEDS.map(
      (s) =>
        `<button data-kbps="${s}" class="${s === kbps ? 'on' : ''}">${s ? `${s / 1000} Mbps` : 'unlimited'}</button>`,
    ).join('')}</div>
<div id="log"></div>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
<script>
const video = document.getElementById('v');
const logBox = document.getElementById('log');
const started = performance.now();
const log = (msg) => {
  logBox.textContent += ((performance.now() - started) / 1000).toFixed(1).padStart(6) + 's  ' + msg + '\\n';
  logBox.scrollTop = logBox.scrollHeight;
};
const mark = (bar, attr, value) =>
  bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset[attr] === String(value)));
const API = ${JSON.stringify(api)};
const src = API ? API + '/videos/${videoId}/stream/master.m3u8' : '/hls/${videoId}/master.m3u8';
const tokenBox = document.getElementById('token');
const bearer = () => 'Bearer ' + tokenBox.value.trim();
const fragPolicy = Hls.DefaultConfig.fragLoadPolicy.default;
const hls = new Hls({
  xhrSetup: (xhr, url) => {
    if (API && url.startsWith(API + '/')) xhr.setRequestHeader('Authorization', bearer());
  },
  fragLoadPolicy: {
    default: {
      ...fragPolicy,
      errorRetry: {
        ...fragPolicy.errorRetry,
        retryDelayMs: 300,
        shouldRetry: (config, count, timeout, response, retry) =>
          retry || Boolean(API && response && response.code === 403 && count < 3),
      },
    },
  },
});
window.hls = hls;
const start = () => {
  hls.loadSource(src);
  hls.attachMedia(video);
};
if (API) document.getElementById('play').addEventListener('click', start);
else start();
const refreshing = new Map();
const refreshSegmentUrls = (index) => {
  if (refreshing.has(index)) return;
  const level = hls.levels[index];
  const job = fetch(level.uri, { headers: { Authorization: bearer() } })
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error('playlist ' + res.status))))
    .then((text) => {
      const urls = text.split('\\n').filter((line) => line && !line.startsWith('#'));
      level.details.fragments.forEach((frag, i) => (frag.url = urls[i]));
      log('fresh segment URLs for ' + level.height + 'p (' + urls.length + ' segments)');
    })
    .catch((err) => log('could not refresh ' + level.height + 'p: ' + err.message))
    .finally(() => refreshing.delete(index));
  refreshing.set(index, job);
};
let levelsShown = false;
hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
  if (levelsShown) return;
  levelsShown = true;
  const bar = document.getElementById('levels');
  data.levels.forEach((l, i) => {
    const b = document.createElement('button');
    b.dataset.level = i;
    b.textContent = l.height + 'p';
    bar.appendChild(b);
  });
  log('manifest: ' + data.levels.map((l) => l.height + 'p @ ' + Math.round(l.bitrate / 1000) + ' kbps').join(', '));
});
hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
  const l = hls.levels[data.level];
  document.getElementById('level').textContent = l.height + 'p';
  log('switched to ' + l.height + 'p');
});
hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
  const ms = data.frag.stats.loading.end - data.frag.stats.loading.start;
  document.getElementById('bw').textContent = Math.round(hls.bandwidthEstimate / 1000) + ' kbps';
  log('segment ' + data.frag.sn + ' @ ' + hls.levels[data.frag.level].height + 'p, ' +
    (data.frag.stats.total / 1e6).toFixed(2) + ' MB in ' + Math.round(ms) + ' ms');
});
hls.on(Hls.Events.ERROR, (_, data) => {
  const status = data.response && data.response.code;
  log('error: ' + data.details + (status ? ' ' + status : '') + (data.fatal ? ' (fatal)' : ''));
  if (API && data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR && status === 403) {
    refreshSegmentUrls(data.frag.level);
  }
});
document.getElementById('levels').addEventListener('click', (e) => {
  const level = e.target.dataset && e.target.dataset.level;
  if (level === undefined) return;
  hls.currentLevel = Number(level);
  mark(e.currentTarget, 'level', level);
  log(level === '-1' ? 'quality: auto' : 'quality forced: ' + hls.levels[level].height + 'p');
});
document.getElementById('speeds').addEventListener('click', async (e) => {
  const bar = e.currentTarget;
  const value = e.target.dataset && e.target.dataset.kbps;
  if (value === undefined) return;
  await fetch('/throttle?kbps=' + value, { method: 'POST' });
  mark(bar, 'kbps', value);
  log('network: ' + (value === '0' ? 'unlimited' : value + ' kbps'));
});
</script>`,
  );

const sendObject = async (
  req: IncomingMessage,
  res: ServerResponse,
  bucket: string,
  key: string,
  limitKbps = 0,
) => {
  const controller = new AbortController();
  req.once('close', () => controller.abort());
  const object = await openObject(bucket, key, controller.signal);
  res.writeHead(200, {
    'Content-Type': object.contentType ?? 'application/octet-stream',
    ...(object.contentLength !== undefined && { 'Content-Length': object.contentLength }),
    'Cache-Control': 'no-store',
  });
  await pipeline(object.body, throttle(limitKbps), res).catch(() => undefined);
};

const route = async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/throttle') {
    kbps = Math.max(0, Number(url.searchParams.get('kbps')) || 0);
    logger.info({ kbps }, 'throttle changed');
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(await listPage());
    return;
  }

  const watch = WATCH_ROUTE.exec(url.pathname);
  if (watch?.[1]) {
    const video = await videoRepo.findById(watch[1]);
    if (!video || video.status !== 'READY' || !video.hlsPath) {
      res.writeHead(404).end('Video not found or not READY');
      return;
    }
    const api = url.searchParams.get('api');
    res
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(watchPage(video.id, video.title, api && LOCAL_ORIGIN.test(api) ? api : null));
    return;
  }

  const hls = HLS_ROUTE.exec(url.pathname);
  if (hls?.[1] && hls[2]) {
    await sendObject(req, res, BUCKETS.hls, `${hls[1]}/${hls[2]}`, kbps);
    return;
  }

  const thumb = THUMB_ROUTE.exec(url.pathname);
  if (thumb?.[1]) {
    await sendObject(req, res, BUCKETS.thumbnails, `${thumb[1]}.jpg`);
    return;
  }

  res.writeHead(404).end('Not found');
};

const server = createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    const missing = storageErrorName(err) === 'NoSuchKey';
    if (!missing) logger.error({ err, url: req.url }, 'player request failed');
    if (!res.headersSent) res.writeHead(missing ? 404 : 500).end();
  });
});

server.listen(port, '127.0.0.1', () => {
  logger.info({ url: `http://localhost:${port}`, kbps }, 'HLS dev player ready');
});

const stop = () => {
  server.close();
  void closeDb().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
