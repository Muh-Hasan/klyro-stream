# Transcoding and HLS

Sprint 6 turns the raw upload into something every viewer can play. This guide explains what we produce (HLS), why it's shaped the way it is, the FFmpeg command that builds it, and how the work fits into a BullMQ job.

The numbers below were **measured on this project**: the 4K sample in `bruno/videos/fixtures/`, FFmpeg 9 on Windows, 8 cores, `-preset veryfast`.

Related: [queues.md](queues.md) (jobs, retries, flows) · [uploads.md](uploads.md) (how the raw file got into RustFS) · [NOTES.md](../NOTES.md) (measurements).

**Reviewing Sprint 6?** Read sections 1–9 for the concepts (HLS, the ladder, keyframes, FFmpeg, single job vs Flow vs step job), section 10 for how the pipeline behaves and how it was tested, then [section 11](#11-code-walkthrough-reviewing-sprint-6) with the code open: it goes through every file in reading order and ends with a review checklist.

**Contents**

1. [Why transcode at all](#1-why-transcode-at-all)
2. [HLS: playlists and segments](#2-hls-playlists-and-segments)
3. [How the player picks a quality](#3-how-the-player-picks-a-quality)
4. [The bitrate ladder](#4-the-bitrate-ladder)
5. [Keyframes: why segments need them, and why they must line up](#5-keyframes-why-segments-need-them-and-why-they-must-line-up)
6. [Codecs, containers and the `CODECS` string](#6-codecs-containers-and-the-codecs-string)
7. [The FFmpeg command, piece by piece](#7-the-ffmpeg-command-piece-by-piece)
8. [Probing the input first](#8-probing-the-input-first)
9. [One job or a Flow? Measured](#9-one-job-or-a-flow-measured)
10. [The Sprint 6 pipeline](#10-the-sprint-6-pipeline)
11. [Code walkthrough: reviewing Sprint 6](#11-code-walkthrough-reviewing-sprint-6)
12. [Glossary and further reading](#12-glossary-and-further-reading)

---

## 1. Why transcode at all

The sample upload:

| Property | Value | Problem for viewers |
|---|---|---|
| Resolution | 3840×2160 (4K) | A phone screen shows ~1080 lines at most; the rest is wasted bandwidth |
| Bitrate | 60 Mbps | A typical mobile connection is 5–20 Mbps. The video would stall every few seconds |
| Size | 229 MB for 32 s | ~26 GB per hour of video |
| Format | One MP4 file | The player needs a quality that fits *right now*, and that changes as you walk out of Wi-Fi range |

Serving the original file as-is (a "progressive download") has one quality for everyone. **Adaptive streaming** fixes it: encode several smaller versions, cut each into short pieces, and let the player choose piece by piece.

After transcoding, the same 32 s takes **19 MB at 1080p, 11 MB at 720p and 5.4 MB at 480p**. All three together are 15% of the original.

## 2. HLS: playlists and segments

HLS (HTTP Live Streaming, from Apple) is plain files over plain HTTP. No streaming server is needed: RustFS (or any CDN) just serves files. There are three kinds:

```mermaid
flowchart TB
    M["master.m3u8<br/>(master playlist)<br/>lists the qualities"]
    M --> V1["1080p/index.m3u8<br/>(variant playlist)"]
    M --> V2["720p/index.m3u8"]
    M --> V3["480p/index.m3u8"]
    V1 --> S1["seg_000.ts · seg_001.ts · … (6 s each)"]
    V2 --> S2["seg_000.ts · seg_001.ts · …"]
    V3 --> S3["seg_000.ts · seg_001.ts · …"]
```

These are the real files FFmpeg wrote for the sample.

**The master playlist** (`master.m3u8`) is the menu. One entry per quality:

```text
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=5302853,AVERAGE-BANDWIDTH=4968908,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=3542399,AVERAGE-BANDWIDTH=2816603,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
720p/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=1773599,AVERAGE-BANDWIDTH=1413278,RESOLUTION=854x480,CODECS="avc1.64001e,mp4a.40.2"
480p/index.m3u8
```

| Attribute | Meaning |
|---|---|
| `BANDWIDTH` | **Peak** bits per second of this rendition. The player uses it to decide whether the connection can keep up |
| `AVERAGE-BANDWIDTH` | The average. 4,968,908 ≈ our 5000 kbps target, so the encoder hit it |
| `RESOLUTION` | Lets the player skip renditions bigger than its screen |
| `CODECS` | Lets the player skip renditions it can't decode, before downloading anything ([section 6](#6-codecs-containers-and-the-codecs-string)) |

**A variant playlist** (`720p/index.m3u8`) is the list of pieces for one quality:

```text
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-INDEPENDENT-SEGMENTS
#EXTINF:6.000000,
seg_000.ts
#EXTINF:6.000000,
seg_001.ts
…
#EXTINF:1.880000,
seg_005.ts
#EXT-X-ENDLIST
```

| Tag | Meaning |
|---|---|
| `TARGETDURATION:6` | No segment is longer than 6 s |
| `PLAYLIST-TYPE:VOD` + `ENDLIST` | The list is complete and will never change (video on demand, not live) |
| `INDEPENDENT-SEGMENTS` | Every segment starts with a keyframe, so each one decodes on its own ([section 5](#5-keyframes-why-segments-need-them-and-why-they-must-line-up)) |
| `EXTINF:6.0` | This segment's duration. 31.88 s = 5 × 6 s + 1.88 s |

**Segments** (`seg_000.ts`) are short, self-contained video files. Ours are MPEG-TS (`.ts`), the classic HLS container.

Paths inside playlists are **relative**. The player resolves `720p/index.m3u8` against the master's URL, and `seg_000.ts` against the variant's URL. That's why we upload the folder as-is to `hls-output/<videoId>/` and never rewrite the files.

## 3. How the player picks a quality

The player (hls.js in a browser, AVPlayer on iOS) does all the deciding. The server is dumb on purpose.

```mermaid
sequenceDiagram
    participant P as Player (hls.js)
    participant S as RustFS / CDN
    P->>S: GET master.m3u8
    S-->>P: 3 qualities
    Note over P: No measurement yet:<br/>start low or mid (720p)
    P->>S: GET 720p/index.m3u8
    P->>S: GET 720p/seg_000.ts (2.1 MB)
    S-->>P: arrived in 0.4 s → ~42 Mbps
    Note over P: Plenty of headroom:<br/>switch up at the next boundary
    P->>S: GET 1080p/index.m3u8
    P->>S: GET 1080p/seg_001.ts
    Note over P: Wi-Fi drops,<br/>segment takes 9 s for 6 s of video
    P->>S: GET 480p/seg_002.ts
    Note over P: Buffer refills, no stall
```

The key points:

- The player **measures** throughput from each segment download and keeps a buffer of upcoming video.
- It can switch quality **only at a segment boundary**: segment 2 of 480p continues exactly where segment 1 of 1080p ended. That only works if every rendition's segment N covers **exactly the same time range** and starts with a keyframe. Section 5 is about guaranteeing that.
- Shorter segments switch faster but mean more requests and slightly worse compression. **6 s** is Apple's recommendation and a common default.

## 4. The bitrate ladder

The ladder is the list of renditions we produce:

| Rung | Height | Video kbps | Audio kbps | `maxrate` | `bufsize` |
|---|---|---|---|---|---|
| 1080p | 1080 | 5000 | 128 | 5350 | 10000 |
| 720p | 720 | 2800 | 128 | 2996 | 5600 |
| 480p | 480 | 1400 | 96 | 1498 | 2800 |

These sit inside the ranges in Apple's [HLS authoring spec](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices).

### Bitrate, `maxrate` and `bufsize`

- `-b:v 5000k` is the **average** target.
- Video is bursty: an explosion costs more bits than a still shot. Without limits a 6 s segment could be 3× the average, and a player that chose 1080p based on the average would stall right there.
- `-maxrate 5350k -bufsize 10000k` caps the bursts (this is called VBV, the video buffering verifier). The encoder is allowed to go above average for a while, but never so far that a viewer's buffer would run dry. The measured `BANDWIDTH` (peak) of 5.30 Mbps stayed just under the 5.35 cap.

### Never upscale

The ladder is filtered by the source: only rungs **at or below** the source height.

| Source | Renditions | Why |
|---|---|---|
| 2160p (our sample) | 1080, 720, 480 | Top rung capped at 1080 |
| 720p | 720, 480 | A "1080p" made from 720p has no extra detail, just 1.8× the bytes |
| 360p | one rendition at 360 | Smaller than every rung, so keep its own size |

Upscaling makes the file bigger without making the picture better, and the player would happily pick the wasteful version on a fast connection.

### Portrait video

Phones record portrait: 720 wide × 1280 tall. "720p" really means "the **short side** is 720". If we filtered on height, a portrait 720×1280 clip would get a "1080p" rung, which is an upscale of its short side. So the ladder uses `min(width, height)`, and scaling targets the short side. The probe ([section 8](#8-probing-the-input-first)) already reports the **displayed** width and height after rotation.

## 5. Keyframes: why segments need them, and why they must line up

### Frame types

Compressed video doesn't store every frame as a full picture:

| Frame | Stores | Size | Can be decoded… |
|---|---|---|---|
| **I** (keyframe) | A complete picture | Large | On its own |
| **P** | Only the changes since an earlier frame | Small | Only if the earlier frame was decoded |
| **B** | Changes relative to frames before *and* after | Smallest | Only with both neighbours |

```mermaid
flowchart LR
    I1["I"] --> P1["P"] --> B1["B"] --> P2["P"] --> B2["B"] --> P3["P"] --> I2["I"] --> P4["P"]
    style I1 fill:#2e7d32,color:#fff
    style I2 fill:#2e7d32,color:#fff
```

A **GOP** (group of pictures) is the run from one keyframe to the next. You can only start decoding at a keyframe.

### Why that matters for HLS

1. **Every segment must start with a keyframe.** A player that jumps into `seg_003.ts` (after a seek or a quality switch) has nothing earlier to decode from. A segment that starts with P frames shows garbage or a frozen picture until the next keyframe.
2. **The keyframes must be at the same times in every rendition.** Segment N of 480p must start at the exact moment segment N of 1080p starts, or the switch jumps backward or forward in time.
3. **FFmpeg can only cut a segment at a keyframe.** `-hls_time 6` is a *wish*. The cut happens at the first keyframe after 6 s.

### What happens without forcing keyframes (measured)

Same sample, `-hls_time 6`, but leaving keyframe placement to x264:

```text
default x264 GOP : 10.0, 10.0, 10.0, 1.88       ← asked for 6 s, got 10 s
forced keyframes : 6.0, 6.0, 6.0, 6.0, 6.0, 1.88
```

x264's default is a keyframe every 250 frames, or sooner if it detects a scene cut. At 25 fps that's every 10 s, so the 6 s wish was ignored. Scene-cut keyframes are worse: they land at different times in each rendition, because each rendition is encoded separately and the detector sees slightly different pictures.

### The two flags that fix it

```text
-force_key_frames "expr:gte(t,n_forced*6)"     a keyframe at 0 s, 6 s, 12 s, … by the clock
-sc_threshold 0                                 no extra keyframes on scene cuts
```

- `expr:gte(t,n_forced*6)` means "force a keyframe once the time reaches 6 × the number already forced". It's based on **time**, not frames, so it works for 24, 25, 30 or 60 fps sources without knowing the frame rate. (The alternative, `-g 150`, is frames, and only means 6 s at exactly 25 fps.)
- `-sc_threshold 0` turns the scene-cut detector off, so the only keyframes are the aligned ones.

Measured result: every segment of every rendition starts with an `I` frame, and all three playlists list identical durations (`6, 6, 6, 6, 6, 1.88`).

## 6. Codecs, containers and the `CODECS` string

| Choice | What we use | Why |
|---|---|---|
| Video codec | **H.264** (`libx264`), High profile | Plays everywhere: every browser, phone and TV. HEVC/AV1 compress better but aren't universal yet |
| Pixel format | **`yuv420p`**, 8-bit | Phones increasingly record 10-bit HDR or 4:2:2. Browsers' H.264 decoders only reliably handle 8-bit 4:2:0, so we always convert |
| Audio | **AAC** stereo (`-ac 2`) | The HLS default. A 5.1 source becomes stereo |
| Container | **MPEG-TS** (`.ts`) | The classic HLS segment format, simplest to inspect. fMP4 (`.m4s`) is the modern option, needed for HEVC, and a later improvement |

**The `CODECS` string** lets a player reject a rendition before downloading it:

```text
avc1.640028
│    │ │ └─ level 0x28 = 40 → "4.0", enough for 1080p30
│    │ └─── constraint flags
│    └───── profile 0x64 = 100 → High
└────────── H.264

mp4a.40.2 → AAC-LC audio
```

720p gets level `1f` (3.1) and 480p `1e` (3.0). FFmpeg picks the lowest level that fits each rendition, so older devices can still play the small ones.

## 7. The FFmpeg command, piece by piece

One FFmpeg run makes all renditions:

```text
ffmpeg -y -i source
  -filter_complex "[0:v]split=3[v0][v1][v2];
                   [v0]scale=-2:1080[o0];[v1]scale=-2:720[o1];[v2]scale=-2:480[o2]"
  -map [o0] -map 0:a:0   -map [o1] -map 0:a:0   -map [o2] -map 0:a:0
  -c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p
  -force_key_frames "expr:gte(t,n_forced*6)" -sc_threshold 0
  -b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 10000k -b:a:0 128k
  -b:v:1 2800k -maxrate:v:1 2996k -bufsize:v:1 5600k  -b:a:1 128k
  -b:v:2 1400k -maxrate:v:2 1498k -bufsize:v:2 2800k  -b:a:2 96k
  -c:a aac -ac 2
  -f hls -hls_time 6 -hls_playlist_type vod -hls_flags independent_segments
  -hls_segment_filename "%v/seg_%03d.ts"
  -master_pl_name master.m3u8
  -var_stream_map "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p"
  "%v/index.m3u8"
```

```mermaid
flowchart LR
    SRC["source<br/>(4K H.264)"] --> DEC["decode<br/>once"]
    DEC --> SPLIT["split=3"]
    SPLIT --> S1["scale 1080"] --> E1["x264 5000k"]
    SPLIT --> S2["scale 720"] --> E2["x264 2800k"]
    SPLIT --> S3["scale 480"] --> E3["x264 1400k"]
    SRC --> AUD["audio"] --> A1["AAC ×3"]
    E1 & E2 & E3 & A1 --> HLS["hls muxer<br/>cuts at the forced keyframes<br/>writes master + variants"]
```

| Part | What it does |
|---|---|
| `-filter_complex "[0:v]split=3…"` | Decode the source **once**, copy the decoded frames three ways, scale each copy. This is the main reason one run beats three ([section 9](#9-one-job-or-a-flow-measured)) |
| `scale=-2:1080` | Height 1080, width calculated to keep the shape; `-2` rounds it to an even number, which H.264 requires |
| `-map [o0] -map 0:a:0` … | Output streams in order: video 0, audio 0, video 1, audio 1, … The audio is mapped three times so each rendition carries its own track |
| `-b:v:0` / `-b:a:2` | Per-stream options: `:v:0` is the first output video stream, `:a:2` the third audio stream |
| `-preset veryfast` | The speed vs compression trade-off. Slower presets make smaller files for the same quality, at much more CPU |
| `-var_stream_map "v:0,a:0,name:1080p …"` | Groups streams into renditions. `name:` becomes `%v` in the paths |
| `-master_pl_name master.m3u8` | Also write the master playlist, with `BANDWIDTH`, `RESOLUTION` and `CODECS` filled in |
| `-hls_segment_filename "%v/seg_%03d.ts"` | Segment names: `1080p/seg_000.ts`, … |

### Gotcha: run FFmpeg *inside* the output folder

The first attempt passed absolute Windows paths (`C:\…\single\%v\index.m3u8`) and failed with `Could not write header … Permission denied`, even after creating the `1080p/`, `720p/` and `480p/` folders by hand. The same command with relative paths worked. The likely cause is how FFmpeg derives the master playlist's location from a templated absolute path; it isn't worth chasing, because relative paths avoid it entirely.

The fix, and what the worker does: start FFmpeg with its working directory set to the output folder, and use **relative** paths (`%v/index.m3u8`). FFmpeg then creates `1080p/`, `720p/` and `480p/` itself and puts `master.m3u8` next to them. In Node that's `spawn('ffmpeg', args, { cwd: outDir })`. The probe uses the same trick for a different reason: ffprobe's error messages then contain `source`, not the temp path.

### Progress

`-progress pipe:1` makes FFmpeg print `key=value` lines to stdout every ~0.5 s, including `out_time_us` (how far into the video it is). Progress % = `out_time_us / (duration × 1,000,000)`.

### In the code: `src/worker/pipeline/transcode.ts`

| Function | Pure? | Job |
|---|---|---|
| `planRenditions({ width, height })` | yes | Filters the ladder by the **short side**, scales both sides by the same factor, rounds to even numbers. A source smaller than 480 keeps its own size |
| `buildHlsArgs(source, renditions, hasAudio)` | yes | Builds the argument array from section 7. Without audio it drops the `0:a:0` maps, the AAC options and the `a:i` parts of `var_stream_map` |
| `runFfmpeg(args, { cwd, durationSeconds, onProgress, signal })` | no | `spawn('ffmpeg', args)` with **no shell**. Reads `-progress pipe:1` line by line, calls `onProgress` only when the whole percent goes up (so Redis isn't flooded), keeps the last 2 KB of stderr for the error message |
| `transcodeHls(source, outDir, meta, onProgress, signal)` | no | Plans, creates `outDir`, runs FFmpeg inside it, returns the renditions |

`buildHlsArgs` returns an array, and `spawn` passes each element to FFmpeg as one argument. No shell ever parses the command, so a file name with spaces, quotes or `; rm -rf` in it can't break out. The same reason we never build a command string.

**Errors:** a non-zero exit becomes `UnrecoverableError` when stderr says the input is bad (`Invalid data found`, `moov atom not found`), otherwise a plain `Error`, which is retried. When the `signal` is aborted, Node kills FFmpeg and the promise rejects with `AbortError`; Stage 6 uses that on SIGTERM.

**Planned ladders:**

| Source | Renditions |
|---|---|
| 3840×2160 | 1920×1080, 1280×720, 854×480 |
| 1280×720 | 1280×720, 854×480 |
| 1080×1920 (portrait) | 1080×1920, 720×1280, 480×854 |
| 640×360 | 640×360 only |
| 1440×1080 (4:3) | 1440×1080, 960×720, 640×480 |
| 3840×1608 (cinema 2.39:1) | 2580×1080, 1720×720, 1146×480 |

**Measured:**

| Input | Result |
|---|---|
| 4K sample, Windows, FFmpeg 9 | 30.7 s for 31.88 s of video; 52 progress updates rising to 100; every segment of every rendition starts with `I`; durations `6 6 6 6 6 1.88` everywhere |
| 4K sample, worker container, FFmpeg 5.1 | 37.6 s; same renditions and segment durations |
| Portrait phone clip | 720×1280 and 480×854, no upscale to 1080 |
| Clip without audio | One 360p rendition, `CODECS="avc1.64001e"` with no audio codec |
| Random bytes | `UnrecoverableError … moov atom not found … Invalid data` |
| Aborted after 3 s | `AbortError` after 3004 ms, no FFmpeg process left running |

**FFmpeg 5.1 vs 9.0.** The container's 5.1 writes `BANDWIDTH` from the *configured* rates (5,640,800 = (5000k + 128k) × 1.1) and no `AVERAGE-BANDWIDTH`; 9.0 measures the real peak and average. Both are valid HLS. ffprobe also reported the duration slightly differently (31.91 s vs 31.88 s). The container is what runs in production, so its output is the one that counts.

## 8. Probing the input first

Before encoding, `ffprobe` reads the file's headers (it doesn't decode the video, so it takes milliseconds):

```text
ffprobe -v error -print_format json -show_format -show_streams source
```

`src/worker/pipeline/probe.ts` validates the JSON with Zod and returns:

```ts
type ProbeResult = { durationSeconds; width; height; hasAudio; videoCodec };
```

| Field | Used for |
|---|---|
| `width`, `height` (**after rotation**) | The ladder (never upscale, short side for portrait) |
| `durationSeconds` | Progress %, the thumbnail time (5 s, or 10% of short clips), `videos.duration_seconds` |
| `hasAudio` | Without audio, FFmpeg must not map `0:a:0`, or it fails |

**Rotation.** Phones store a portrait clip as landscape pixels plus a "rotate 90°" note (a display matrix). ffprobe reports `width: 1280, height: 720, rotation: -90`. The probe swaps them so the result is what the viewer sees (720×1280). FFmpeg applies the rotation automatically when encoding.

**Which failures are permanent.** Measured with test files:

| Input | Result | Retried? |
|---|---|---|
| The real 4K upload | `3840×2160, 31.88 s, h264, audio` | n/a |
| Landscape test clip | `1280×720, audio` | n/a |
| Same clip tagged as phone portrait | `720×1280` (rotated) | n/a |
| Video without sound | `hasAudio: false` | n/a |
| Audio-only `.m4a` | `UnrecoverableError: File has no video stream` | **No** |
| 200 KB of random bytes named `.mp4` | `UnrecoverableError: ffprobe could not read the file: … moov atom not found … Invalid data` | **No** |
| Raw object missing in RustFS | `UnrecoverableError: Source object … does not exist` | **No** |
| `ffprobe` not installed | plain error (`ENOENT`) | Yes: it's the machine's fault, not the video's |

A corrupt file fails identically on every attempt, so retrying would burn three attempts (and, after the probe, three full transcodes) for nothing. That's what `UnrecoverableError` is for.

## 9. One job or a Flow? Measured

BullMQ Flows ([queues.md, Part 4](queues.md#3-flow-parent-and-children)) can split work into child jobs that run in parallel, with a parent that runs once they all finish. The obvious design for transcoding is one child per rendition:

```mermaid
flowchart BT
    C1["child: 1080p<br/>download · decode · encode · upload"] --> P["parent: finalize<br/>write master.m3u8, mark READY"]
    C2["child: 720p<br/>download · decode · encode · upload"] --> P
    C3["child: 480p<br/>download · decode · encode · upload"] --> P
```

So we measured it: the same three renditions, made three ways on the same machine.

| Approach | What it simulates | Wall time | vs one run |
|---|---|---|---|
| **One FFmpeg run**, `split=3` | Sprint 6 plan: single job | **46 s** | 1× |
| Three FFmpeg runs, one after another | A Flow with 3 children on one worker slot | 139 s | 3.0× slower |
| Three FFmpeg runs **at the same time** | A Flow with 3 children on 3 worker slots, one machine | 123 s | 2.7× slower |
| Decoding the 4K source alone, no encoding | n/a | 27–33 s | n/a |

### Why the Flow loses here

1. **Decoding is most of the cost.** Just decoding the 4K H.264 source takes ~30 s of the 46. One run decodes once and feeds all three encoders. Three children decode three times: about 60 s of pure waste, before any encoding.
2. **Running them in parallel doesn't help on one machine.** x264 already uses all 8 cores. Three FFmpegs at once just share the same cores, so 123 s is barely better than 139 s.
3. **The renditions can't be finished separately anyway.** The master playlist needs all of them, and they need identical keyframe timing. A parent job would have to assemble `master.m3u8` itself, which FFmpeg otherwise writes for free.
4. **Each child also downloads the source.** Jobs may run on different machines, so they can't share `/tmp`. That's 3× the 229 MB download (1–2.5 s here, much more over a real network).

### So can we use Flows? Yes, where they fit

A Flow is the right tool when the pieces are **independent, expensive, and there are several machines**. For KlyroStream:

| Where | Shape | When it's worth it |
|---|---|---|
| Core transcode (Sprint 6) | **Single job** | Now. One decode, one machine, measured 2.7–3× faster than splitting |
| Thumbnail before the transcode finishes | Separate job enqueued alongside (a chain, not a Flow), reading a few MB from a presigned URL with `ffmpeg -ss 5 -i <url>` | If the UI should show a poster while the video is still processing |
| AI captions (Sprint 12) | Flow: `extract-audio` child → `transcribe` parent, or a chain from READY | Captions must not delay playback |
| Long videos on several machines (Phase 2) | Flow with **segment children**: split the source at keyframes into 1-minute chunks, one child per chunk encodes every rendition, the parent joins them | When videos are long and there are many workers. This is how large platforms parallelise; each child decodes only its own chunk, so nothing is decoded twice |

The Sprint 6 pipeline functions (`downloadSource`, `probe`, `transcode`, `makeThumbnail`, `uploadDir`) take paths and return results; none of them knows about jobs. Turning the single job into a Flow later only changes the orchestrator, not the pieces.

### What about a step job, or a step job with a Flow?

A **step job** ([queues.md](queues.md#2-step-job)) is still one job, but it saves "I finished stage X" in its own data with `job.updateData`, so a retry skips the stages that are already done. A **step job with a Flow** goes further: the job probes, adds child jobs pointing at itself, throws `WaitingChildrenError`, and resumes as the parent once they finish.

A checkpoint is only worth saving if (a) the stage before it is expensive and (b) its output survives the retry. Measured costs per stage for the 4K sample:

| Stage | Cost | Output durable? |
|---|---|---|
| Download | 1–2.5 s | No: `/tmp` is deleted in `finally`, and a retry may run on another worker |
| Probe | milliseconds | No (but it's free to redo) |
| **Transcode** | **31–46 s** | No, still in `/tmp` |
| Thumbnail | < 1 s | No |
| Upload | a few seconds | **Yes**, in RustFS |
| Mark READY | milliseconds | Yes, in Postgres |

The only stage worth not repeating is the transcode, and its output only becomes durable **after the upload**. So a step job has exactly one useful checkpoint:

```mermaid
flowchart LR
    subgraph S1["step: produce (retry repeats all of it)"]
        direction LR
        D["download"] --> P["probe"] --> T["transcode"] --> TH["thumbnail"] --> U["upload"]
    end
    U --> CP{{"updateData<br/>step = uploaded<br/>+ paths, duration"}}
    CP --> R["step: finalize<br/>mark READY"]
```

It saves us from exactly one failure: everything uploaded, then the READY update fails (Postgres restarting, a connection blip). Without the checkpoint, the retry re-transcodes; with it, the retry goes straight to READY. That's cheap to add (one `updateData`, one `if` at the start), so **Stage 6 adds it**.

Checkpoints *inside* the produce step don't help: a transcode that's half done can't be resumed, and an upload that fails halfway is simply redone, because objects with the same key are overwritten.

**Step job with a Flow** (dynamic children) only pays off when the children are worth spreading over several machines: the Phase 2 "one child per chunk" design. With one machine and one FFmpeg run, the parent would add a single child and wait for it, which is a step job with extra Redis keys.

| Option | Sprint 6? | Why |
|---|---|---|
| Single job | ✅ base | One decode, simplest to follow in Bull Board |
| + one step checkpoint after upload | ✅ Stage 6 | Cheap; avoids a re-transcode when only the READY update failed |
| Step job + Flow children | ❌ Phase 2 | Needs several machines and chunked encoding to beat one FFmpeg run |

## 10. The Sprint 6 pipeline

```mermaid
flowchart LR
    J(["job: videoId"]) --> R["re-read row<br/>must be PROCESSING"]
    R --> D["downloadSource<br/>raw-uploads → /tmp/klyro/&lt;jobId&gt;/source"]
    D --> PR["probe<br/>size · duration · audio"]
    PR --> T["transcode<br/>one FFmpeg run → hls/"]
    T --> TH["thumbnail<br/>1 frame, 640 px"]
    TH --> U["upload<br/>hls-output/&lt;videoId&gt;/<br/>thumbnails/&lt;videoId&gt;.jpg"]
    U --> OK(["READY + paths + duration"])
    D & PR & T & TH & U -. "permanent error / last attempt" .-> E(["ERROR + message<br/>delete partial output"])
```

| Stage | Status | Code |
|---|---|---|
| 1. Container with FFmpeg | Done | `backend/Dockerfile` (`worker` target), `docker-compose.yml` (`worker` service, `profiles: [worker]`) |
| 2. Download + probe | Done | `lib/storage/objects.ts`, `worker/pipeline/download.ts`, `worker/pipeline/probe.ts` |
| 3. Transcode | Done | `worker/pipeline/transcode.ts`: `planRenditions`, `buildHlsArgs` (pure), `runFfmpeg` (`spawn`, progress, stop on abort), `transcodeHls` |
| 4. Thumbnail | Done | `worker/pipeline/thumbnail.ts`: `thumbnailTime`, `makeThumbnail` |
| 5. Upload outputs | Done | `lib/storage/objects.ts` (`uploadObject`), `worker/pipeline/upload.ts` (`uploadDir`, `uploadFile`, `contentTypeFor`) |
| 6. Wire the processor | Done | `worker/video.processor.ts`, `worker.ts`, `services/video.service.ts` (`outputKeys`, `markVideoReady`, `deleteVideoOutputs`), `lib/storage/objects.ts` (`deletePrefix`) |
| 7. Prove it | Done (GIF pending) | `scripts/hls-player.ts` (`npm run videos:play`): READY list, hls.js player, quality log, built-in network throttle. Results in [NOTES.md](../NOTES.md) |

### Thumbnail (Stage 4)

```text
ffmpeg -y -ss 5.000 -i source -frames:v 1
       -vf "scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease"
       -q:v 3 thumbnail.jpg
```

| Part | Why |
|---|---|
| `-ss 5` **before** `-i` | Input seeking: FFmpeg jumps to the nearest keyframe before 5 s and decodes only from there. After `-i` it would decode every frame from 0 s |
| 5 s, or 10% for clips ≤ 10 s | Frame 0 is often black or a fade-in. A 3 s clip has no 5 s mark, so it uses 0.3 s |
| `-frames:v 1` | Write one frame and stop |
| `scale=…min(640,…)…decrease` | Fit inside a 640×640 box, keep the shape, never upscale: landscape → 640×360, portrait → 360×640 |
| `-q:v 3` | JPEG quality (2 = best, 31 = worst); 3 keeps a 640×360 frame around 40 KB |

It reuses `runFfmpeg`, so it gets the same no-shell spawn, error classification and abort support.

Measured: 4K sample at 5.00 s → 640×360 in 1.5 s; portrait clip at 0.30 s → 360×640, upright; 2 s clip at 0.20 s.

### Upload (Stage 5)

The player trusts the `Content-Type` header, not the file extension. Safari's native HLS player and some TVs refuse a playlist served as `application/octet-stream` (what you get when no type is set). So every object gets its type at upload time:

| Extension | Content-Type |
|---|---|
| `.m3u8` | `application/vnd.apple.mpegurl` |
| `.ts` | `video/mp2t` |
| `.jpg` | `image/jpeg` |

An unknown extension is an error, and `uploadDir` checks every file **before** uploading any, so a stray file can't cause a half-uploaded folder.

**Keys:** `hls-output/<videoId>/master.m3u8`, `hls-output/<videoId>/720p/seg_000.ts`, `thumbnails/<videoId>.jpg`. The folder layout is uploaded unchanged, so the relative paths inside the playlists keep working. On Windows, `path.relative` returns `720p\seg_000.ts`; the key is rebuilt with `/`, because S3 keys always use forward slashes.

**Concurrency without a library.** `uploadDir` starts 4 small loops that each take the next file from a shared index until none are left. Node runs them on one thread, so `files[next++]` never hands the same file to two loops. Plain `PutObject` is enough because the largest file is a ~3.5 MB segment; multipart only pays off for large objects. The first failure is remembered and stops the loops from starting new uploads, but `uploadDir` still **waits for the uploads already in flight** before throwing. Otherwise they could land after the processor has deleted the partial output (see the code walkthrough, [upload.ts](#7-pipelineuploadts-a-worker-pool-without-a-library)).

**A bug found by measuring.** The first version reported 12.2 MB uploaded for a 36.7 MB folder:

```ts
bytes += await uploadFile(file, bucket, key);     // wrong with concurrency
```

`a += await b` means `a = a + await b`, and `a` is read **before** the `await`. Four loops all read the same old total, wait, then each writes "old total + my file", overwriting the others. All 22 files were uploaded; only the count was lost. It's the same lost-update race as two transactions doing read-modify-write without a lock ([locking.md](locking.md)). The fix is to await first, then add:

```ts
const size = await uploadFile(file, bucket, key);
bytes += size;
```

Measured after the fix: 22 files, 36.7 MB, uploaded in 0.55–0.68 s. Fetching through a presigned URL returned `application/vnd.apple.mpegurl` for `master.m3u8` and `video/mp2t` for `720p/seg_000.ts`.

### The processor (Stage 6)

```mermaid
flowchart TD
    START(["attempt starts"]) --> ROW{"row is PROCESSING<br/>and has rawPath?"}
    ROW -- no --> UNREC["UnrecoverableError"]
    ROW -- yes --> CP{"job.data.output<br/>already set?"}
    CP -- "yes (earlier attempt uploaded)" --> READY
    CP -- no --> TMP["wipe + create /tmp/klyro/&lt;jobId&gt;"]
    TMP --> PRODUCE["download 0→10 % · FAIL_RATE<br/>probe · transcode 10→85 %<br/>thumbnail →90 % · upload →100 %"]
    PRODUCE --> RM["finally: delete temp folder"]
    RM --> SAVE["job.updateData({ output })<br/>checkpoint in Redis"]
    SAVE --> READY["markVideoReady(paths, duration)<br/>one conditional UPDATE"]
    READY --> DONE(["completed"])
    PRODUCE -. "SIGTERM" .-> WAIT["moveToWait + WaitingError<br/>no attempt used"]
    PRODUCE -. "error, attempts left" .-> RETRY["retry after 5 s / 10 s"]
    PRODUCE -. "error, last attempt" .-> FAIL["markVideoFailed"]
    READY -. "error, last attempt" .-> FAIL
    UNREC -.-> FAIL
    FAIL --> MOVED{"did *this* job move<br/>the row to ERROR?"}
    MOVED -- yes --> CLEAN["deleteVideoOutputs<br/>hls-output/&lt;id&gt;/ + thumbnail"]
    MOVED -- no --> KEEP["touch nothing<br/>(row is READY or gone)"]
```

| Decision | Why |
|---|---|
| Temp folder per job id, wiped at the start **and** deleted in `finally` | A crashed earlier attempt may have left files; a successful or failed one must not leave 230 MB behind |
| Progress by phase (10 / 75 / 5 / 10 %) | The transcode is ~85 % of the time, so it gets most of the bar; the bar moves smoothly instead of jumping |
| `FAIL_RATE` right after the download | A simulated failure still exercises download + cleanup, but doesn't waste an FFmpeg run |
| Checkpoint: `job.updateData({ output })` after the upload | If only the READY update fails, the retry skips straight to it ([section 9](#what-about-a-step-job-or-a-step-job-with-a-flow)) |
| READY with paths and duration in **one** `UPDATE … WHERE status = 'PROCESSING'` | One write; a video is never READY without its paths, and never shows half its metadata |
| Cleanup only if `markVideoFailed` returned a row | A duplicate job for a READY video fails with "Video is READY"; deleting outputs then would destroy a good video |
| User-facing `error_message` only from `UnrecoverableError` | Those messages are ours. Anything else (a Postgres error carries the full SQL and its parameters) becomes "Processing failed after 3 attempts"; the details stay in the logs and Bull Board |
| SIGTERM aborts the work and returns the job to `wait` | A transcode outlives any reasonable shutdown timeout; see [queues.md, Graceful shutdown](queues.md#graceful-shutdown) |

#### Tested end to end, in the worker container

| Test | How | Result |
|---|---|---|
| **A. Happy path** | Real 4K upload | READY with `hls_path`, `thumbnail_path`, `duration_seconds = 32`; 22 HLS objects; `/tmp/klyro` empty; timings below |
| **B. SIGTERM mid-transcode** | `docker compose stop worker` at 30 % | Stopped in 2.7 s; job `waiting`, `attemptsMade=0`; video still PROCESSING; no temp files left (`docker diff`); after restart it finished as attempt 1 |
| **C. Duplicate job for a READY video** | Enqueue again after success | Failed at once with "Video is READY, expected PROCESSING"; `markedError: false`; all 22 objects kept |
| **D. READY update fails once** | Temporary Postgres trigger, removed afterwards | Attempt 1 uploaded then failed; attempt 2 logged "outputs already uploaded … skipping to READY" and finished in 0.3 s |
| **E. READY update always fails** | Same trigger | 3 attempts (2 and 3 took 0.3 s each), then ERROR; `deletedOutputs: 22`; HLS prefix and thumbnail gone |
| **Bad input** | A stuck "upload" that was 1000 random bytes | ERROR after **one** attempt: `ffprobe could not read the file …` |

E is also where the SQL-in-`error_message` problem showed up, which led to the user-facing message rule above.

#### The timing line

Every successful job logs `outputs uploaded` with per-phase timings. For the 4K sample in the container:

| download | probe | transcode | thumbnail | upload | total | source | output |
|---|---|---|---|---|---|---|---|
| 1.3–2.7 s | 1.1–1.2 s | 35.0–36.9 s | 1.3–1.6 s | 0.4–0.5 s | ~42 s | 239 MB | 36 MB, 22 files |

That's `secondsPerGb: 178`, about **3 minutes per GB**, for a 4K H.264 source on 8 cores. It's per GB of *this* source; a 1080p source of the same size has more seconds of video, so it decodes faster per second but has more of them. Stage 7 measures more inputs for `NOTES.md`.

**Download speed, for the record:** the 229 MB raw object streamed from RustFS to disk in 1.2–2.5 s. The transcode (46 s for 32 s of 4K) is roughly 20–40× the download, so the download is not worth optimising.

## 11. Code walkthrough: reviewing Sprint 6

This section goes through **every file Sprint 6 added or changed**, in the order that makes them easiest to understand: from the container up to the processor that ties everything together. For each file: what it's for, the code that matters, why it's written that way, and how to check it yourself.

### Reading order

```mermaid
flowchart TD
    A["1 · Dockerfile, .dockerignore,<br/>docker-compose.yml"] --> B["2 · lib/storage/objects.ts<br/>S3 building blocks"]
    B --> C["3 · pipeline/download.ts"]
    C --> D["4 · pipeline/probe.ts"]
    D --> E["5 · pipeline/transcode.ts"]
    E --> F["6 · pipeline/thumbnail.ts"]
    F --> G["7 · pipeline/upload.ts"]
    G --> H["8 · queues.ts, video.service.ts,<br/>video.repository.ts"]
    H --> I["9 · worker/video.processor.ts<br/>ties it all together"]
    I --> J["10 · worker.ts<br/>shutdown"]
    J --> K["11 · scripts/hls-player.ts<br/>dev player"]
```

| # | File | Lines | Kind |
|---|---|---|---|
| 1 | `backend/Dockerfile`, `backend/.dockerignore`, `docker-compose.yml` (worker) | ~70 | Infrastructure |
| 2 | `src/lib/storage/objects.ts` | 86 | Storage layer: no job or video knowledge |
| 3–7 | `src/worker/pipeline/*.ts` | ~365 | Pure steps: paths in, results out, no job knowledge |
| 8 | `src/lib/queue/queues.ts`, `src/services/video.service.ts`, `src/repositories/video.repository.ts` | ~30 changed | Types, row transitions, output keys |
| 9 | `src/worker/video.processor.ts` | 180 | Orchestration and failure policy |
| 10 | `src/worker.ts` | 10 changed | Shutdown order |
| 11 | `src/scripts/hls-player.ts` | 211 | Dev-only tool |

### The layering rule

```mermaid
flowchart LR
    P["video.processor.ts<br/><b>knows about jobs</b><br/>retries, checkpoint, ERROR"] --> PL["pipeline/*<br/><b>knows about files</b><br/>FFmpeg, ffprobe, keys"]
    P --> S["video.service.ts<br/><b>knows about videos</b><br/>READY / ERROR, output keys"]
    PL --> O["lib/storage/objects.ts<br/><b>knows about S3</b>"]
    S --> O
    S --> R["video.repository.ts<br/><b>knows about SQL</b>"]
```

Each layer only calls the one to its right. That's why `transcode.ts` can be tested with a local file and no Redis, and why switching to a Flow later only touches the processor ([section 9](#so-can-we-use-flows-yes-where-they-fit)).

---

### 1. Containers

#### `backend/Dockerfile`

```dockerfile
FROM node:24-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS api
…
FROM base AS worker
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/worker.js"]
```

**Multi-stage build.** Each `FROM … AS name` starts a fresh image. Later stages copy only what they need from earlier ones (`COPY --from=build`). Everything else, like TypeScript, ESLint and the dev dependencies, is thrown away.

```mermaid
flowchart LR
    base["base<br/>node:24-slim"] --> deps["deps<br/>npm ci (all)"] --> build["build<br/>tsc → dist/"]
    base --> prod["prod-deps<br/>npm ci --omit=dev"]
    base --> api["api · 458 MB"]
    base --> worker["worker · 1.1 GB<br/>+ ffmpeg"]
    prod -. node_modules .-> api & worker
    build -. dist .-> api & worker
```

| Line | Why |
|---|---|
| `COPY package.json package-lock.json` **before** `COPY src` | Docker caches each step. A step reruns only if its inputs changed, and so does every step after it. Copying only the lockfile first means `npm ci` is reused until dependencies change. A code edit rebuilds in ~13 s instead of minutes |
| `npm ci` (not `npm install`) | Installs exactly what the lockfile says, fails if `package.json` and the lockfile disagree |
| `prod-deps` as its own stage | `--omit=dev` leaves out tsx, ESLint and `pino-pretty`. Running from `base`, it builds in parallel with `deps` |
| `worker` starts `FROM base`, installs FFmpeg **first**, copies code **last** | The plan's version did `FROM api AS worker` and installed FFmpeg after the code. Then every code change would reinstall FFmpeg (~4.5 min). Slow-changing things go above fast-changing things |
| `--no-install-recommends`, `rm -rf /var/lib/apt/lists/*` | Skip optional packages and apt's download cache: smaller image |
| `USER node` | The process runs as uid 1000, not root. The copied files stay owned by root, so the process **can't change its own code** |
| `CMD ["node", …]` (exec form, a JSON array) | Node is the container's main process and receives SIGTERM directly. `CMD node dist/worker.js` (shell form) would start `/bin/sh` first, which doesn't forward signals |
| `--enable-source-maps` | Stack traces point at `.ts` lines instead of compiled `.js` |
| `ENV NODE_ENV=production` | The logger prints JSON instead of using `pino-pretty`, which isn't installed in the image |

**Check it yourself:** `docker compose build worker` twice. The second time every step says `CACHED`. Edit any `.ts` file and build again: only `build` and the final `COPY` rerun.

#### `backend/.dockerignore`

```text
node_modules
dist
coverage
.env
.env.*
.upload-state
*.log
Dockerfile
.dockerignore
```

`docker build` first sends the whole folder (the "build context") to Docker. Without this file it would send your Windows `node_modules` (wrong platform for Linux, and huge) and your `.env` **secrets** into the image.

#### The `worker` service in `docker-compose.yml`

```yaml
worker:
  build: { context: ./backend, target: worker }
  profiles: [worker]
  restart: unless-stopped
  init: true
  stop_grace_period: 40s
  env_file: ./backend/.env
  environment:
    NODE_ENV: production
    FAIL_RATE: '0'
    DATABASE_URL: postgresql://klyro:klyro_dev@postgres:5432/klyro
    REDIS_URL: redis://redis:6379
    S3_ENDPOINT: http://rustfs:9000
    SMTP_HOST: mailpit
    SMTP_PORT: '1025'
  depends_on:
    postgres: { condition: service_healthy }
    redis: { condition: service_healthy }
    rustfs: { condition: service_healthy }
```

| Key | Why |
|---|---|
| `target: worker` | Build only the `worker` stage of the Dockerfile |
| `profiles: [worker]` | A plain `docker compose up -d` does **not** start it. Your local `npm run dev:worker` and a container worker would otherwise compete for the same jobs, and the container runs whatever code it was last built with. Start it on purpose: `docker compose up -d worker` |
| `env_file` + `environment` | Take the secrets from your `.env`, then override what differs inside Docker. `environment` wins over `env_file` |
| `postgres:5432`, `redis:6379`, `rustfs:9000` | Inside Compose's network, containers reach each other by **service name** and **internal port**. `localhost` inside the container means the container itself. Note `5432`, not the `5433` you use from Windows |
| `init: true` | Adds tini as process 1. Process 1 must collect finished child processes ("reap zombies"); Node doesn't do that. The worker starts FFmpeg children, so this matters |
| `stop_grace_period: 40s` | Docker sends SIGTERM, then SIGKILL after this time (default 10 s). Our shutdown can take up to 30 s |
| `depends_on … service_healthy` | Don't start until the healthchecks pass |
| `FAIL_RATE: '0'` | With `NODE_ENV=production`, `env.ts` refuses to boot unless it's 0 |

**Check it yourself:** `docker compose up -d worker`, then `docker compose exec worker sh -c 'id; ffmpeg -version | head -1; cat /proc/1/comm'`. Expected: `uid=1000(node)`, FFmpeg 5.1, `docker-init`.

---

### 2. `lib/storage/objects.ts`: the S3 building blocks

These functions know about buckets, keys and files, and nothing about videos or jobs. That's what lets the pipeline, the service and the dev player all share them.

#### `downloadObject`: streaming to disk

```ts
const { Body, ContentLength } = await s3.send(
  new GetObjectCommand({ Bucket: bucket, Key: key }),
  { abortSignal: signal },
);
if (!(Body instanceof Readable)) throw new Error(`GetObject ${key} returned no stream`);

await pipeline(Body, createWriteStream(filePath), { signal });

const { size } = await stat(filePath);
if (ContentLength !== undefined && size !== ContentLength) {
  throw new Error(`Downloaded ${size} of ${ContentLength} bytes for ${key}`);
}
return size;
```

- **Streaming, not buffering.** `Body` is a stream of chunks. `pipeline` passes each chunk to the file as it arrives, so a 5 GB video uses a few MB of memory, not 5 GB. (`await Body.transformToByteArray()` would load it all into RAM.)
- **Backpressure.** If the disk is slower than the network, `pipeline` pauses reading until the disk catches up. Writing chunks by hand with `.on('data')` would ignore that and pile data up in memory.
- **`pipeline` vs `.pipe()`.** `.pipe()` doesn't forward errors or clean up: a network error leaves the file stream open. `pipeline` destroys every stream on any error and rejects the promise.
- **`Body instanceof Readable`.** The SDK types `Body` loosely (it could be a browser stream). The check narrows the type without an unsafe cast, and fails loudly if it's ever not a Node stream.
- **Size check on disk.** A connection that closes early can end the stream "successfully". Comparing the file size with `ContentLength` catches a truncated download before FFmpeg wastes time on it.
- **`signal`.** One `AbortSignal` cancels both the HTTP request and the file write (see [the abort signal path](#one-abortsignal-through-every-layer)).

#### `uploadObject`

```ts
const { size } = await stat(filePath);
await s3.send(
  new PutObjectCommand({
    Bucket: bucket, Key: key,
    Body: createReadStream(filePath),
    ContentLength: size,
    ContentType: contentType,
  }),
  { abortSignal: signal },
);
```

- **`ContentLength` is required with a stream body.** S3 needs the size up front; from a stream the SDK can't know it.
- **`ContentType`** is stored with the object and sent back on every GET. That's what players read ([section 10, Upload](#upload-stage-5)).
- When you run it, the SDK logs `An error was encountered in a non-retryable streaming request` for a failing upload. A stream can only be read once, so the SDK can't retry it on its own. That's fine: the whole job is retried by BullMQ.

#### `deletePrefix`: pagination

```ts
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken: token }));
  const objects = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
  if (objects.length > 0) {
    await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objects, Quiet: true } }));
    deleted += objects.length;
  }
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);
```

S3 has no "delete folder". A "folder" is just keys sharing a prefix. `ListObjectsV2` returns at most **1,000 keys per page**, and `DeleteObjects` accepts at most 1,000 per call, so the loop handles one page at a time until `IsTruncated` is false. A 2-hour video has ~1,200 segments per rendition, so this isn't theoretical. `flatMap` with `[]` both filters out entries without a key and maps the rest, and TypeScript understands the result has no `undefined`.

#### `openObject`

Same as the first half of `downloadObject`, but returns the stream and its type for someone else to pipe. Only the dev player uses it.

---

### 3. `pipeline/download.ts`: translating errors at the boundary

```ts
export const downloadSource = async (rawPath: string, filePath: string, signal?: AbortSignal) => {
  try {
    return await downloadObject(BUCKETS.raw, rawPath, filePath, signal);
  } catch (err) {
    if (storageErrorName(err) === 'NoSuchKey') {
      throw new UnrecoverableError(`Source object ${rawPath} does not exist`);
    }
    throw err;
  }
};
```

The storage layer doesn't know about BullMQ, so it can't decide what's retryable. This thin wrapper does: a **missing object** will be missing on every attempt, so it becomes `UnrecoverableError` (no retries). A network error stays a plain error, which is retried.

`return await` inside `try` matters: without `await`, the promise would be returned *before* it rejects, and the `catch` would never see the error.

---

### 4. `pipeline/probe.ts`: running ffprobe safely

#### Three ways to run a program from Node

| Function | Shell? | Output | Used for |
|---|---|---|---|
| `exec('ffprobe ' + file)` | **Yes** | Buffered | Never here: the shell parses the string, so a file name like `a; rm -rf /` runs a second command |
| `execFile('ffprobe', [args])` | No | Buffered, returned at the end | **ffprobe**: small JSON output, finishes in milliseconds |
| `spawn('ffmpeg', [args])` | No | Streamed while running | **FFmpeg**: runs for minutes, and we read progress as it goes |

With no shell, each array element reaches the program as exactly one argument. Spaces, quotes and semicolons in a file name are just characters.

```ts
const exec = promisify(execFile);

const { stdout } = await exec('ffprobe', [...PROBE_ARGS, path.basename(filePath)], {
  cwd: path.dirname(filePath),
  signal,
  maxBuffer: 4 * 1024 * 1024,
});
```

- `promisify` turns the callback-style `execFile` into a function that returns a promise.
- `cwd` + `basename`: ffprobe runs **inside** the temp folder and is given just `source`. Its error messages then say `source: Invalid data…` instead of `/tmp/klyro/video-…/source`, and those messages can reach users.
- `maxBuffer`: `execFile` keeps all output in memory and kills the program if it exceeds this. 4 MB is far more than a JSON description needs.

#### Validating the output with Zod

```ts
const probeOutput = z.object({
  streams: z.array(z.object({
    codec_type: z.string(),
    codec_name: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    duration: z.coerce.number().optional(),
    side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional(),
  })),
  format: z.object({ duration: z.coerce.number().optional() }),
});
```

ffprobe's JSON comes from outside our code, just like a request body, so it's validated the same way. Two details:

- `z.coerce.number()` for `duration`: ffprobe prints durations as **strings** (`"31.880000"`) but sizes as numbers.
- Only the fields we use are listed. Zod ignores the rest (ffprobe prints dozens).

#### The decisions after parsing

```ts
const video = streams.find((s) => s.codec_type === 'video' && s.width && s.height);
if (!video?.width || !video.height) throw new UnrecoverableError('File has no video stream');

const durationSeconds = format.duration ?? video.duration;

const rotation = Math.abs(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
const sideways = rotation === 90 || rotation === 270;
return {
  width: sideways ? video.height : video.width,
  height: sideways ? video.width : video.height,
  …
};
```

- The container's duration (`format.duration`) is preferred; some files only have it on the stream.
- **Rotation:** a phone stores portrait video as landscape pixels plus "rotate −90°". We return the size **the viewer sees**, because FFmpeg applies the rotation when encoding.
- **Error classification** in `runProbe`'s `catch`:
  - `ENOENT` (ffprobe isn't installed) → rethrown as-is → **retried**. It's the machine's fault, not the video's.
  - Aborted (shutdown) → rethrown as-is.
  - Anything else (ffprobe exited non-zero) → `UnrecoverableError` with the last 300 characters of its error output, newlines collapsed.

**Check it yourself:** `ffprobe -v error -print_format json -show_format -show_streams bruno/videos/fixtures/sample-video.mp4` and find the fields the schema reads.

---

### 5. `pipeline/transcode.ts`: the ladder and FFmpeg

Four exports: two **pure** functions (`planRenditions`, `buildHlsArgs`) that only compute, and two that run FFmpeg (`runFfmpeg`, `transcodeHls`). Keeping the decisions pure means you can check them by calling them, without FFmpeg.

#### `planRenditions`: which sizes to make

```ts
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export const planRenditions = ({ width, height }) => {
  const shortSide = Math.min(width, height);
  const fits = LADDER.filter((rung) => rung.shortSide <= shortSide);
  const rungs = fits.length > 0 ? fits : [{ ...LADDER[2], name: `${even(shortSide)}p`, shortSide }];

  return rungs.map((rung) => {
    const scale = rung.shortSide / shortSide;
    return { name: rung.name, width: even(width * scale), height: even(height * scale), … };
  });
};
```

Worked through for the 4K sample (3840×2160):

| Step | Value |
|---|---|
| `shortSide` | min(3840, 2160) = 2160 |
| `fits` | all three rungs (1080, 720, 480 ≤ 2160) |
| 1080p: `scale` = 1080 / 2160 = 0.5 | 3840 × 0.5 = **1920**, 2160 × 0.5 = **1080** |
| 720p: `scale` = 0.333… | 1280 × 720 |
| 480p: `scale` = 0.222… | 3840 × 0.222 = 853.3 → `even` → **854** × 480 |

And for a portrait 1080×1920 phone video: `shortSide` = 1080, so the renditions are 1080×1920, 720×1280, 480×854. The short side decides, so a portrait video is never upscaled.

- `even()`: H.264 with 4:2:0 colour needs even width and height. `Math.max(2, …)` guards against a nonsense 0.
- A source smaller than 480 (e.g. 640×360) matches no rung, so it gets one rendition at its own size, named `360p`, with the 480p bitrates.

#### `buildHlsArgs`: the argument array

The real output for the 4K sample (one array element per line group):

```text
-y -i /tmp/klyro/video-abc/source
-filter_complex [0:v]split=3[v0][v1][v2];[v0]scale=1920:1080[o0];[v1]scale=1280:720[o1];[v2]scale=854:480[o2]
-map [o0] -map 0:a:0   -map [o1] -map 0:a:0   -map [o2] -map 0:a:0
-c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p
-force_key_frames expr:gte(t,n_forced*6) -sc_threshold 0
-c:a aac -ac 2
-b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 10000k -b:a:0 128k
-b:v:1 2800k -maxrate:v:1 2996k -bufsize:v:1 5600k  -b:a:1 128k
-b:v:2 1400k -maxrate:v:2 1498k -bufsize:v:2 2800k  -b:a:2 96k
-f hls -hls_time 6 -hls_playlist_type vod -hls_flags independent_segments
-hls_segment_filename %v/seg_%03d.ts -master_pl_name master.m3u8
-var_stream_map v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p
%v/index.m3u8
```

Section 7 explains each option. Things specific to the code:

- `flatMap` builds the repeated parts (`-map`, rates) once per rendition and flattens them into the array.
- `...(hasAudio ? [...] : [])` adds audio options only when there is audio. Mapping `0:a:0` on a silent file makes FFmpeg fail, so every audio part is conditional: maps, `-c:a`, `-b:a:i` and the `a:i` in `var_stream_map`.
- `-var_stream_map` is **one** array element containing spaces. With a shell you'd need quotes; with `spawn` it simply arrives as one argument.

**Check it yourself:** the ladders in [section 7's table](#in-the-code-srcworkerpipelinetranscodets) came from calling `planRenditions` directly.

#### `runFfmpeg`: wrapping a child process in a promise

```ts
export const runFfmpeg = (args, { cwd, durationSeconds, onProgress, signal }) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-hide_banner', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1', ...args],
      { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    …
    child.once('error', reject);
    child.once('close', (code, killedBy) => { … });
  });
```

A child process is an **event emitter**, not a promise. `new Promise` turns its events into one result:

```mermaid
flowchart LR
    S["spawn"] --> OUT["stdout 'data'<br/>progress lines"]
    S --> ERR["stderr 'data'<br/>keep last 2 KB"]
    S --> E["'error'<br/>couldn't start (ENOENT)<br/>or aborted"] --> REJ1(["reject"])
    S --> C["'close' (code)"]
    C -- "0" --> RES(["resolve"])
    C -- "aborted" --> REJ2(["reject: stopped"])
    C -- "stderr says bad input" --> REJ3(["reject: UnrecoverableError"])
    C -- "anything else" --> REJ4(["reject: Error (retried)"])
```

| Part | Why |
|---|---|
| `stdio: ['ignore', 'pipe', 'pipe']` | No input; we read stdout (progress) and stderr (errors) |
| `-progress pipe:1` | Machine-readable `key=value` progress lines on stdout (pipe 1) |
| `-nostats -loglevel error` | Turn off the human progress line and info messages on stderr, so stderr holds only real errors |
| `signal` in `spawn` options | When the signal aborts, Node kills FFmpeg and emits `'error'` with an `AbortError` |
| `once` instead of `on` | A promise settles once; `once` removes the listener after it fires |
| `'close'`, not `'exit'` | `'exit'` can fire before stdout and stderr are fully read; `'close'` waits for the streams too, so the last error lines are in `stderr` |

**Reading stdout line by line:**

```ts
let pending = '';
child.stdout.on('data', (chunk: string) => {
  const lines = (pending + chunk).split('\n');
  pending = lines.pop() ?? '';
  for (const line of lines) { … }
});
```

A `data` chunk is whatever bytes arrived, **not** one line. FFmpeg writes `out_time_us=12345678\n`, but a chunk might end in the middle: `out_time_us=123`. So the last, possibly incomplete piece is kept in `pending` and joined to the start of the next chunk. Without this, progress would occasionally read `123` instead of `12345678`.

**Progress:**

```ts
const fraction = Math.min(1, Math.max(0, Number(value) / (durationSeconds * 1e6)));
const percent = Math.floor(fraction * 100);
if (Number.isFinite(fraction) && percent > lastPercent) {
  lastPercent = percent;
  onProgress(fraction);
}
```

- `out_time_us` is microseconds of video encoded so far; dividing by the duration in microseconds gives 0–1.
- FFmpeg sometimes prints `out_time_us=N/A` → `NaN` → skipped by `isFinite`.
- The callback runs only when the **whole percent goes up**. FFmpeg reports twice a second, and each report becomes a Redis write in `job.updateProgress`, so this caps it at 100 writes per job.

**Error output:** `stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES)` keeps only the last 2 KB. FFmpeg's error is always at the end, and a long run could otherwise build up a large string.

#### `transcodeHls`

```ts
const renditions = planRenditions(meta);
await mkdir(outDir, { recursive: true });
await runFfmpeg(buildHlsArgs(source, renditions, meta.hasAudio), { cwd: outDir, … });
return renditions;
```

`mkdir` first because `spawn` with a `cwd` that doesn't exist fails with `ENOENT`, the same error as "FFmpeg not installed", which would be confusing to debug.

---

### 6. `pipeline/thumbnail.ts`

```ts
export const thumbnailTime = (durationSeconds: number) =>
  durationSeconds > SHORT_CLIP_SECONDS ? THUMBNAIL_AT_SECONDS : durationSeconds * 0.1;
```

`thumbnailTime` is exported on its own so the rule is easy to check: `31.88 → 5`, `3 → 0.3`, `10 → 1`. The FFmpeg call reuses `runFfmpeg`, so it gets the same no-shell spawn, abort and error classification. `at.toFixed(3)` avoids passing `0.30000000000000004` to FFmpeg. The FFmpeg options are explained in [section 10, Thumbnail](#thumbnail-stage-4).

---

### 7. `pipeline/upload.ts`: a worker pool without a library

```ts
const entries = await readdir(dir, { recursive: true, withFileTypes: true });
const files = entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
files.forEach(contentTypeFor);

let next = 0;
let bytes = 0;
let failure: Error | undefined;
const worker = async () => {
  while (failure === undefined && next < files.length) {
    const file = files[next++]!;
    const key = `${prefix}${path.relative(dir, file).split(path.sep).join('/')}`;
    try {
      const size = await uploadFile(file, bucket, key, signal);
      bytes += size;
    } catch (err) {
      failure ??= err instanceof Error ? err : new Error(String(err));
    }
  }
};
await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));
if (failure !== undefined) throw failure;
```

```mermaid
sequenceDiagram
    participant L1 as loop 1
    participant L2 as loop 2
    participant Q as files[next++]
    participant S3 as RustFS
    L1->>Q: take file 0
    L2->>Q: take file 1
    L1->>S3: PUT file 0
    L2->>S3: PUT file 1
    S3-->>L1: ok
    L1->>Q: take file 2
    S3-->>L2: ✖ error → failure = err
    Note over L2: loop condition false → stops
    S3-->>L1: ok (file 2 was already in flight)
    Note over L1: failure set → stops
    Note over L1,L2: Promise.all resolves only now,<br/>then uploadDir throws the first error
```

| Detail | Why |
|---|---|
| `files.forEach(contentTypeFor)` before uploading anything | An unknown extension throws **before** the first upload, so a stray file can't leave a half-uploaded folder |
| `files[next++]` is safe with 4 loops | JavaScript runs one piece of code at a time. Between reading `next` and incrementing it there's no `await`, so no other loop can run in between |
| `const size = await …; bytes += size;` | `bytes += await x` reads `bytes` **before** waiting, so concurrent loops overwrite each other's additions. That bug was measured: 12.2 MB reported for 36.7 MB |
| Errors are **stored**, not thrown inside the loop | Throwing would make `Promise.all` reject immediately while other uploads are still running. Those could land **after** the processor deleted the partial output, leaving orphans. Now `uploadDir` waits for every in-flight upload, then throws. Measured: after an abort, the object count when `uploadDir` returned was the same 2 s later |
| `failure ??= …` | Keep only the **first** error (`??=` assigns only if it's still undefined) |
| `.split(path.sep).join('/')` | On Windows `path.relative` gives `720p\seg_000.ts`; S3 keys must use `/` |
| `entry.parentPath` | With `recursive: true`, entries come from subfolders; `parentPath` says which one (Node ≥ 20.12) |

---

### 8. Types, the service and the repository

#### `lib/queue/queues.ts`

```ts
export type TranscodeOutput = { hlsPath: string; thumbnailPath: string; durationSeconds: number };

export type TranscodeJob = {
  videoId: string;
  requestId?: string;
  output?: TranscodeOutput;
};
```

`output` is the **checkpoint**. The API never sets it; the worker writes it with `job.updateData` after uploading. It's optional, so jobs enqueued by the API are unchanged.

#### `services/video.service.ts`

```ts
export const outputKeys = (videoId: string) => ({
  hlsPrefix: `${videoId}/`,
  hlsPath: `${videoId}/master.m3u8`,
  thumbnailPath: `${videoId}.jpg`,
});

export const markVideoReady = (videoId: string, output: TranscodeOutput) =>
  videoRepo.transition(videoId, 'PROCESSING', 'READY', output);

export const deleteVideoOutputs = async (videoId: string) => {
  const keys = outputKeys(videoId);
  const [segments] = await Promise.all([
    deletePrefix(BUCKETS.hls, keys.hlsPrefix),
    deleteObject(BUCKETS.thumbnails, keys.thumbnailPath),
  ]);
  return segments;
};
```

- **One place decides the storage layout.** The uploader writes to `outputKeys(id)` and the cleanup deletes `outputKeys(id)`. If they were written separately, a typo in one would leave files behind forever. Sprint 7's delete endpoint will reuse it.
- **`markVideoReady` is one conditional UPDATE**, `… SET status='READY', hls_path=…, thumbnail_path=…, duration_seconds=… WHERE id=… AND status='PROCESSING'`. It returns the row, or `undefined` if the video wasn't PROCESSING any more. A video is never READY without its paths.
- `Promise.all` deletes the HLS prefix and the thumbnail at the same time. Deleting a thumbnail that doesn't exist is not an error in S3.

#### `repositories/video.repository.ts`

`findByStatus(status, limit)`: a `db.query` entity fetch, newest first. Only the dev player uses it.

---

### 9. `worker/video.processor.ts`: tying it together

The file has four layers, each in its own function:

| Function | Responsibility |
|---|---|
| `processVideo` | **Policy:** shutdown? retry? give up? |
| `transcode` | **Orchestration:** check the row, checkpoint, temp folder, READY |
| `produce` | **Work:** the five pipeline steps, progress, timing |
| `failForGood` | **Final failure:** ERROR + careful cleanup |

#### One attempt from start to finish

```mermaid
sequenceDiagram
    participant B as BullMQ worker
    participant PV as processVideo
    participant T as transcode
    participant P as produce
    participant DB as Postgres
    participant S3 as RustFS
    B->>PV: job, token
    PV->>T: transcode(job)
    T->>DB: findById → must be PROCESSING
    alt job.data.output exists (earlier attempt uploaded)
        T->>T: skip produce
    else first time
        T->>T: rm + mkdir /tmp/klyro/<jobId>
        T->>P: produce()
        P->>S3: download raw
        P->>P: FAIL_RATE · probe · FFmpeg · thumbnail
        P->>S3: upload HLS + thumbnail
        P-->>T: { hlsPath, thumbnailPath, durationSeconds }
        T->>T: finally: rm temp folder
        T->>B: job.updateData({ output }) (checkpoint)
    end
    T->>DB: markVideoReady (WHERE status = PROCESSING)
    T-->>PV: result
    PV-->>B: completed
```

#### Module-level state

```ts
const WORK_ROOT = path.join(os.tmpdir(), 'klyro');
const PROGRESS = { downloaded: 10, transcodeStart: 10, transcodeEnd: 85, thumbnail: 90, uploaded: 100 };
const shutdown = new AbortController();
export const stopActiveJobs = () => shutdown.abort();
```

- `os.tmpdir()` is `/tmp` in the container and `%TEMP%` on Windows, so the same code works in both.
- **One `AbortController` for the whole process.** Shutting down means stopping *every* active job, so one signal shared by all of them is enough. `worker.ts` calls `stopActiveJobs()`; nothing else does.

#### Small helpers inside `produce`

```ts
const reporter = (job: Job, log: Logger) => (percent: number) => {
  void job.updateProgress(Math.round(percent)).catch((err: unknown) => {
    log.warn({ err }, 'could not report progress');
  });
};
```

`reporter` returns a function that **doesn't wait** for Redis (`void`): FFmpeg's progress callback is synchronous, and a slow Redis write must not slow the transcode. The `.catch` matters: an unhandled rejected promise crashes Node (our `unhandledRejection` handler shuts the worker down). A failed progress update only deserves a warning.

```ts
const timed = async <T>(phase: string, work: () => Promise<T>) => {
  const started = performance.now();
  try {
    return await work();
  } finally {
    timings[phase] = Math.round(performance.now() - started);
  }
};
```

- `<T>` makes it generic: `timed('probe', () => probe(...))` returns a `ProbeResult`, `timed('download', …)` a number, with no casts.
- `finally` records the time even if the step throws.
- `performance.now()` is a monotonic clock: it never jumps when the system clock is adjusted, unlike `Date.now()`.

#### The steps in `produce`

```ts
const sourceBytes = await timed('download', () => downloadSource(rawPath, source, signal));
progress(PROGRESS.downloaded);
if (Math.random() < env.FAIL_RATE) throw new Error('Simulated transient failure (FAIL_RATE)');

const meta = await timed('probe', () => probe(source, signal));

const span = PROGRESS.transcodeEnd - PROGRESS.transcodeStart;
const renditions = await timed('transcode', () =>
  transcodeHls(source, hlsDir, meta, (f) => progress(PROGRESS.transcodeStart + f * span), signal),
);
```

The transcode's 0–1 fraction is mapped onto 10–85 % of the bar: `10 + f × 75`. At `f = 0.5` the bar shows 47.5 → 48 %.

#### `transcode`: the checkpoint and the temp folder

```ts
let output = job.data.output;
if (output) {
  log.info('outputs already uploaded by an earlier attempt, skipping to READY');
} else {
  const dir = path.join(WORK_ROOT, String(job.id));
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    output = await produce(job, video.rawPath, dir, log);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  await job.updateData({ ...job.data, output });
}
const ready = await videoService.markVideoReady(videoId, output);
```

- `rm` **before** `mkdir`: if a previous attempt crashed (`kill -9`, power loss), its `finally` never ran and old files may still be there.
- `rm` in `finally`: runs on success, failure **and** abort.
- `force: true`: don't fail if the folder is already gone.
- `job.updateData` happens **after** the temp folder is deleted and **only** after a successful `produce`. A checkpoint means "the outputs are in RustFS", never "they're on this machine's disk".
- `{ ...job.data, output }` keeps `videoId` and `requestId`; `updateData` replaces the whole data object.

#### `processVideo`: the order of the checks

```ts
} catch (err) {
  if (shutdown.signal.aborted) {
    await job.moveToWait(token);
    throw new WaitingError();
  }
  if (!isFinalAttempt(job, err)) throw err;
  await failForGood(job, err, log);
  throw err;
}
```

1. **Shutdown first.** When FFmpeg is killed on SIGTERM, the error looks like any other failure. Without this check it would use up an attempt, or, on the last attempt, mark a perfectly good video as ERROR.
2. `moveToWait(token)` puts the job back in `wait`. The `token` proves this worker owns the job's lock.
3. `throw new WaitingError()` tells BullMQ "I've already moved this job". BullMQ's `handleFailed` recognises the error type and skips `moveToFailed`, so no attempt is counted.
4. Otherwise: not the last attempt → rethrow, BullMQ retries after the backoff. Last attempt → `failForGood`, then rethrow so the job shows as failed in Bull Board.

#### `failForGood`: careful cleanup

```ts
const reason =
  err instanceof UnrecoverableError ? err.message : `Processing failed after ${job.attemptsMade + 1} attempts`;
const failed = await videoService.markVideoFailed(videoId, reason).catch(… return undefined);

if (failed) {
  deletedOutputs = await videoService.deleteVideoOutputs(videoId).catch(… return undefined);
}
```

| Guard | What it prevents (all three seen in testing) |
|---|---|
| Only `UnrecoverableError` messages reach `error_message` | A Postgres error's message contains the whole SQL statement and its parameters; users would see it |
| Clean up **only if** `markVideoFailed` returned a row | A duplicate job for a READY video fails with "Video is READY". Deleting outputs then would destroy a working video |
| Both calls `.catch` and log | Failure handling must not throw a *new* error that hides the original one |

---

### 10. `worker.ts`: shutdown order

```ts
const closing = videoWorker.close();
stopActiveJobs();
await closing;
```

`close()` is started **first**, which immediately marks the worker as closing so it fetches no new jobs. Only then are active jobs aborted. In the opposite order, the worker could fetch a fresh job in the moment between the abort and the close, and immediately abort it too. `close()` then waits for the aborted jobs to finish their `catch` (`moveToWait`).

#### One `AbortSignal` through every layer

```mermaid
flowchart TD
    SIG["SIGTERM"] --> W["worker.ts<br/>stopActiveJobs()"]
    W --> AC["shutdown.abort()<br/>(video.processor.ts)"]
    AC --> D["downloadObject<br/>S3 request + file pipeline"]
    AC --> PR["probe<br/>execFile kills ffprobe"]
    AC --> FF["runFfmpeg / makeThumbnail<br/>spawn kills FFmpeg"]
    AC --> UP["uploadObject<br/>S3 requests cancelled"]
    D & PR & FF & UP --> ERR["AbortError thrown"]
    ERR --> FIN["finally: temp folder deleted"]
    FIN --> PV["processVideo: signal.aborted<br/>→ moveToWait + WaitingError"]
```

`AbortSignal` is Node's standard way to cancel async work. The S3 SDK, `pipeline`, `execFile` and `spawn` all accept one, so a single `abort()` stops whatever the job happens to be doing at that moment.

---

### 11. `scripts/hls-player.ts`: the dev player

Not part of the product: it exists because the buckets are private and Sprint 7 hasn't built signed streaming yet. Run with `npm run videos:play` (options `--port`, `--kbps`).

| Route | Does |
|---|---|
| `GET /` | Lists READY videos that have an `hls_path` (the Sprint 5 stub left READY rows without files) |
| `GET /watch/<uuid>` | The player page: hls.js, quality and bandwidth display, quality and network buttons, event log |
| `GET /hls/<uuid>/<file>.m3u8\|.ts` | Streams the object from `hls-output`, optionally throttled |
| `GET /thumb/<uuid>.jpg` | Streams the thumbnail |
| `POST /throttle?kbps=N` | Sets the throttle for later requests (0 = unlimited) |

Things worth reading in it:

- **Routes are regular expressions** that only accept a UUID and simple file names: `^/hls/(<uuid>)/((?:[\w-]+/)?[\w-]+\.(?:m3u8|ts))$`. `../../etc/passwd` can't match, so it's a 404 before any storage call.
- **`server.listen(port, '127.0.0.1')`**: only reachable from this machine. It has no authentication, so it must not be on the network.
- **`escapeHtml`** for video titles: titles are user input, and the page is built as an HTML string.
- **The throttle** is a `Transform` stream between S3 and the response that delays each chunk by `chunk.length × 8 / kbps` milliseconds. Bits ÷ (kilobits per second) = milliseconds. Measured: a 2.1 MB segment at 1.5 Mbps took 11.8 s (theory 11.25 s).
- **`req.once('close', () => controller.abort())`**: when the browser cancels a request (closing the tab, seeking, or hls.js abandoning a segment), the S3 download stops too.
- A bug found while testing it: in the network button handler, `e.currentTarget` was read **after** `await fetch(...)`. Browsers set `currentTarget` to `null` once the event has finished dispatching, so the code now saves it in a variable before the `await`.

---

### Review checklist

Work through these with the code open. Each one has an answer in this section or can be checked with a command.

**Containers**

- [ ] Why does the `worker` stage start `FROM base` instead of `FROM api`?
- [ ] What would go wrong without `.dockerignore`?
- [ ] Why `postgres:5432` inside Compose but `localhost:5433` from Windows?
- [ ] What do `init: true` and `stop_grace_period` each protect against?

**Pipeline**

- [ ] Why does `downloadObject` check the size on disk after `pipeline` finishes?
- [ ] `exec`, `execFile`, `spawn`: which one is never used, and why?
- [ ] Which ffprobe failures are retried, and which aren't?
- [ ] Work out `planRenditions` by hand for 2560×1440 and for 1440×2560.
- [ ] Why does `runFfmpeg` keep a `pending` string?
- [ ] Why `'close'` and not `'exit'`?
- [ ] In `uploadDir`, why can't two loops get the same file? Why is the error stored instead of thrown?

**Processor**

- [ ] Trace a job where the READY update fails once. Which log lines appear, and how long does attempt 2 take?
- [ ] Why is the checkpoint saved after the upload and not after the transcode?
- [ ] Why is the shutdown check the **first** thing in `processVideo`'s `catch`?
- [ ] Give a concrete case where deleting outputs without checking `markVideoFailed`'s result destroys a good video.
- [ ] Why does `reporter` use `void` *and* `.catch`?

**Try it yourself**

```bash
docker compose up -d --build worker      # from the repo root; or: cd backend && npm run dev:worker
docker compose logs -f worker            # watch for "source probed" and "outputs uploaded"
cd backend && npm run videos:play        # then open http://localhost:4100
```

- Upload something with `npm run upload -- <file> --club <clubId>` and watch progress in Bull Board.
- Stop the worker container during a transcode, check the job in Bull Board (`waiting`, attempts 0), start it again.
- Upload a renamed `.txt` file as a video and look at the `error_message` it ends with.

### Known gaps and follow-ups

| Gap | Why it matters | When |
|---|---|---|
| No 360p rung | At 1.5 Mbps even 480p (peak 1.65 Mbps) stalled briefly | Ladder change, small |
| No automated tests | `planRenditions`, `buildHlsArgs`, `thumbnailTime` and `contentTypeFor` are pure and easy to unit-test | Sprint 11 adds Vitest |
| FFmpeg 5.1 in the container vs 9.0 on Windows | Different `BANDWIDTH` values in the master playlist; options must work in both | Pin or upgrade when it matters |
| `maxStalledCount` is BullMQ's default (1) | A job whose worker crashes twice is failed as stalled. Graceful shutdowns don't count (they use `moveToWait`) | Revisit if crashes become common |
| No `Cache-Control` on HLS objects | Segments never change and could be cached for a year; playlists for short times | With a CDN, later |
| `secondsPerGb` depends on the source bitrate | A 1080p GB has 4× more video than a 4K GB; time relative to video length is steadier ([NOTES.md](../NOTES.md)) | Log both if needed |
| 26 READY rows from the Sprint 5 stub have no files | The player filters them out; a real list endpoint should too | Clean up the demo data, or filter in Sprint 7 |


## 12. Glossary and further reading

| Term | Meaning |
|---|---|
| **Transcode** | Decode a video and encode it again in a different format, size or bitrate |
| **Rendition / variant** | One quality level (e.g. 720p at 2800 kbps) |
| **Ladder** | The list of renditions |
| **Segment** | A short, independently playable piece of one rendition |
| **Master playlist** | Lists the renditions; the URL you give the player |
| **Variant playlist** | Lists the segments of one rendition |
| **ABR** | Adaptive bitrate: the player switches renditions as bandwidth changes |
| **Keyframe (I frame)** | A complete picture; decoding can start here |
| **GOP** | The frames from one keyframe to the next |
| **VBV** (`maxrate`/`bufsize`) | Limits how far the bitrate may burst above average |
| **Profile / level** | Which H.264 features and how much resolution × frame rate a decoder must support |
| **Mux / container** | The file wrapper around encoded streams (`.ts`, `.mp4`) |

- [Apple: HTTP Live Streaming](https://developer.apple.com/documentation/http-live-streaming) and the [HLS authoring spec](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices) (ladder, segment length, keyframes)
- [FFmpeg HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2) (`var_stream_map`, `master_pl_name`, `hls_flags`)
- [FFmpeg H.264 encoding guide](https://trac.ffmpeg.org/wiki/Encode/H.264) (presets, CRF vs bitrate, VBV)
- [ffprobe documentation](https://ffmpeg.org/ffprobe.html)
- [hls.js demo page](https://hlsjs.video-dev.org/demo/): paste a master URL, watch the level switches
- [RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216): the HLS specification
