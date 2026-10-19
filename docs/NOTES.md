# Notes

Short notes per sprint: what surprised me, what I decided and why, and the numbers. The detailed explanations live in [docs/learning](learning/).

## Sprint 6: transcoding

**Surprise:** decoding, not encoding, dominated. Just decoding the 4K H.264 sample takes ~30 s of a 46 s run, which is why one FFmpeg run that decodes once and feeds three encoders beat three separate runs (one per rendition) by 2.7–3×. It's also why splitting renditions into BullMQ Flow children would have made things slower on one machine.

**Decision:** one job, one FFmpeg run, plus a single checkpoint after the upload (`job.updateData({ output })`), so a retry after a failed READY update skips the transcode. Flows stay for multi-machine chunked encoding later. On SIGTERM the worker kills FFmpeg and returns the job to `wait` (`moveToWait` + `WaitingError`), so a deploy never burns a retry.

**Hardest bugs:**

- `bytes += await upload()` under concurrency lost updates: it reported 12.2 MB uploaded for a 36.7 MB folder. `a += await b` reads `a` before the await.
- A Postgres error used as `error_message` leaked the full SQL and parameters to users. Only `UnrecoverableError` messages are shown now.
- Without forced keyframes, `-hls_time 6` produced 10 s segments (x264's default GOP of 250 frames at 25 fps).

### Processing time

Worker container (FFmpeg 5.1, `-preset veryfast`), Windows host, 8 cores, one job at a time.

| Source | Size | Length | Transcode | Total job | Real-time factor | Per GB |
|---|---|---|---|---|---|---|
| 4K H.264, 60 Mbps | 239 MB | 31.9 s | 35–37 s | ~42 s | 1.3× the video length | ~3 min/GB |
| 1080p H.264, ~20 Mbps | 298 MB | 120 s | 127 s | 133 s | 1.1× | ~7.5 min/GB |

"Per GB" depends heavily on the source bitrate: the 1080p file has 4× more seconds per byte than the 4K one. **Time relative to the video's length** is the steadier number: about 1–1.3× real time for these sources.

Per stage (4K sample): download 1.3–2.7 s · probe 1.1 s · transcode 35–37 s · thumbnail 1.3–1.6 s · upload 0.4–0.5 s.

Output: 32 s of 4K (239 MB) → 36 MB of HLS across three renditions (15% of the source).

### Single job vs Flow, measured

| Approach | Time for the 4K sample |
|---|---|
| One FFmpeg run, `split=3` | 46 s |
| Three runs one after another (Flow, 1 slot) | 139 s |
| Three runs at the same time (Flow, 3 slots, one machine) | 123 s |

### Playback (hls.js, `npm run videos:play`)

- Throttled to 1.5 Mbps: the first 720p segment took 11.6 s for 6 s of video; hls.js dropped to 480p.
- Throttle removed: within ~0.5 s it fetched 720p from segment 12 and 1080p from segment 14, re-fetching segment 14 at the higher quality.
- At 1.5 Mbps even 480p (peak 1.65 Mbps) briefly stalled. A 360p rung (~800 kbps) would cover slow mobile connections; worth adding.
- hls.js buffers up to 60 MB ahead (~90 s of 1080p), so a throttle applied mid-playback only shows after that buffer drains.

## Sprint 7: library, playback and downloads

**Surprise:** in my measurement, the "obvious" quota code granted **20 downloads against a limit of 5**, and its counter read 2. Read-check-write lost every concurrent update. Writing `used = used + 1` fixed the counter but still granted 13–14, because the decision was made from a stale read. Only a single `UPDATE … WHERE used < limit RETURNING` (or `FOR UPDATE`) gave exactly 5. Through the real endpoint: 20 parallel requests with 5 left gave 5 × 200 and 15 × 403.

**Decisions:**

- **Playlists through the API, segments straight from storage.** Signing only `master.m3u8` can't work: a presigned URL covers one key, and the player then asks for unsigned children. The API rewrites variant lines to relative API routes and segment lines to 5-minute presigned URLs.
- **5-minute segment URLs plus a player refresh, not long-lived URLs.** VOD playlists are read once, so URLs expire mid-playback. The dev player retries a 403 after swapping fresh URLs into hls.js's fragments. Playback continues with no rewind. Signing for the whole video length would make leaked links last hours.
- **Delete order:** abort the upload, remove the job (atomic in Redis; 409 if a worker holds it), delete objects 1,000 at a time, then the row last, so a failure can be retried and nothing is orphaned.
- **Quota raised only by the operator** (Basic auth under `/admin`), never by a club admin. Download history keeps its rows when a video is deleted (`video_id` → NULL, `club_id` kept).

**Hardest bugs:**

- The validation middleware dropped Zod's `formErrors`, so whole-body errors (a `refine` on `{}`, a body of `[]`) came back as `"body": {}` on every route.
- Adding the quota endpoint under `/admin` made the admin rate limiter count 400s and 404s. An operator's typos would have locked them out of Bull Board too. Now only 401s count.
- `DeleteObjects` returns 200 even when keys fail, listing them in `Errors`, which the old cleanup ignored.
- Drizzle generated `ADD COLUMN club_id uuid NOT NULL`, which fails on any non-empty table. It was rewritten as add, backfill, set NOT NULL, and proven in a rolled-back transaction first.

### Numbers

| What | Measured |
|---|---|
| List page 1 of 50k rows | Index Scan Backward on `videos_club_created_idx`, 21 rows read |
| List page 40 (`OFFSET 780`) | bitmap scan + sort of 800 rows, 1.94 ms |
| Variant playlist, 20 segments | 39 ms for the whole request |
| Signing 1,200 segment URLs (a 2-hour rendition) | 525–916 ms, ~0.45 ms each |
| Delete a video with 2,500 HLS objects | 8.2 s (3 list + 3 `DeleteObjects` calls, in sequence) |
| 20 parallel downloads, 5 left | 5 × 200, 15 × 403, 285 ms |

**Local vs real S3:** RustFS accepts a presigned URL that also carries `Authorization: Bearer`; AWS S3 rejects it (two auth mechanisms). The player sends the token only to API URLs.
