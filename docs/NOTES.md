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
