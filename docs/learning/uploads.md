# Resumable video uploads (S3 multipart)

How a multi-gigabyte video gets from a user's disk into RustFS without passing through the API, and how an interrupted upload picks up where it stopped. Every section points at real code. See also [locking.md](locking.md) (section 7) for how complete and abort stay consistent.

## The problem

A naive upload is `POST /videos` with the whole file in the body:

- **The API carries every byte.** A 5 GB video ties up an API process, its memory and its bandwidth for the whole transfer. Ten uploads at once and the API is a file proxy, not an API.
- **One failure loses everything.** At 4.9 GB the Wi-Fi drops and the user starts again from 0.
- **One connection is slow.** A single TCP stream rarely uses the full bandwidth available.

Multipart upload with presigned URLs fixes all three:

| Problem | Fix |
|---|---|
| API carries bytes | The client sends bytes **straight to storage** using URLs the API signed |
| Failure loses everything | The file is cut into **parts**; only the parts that didn't arrive are re-sent |
| One slow connection | Parts upload **in parallel** |

## Object storage in two minutes

RustFS speaks the **S3 API**, the same protocol as AWS S3, so the AWS SDK works against it unchanged.

- A **bucket** is a top-level container: `raw-uploads`, `hls-output`, `thumbnails` (`lib/storage/client.ts`).
- An **object** is a file, addressed by a **key**: `clubs/{clubId}/videos/{videoId}/original.mp4`. The slashes are just characters in the name; there are no real folders.
- Buckets are **private**. Every request must be signed with the access key and secret (`S3_ACCESS_KEY` / `S3_SECRET_KEY`).
- `forcePathStyle: true` puts the bucket in the path (`localhost:9000/raw-uploads/key`) instead of a subdomain (`raw-uploads.localhost:9000`), which local setups need.

## The whole flow

```
 client (CLI / browser)                 API                          RustFS                 Postgres
 │                                       │                              │                       │
 │ 1 POST /clubs/:clubId/videos/uploads  │                              │                       │
 │   {title, contentType, sizeBytes} ───►│ validate, role check         │                       │
 │                                       │ CreateMultipartUpload ──────►│ opens a session       │
 │                                       │◄──────────────── UploadId ───│                       │
 │                                       │ insert video UPLOADING (+uploadId) ─────────────────►│
 │◄── {videoId, partSize, partCount} ────│                              │                       │
 │                                       │                              │                       │
 │ 2 POST /videos/:id/upload/parts       │                              │                       │
 │   {partNumbers:[1,2,3,4]} ───────────►│ sign 4 URLs (no network)     │                       │
 │◄── [{partNumber, url}, …] ────────────│                              │                       │
 │                                                                      │                       │
 │ 3 PUT url₁ (bytes 0…8 MiB) ─────────────────────────────────────────►│ store part 1          │
 │◄───────────────────────────────────────────────── ETag "129f…" ──────│                       │
 │   … parts 2-4 in parallel, then ask for the next batch …             │                       │
 │                                                                      │                       │
 │ 4 (after a crash) GET /videos/:id/upload/parts ─►│ ListParts ───────►│                       │
 │◄── {uploaded:[…], missing:[…]} ─────────────────│◄── parts + ETags ──│                       │
 │                                                                      │                       │
 │ 5 POST /videos/:id/upload/complete    │                              │                       │
 │   {parts:[{partNumber, etag}, …]} ───►│ lock row; Complete… ────────►│ stitch → one object   │
 │                                       │ transition → PROCESSING ────────────────────────────►│
 │◄── {videoId, status: PROCESSING} ─────│                              │                       │
```

The API only ever handles small JSON. The video bytes go client → RustFS.

## Step 1: initiate

`POST /clubs/:clubId/videos/uploads` → `services/video.service.ts` `initiateUpload`

1. **Validate** (`validators/video.schema.ts`): `contentType` must be `video/mp4`, `video/quicktime` or `video/x-msvideo`; `sizeBytes` must be 1 byte to 5 GB. The extension comes from `VIDEO_TYPES[contentType]`, **never from a client filename**, so nobody can choose `original.exe`.
2. **Authorise**: `requireClubRole('club_owner')` lets `club_owner` and `admin` through.
3. **Pick the id first** (`randomUUID()`), because it's part of the key.
4. **Plan the parts** (`lib/storage/multipart.ts` `planParts`).
5. **Open the session**: `CreateMultipartUpload` returns an `UploadId`.
6. **Insert** the video row as `UPLOADING`, storing `raw_path`, `upload_id` and the declared `size_bytes`.

**Order matters.** Storage first, then the database. If the insert fails, the service aborts the session so nothing is orphaned. The other way round, a storage failure would leave a row stuck in `UPLOADING` with no session behind it.

**`uploadId` never leaves the server.** The client only knows the `videoId`. Every later call looks up the `uploadId` from the row, so a client can't point at someone else's session.

### Part sizing

S3 rules: at most **10,000 parts**, and every part except the last must be at least **5 MiB** (max 5 GiB per part).

```ts
const partSize = Math.max(8 * MiB, Math.ceil(size / 10_000));
const partCount = Math.ceil(size / partSize);
```

| File | partSize | partCount | last part |
|---|---|---|---|
| 20,000,000 B | 8 MiB | 3 | 3,222,784 B |
| 1 GiB | 8 MiB | 128 | 8 MiB |
| 5 GiB | 8 MiB | 640 | 8 MiB |

Bigger parts mean fewer requests, but more to resend after a failure. 8 MiB is a common middle ground.

## Step 2: presigned URLs

`POST /videos/:videoId/upload/parts` → `presignUploadParts` → `lib/storage/multipart.ts` `presignParts`

RustFS doesn't know about our users, clubs or roles. It only checks **signatures made with our secret key**. A presigned URL is a request the API has already signed, which the client can send without the secret:

```
http://localhost:9000/raw-uploads/clubs/…/original.mov
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential=klyro/20261005/us-east-1/s3/aws4_request   ← access key + scope, never the secret
  &X-Amz-Date=20261005T175806Z
  &X-Amz-Expires=3600
  &X-Amz-SignedHeaders=host
  &X-Amz-Signature=c976c3…                                      ← HMAC over method + path + query + host
  &partNumber=1&uploadId=NjAw…
```

The signature covers the method, key, part number, upload id, expiry **and host**. Change any of them and RustFS returns 403. Measured:

| Request | Result |
|---|---|
| `PUT` to the URL as issued | 200 + ETag |
| `partNumber=1` changed to `2` | 403 |
| key changed to `evil.exe` | 403 |
| no signature | 403 |
| after expiry | 403 |

So a URL is a **capability**: whoever holds it can upload *that one part of that one session*, for an hour. It can't read anything, write elsewhere or touch other parts.

**Signing is local maths.** `getSignedUrl` computes an HMAC; it makes no network call.

**Why two S3 clients** (`s3` and `s3Public`): the host is part of the signature. The API reaches storage at `S3_ENDPOINT` (later `http://rustfs:9000` inside Docker), but the browser must use `S3_PUBLIC_ENDPOINT` (`http://localhost:9000`, or `https://storage.example.com` in production). URLs are signed with `s3Public` so their host is one the client can reach. Both addresses exist in every environment, which is why this is two env vars rather than a `NODE_ENV` switch.

**Gatekeeping** (`loadOwnUpload`): the caller must be the uploader, *still* hold `club_owner`/`admin` in the club, and the video must be `UPLOADING`. Anyone else gets **404** (the same as a missing video, so it doesn't leak that an upload exists). A finished upload gets **409**. Part numbers are checked against `planParts(size_bytes)` from the database, not against anything the client sends.

**Batches of up to 100**, not all at once: fewer live capabilities, and URLs don't expire before the client reaches them.

## Step 3: uploading parts and the ETag

The client reads each part straight from its local file and `PUT`s it:

```
part n = bytes [(n-1) × partSize, min(n × partSize, fileSize) − 1]
```

```ts
fs.createReadStream(file, { start, end });   // Node CLI
file.slice(start, end + 1);                  // browser File/Blob
```

RustFS answers each successful part with an **ETag**.

### What an ETag is

An **entity tag** is a standard HTTP header: a fingerprint of a resource's content. If the content changes, the ETag changes. Browsers use it for caching (`If-None-Match` → `304 Not Modified`). The double quotes are part of the HTTP syntax: `ETag: "129f87f2…"`.

How S3/RustFS compute it:

| What | ETag |
|---|---|
| A single `PUT` object | MD5 of the bytes |
| One part of a multipart upload | MD5 of that part's bytes |
| A completed multipart object | MD5 of the concatenated binary part-MD5s, plus `-N` |

Verified on a real upload:

```
part 2 PUT  → etag c6ab44b4…   md5sum → c6ab44b4…   ✓
completed   → "2e049aefc918154025a2a5a90dce404d-3"
              = md5(md5₁ ‖ md5₂ ‖ md5₃) + "-3"         ✓
```

So you **can't** check a multipart object with `md5sum` of the whole file; the `-3` tells you it was built from 3 parts.

### Why multipart needs ETags: receipts

A part number is a **slot**, and a slot can be written more than once (a retry after a timeout, two tabs). Each write gets a new ETag, and the last one wins:

```
PUT part 2 (bytes A) → "c6ab…"
PUT part 2 (bytes B) → "bdd8…"     ← slot 2 now holds B; "c6ab…" no longer exists
```

At the end the client hands back one **receipt** per part, which says "stitch *these exact versions*." Completing with the stale `c6ab…` fails (`InvalidPart` → our 400 `UPLOAD_INCOMPLETE`), and the video stays `UPLOADING` so the client can fix it and retry. The ETags guard against assembling bytes the client didn't mean to send.

### CORS: why the browser can read the ETag

A browser page on `localhost:5173` calling `localhost:9000` is a **cross-origin** request, so RustFS's bucket CORS rule (`scripts/storage-init.ts`) must allow it:

- `AllowedOrigins: FRONTEND_URL`, `AllowedMethods: ['PUT', 'GET']`: the preflight `OPTIONS` passes.
- `ExposeHeaders: ['ETag']`: without it, JavaScript sees the 200 but **can't read the ETag header**, so it has no receipts and can never complete.

CORS is a browser rule only; the Node CLI ignores it.

## Step 4: resume

`GET /videos/:videoId/upload/parts` → `getUploadProgress` → `listUploadedParts` (`ListParts`)

The session on RustFS **already remembers every part** that fully arrived. A `PUT` either stores the whole part and returns an ETag, or stores nothing, so there are no half-parts. Nobody needs to store progress:

| Who | Knows |
|---|---|
| RustFS | which parts it **has** (number, size, ETag) |
| Postgres | `size_bytes` → how many parts there **should** be |
| Client | the file itself |

```
missing = {1 … partCount} − {parts RustFS has}
```

```json
{ "partSize": 8388608, "partCount": 3, "sizeBytes": 20000000,
  "uploadedBytes": 16777216,
  "uploaded": [{ "partNumber": 1, "etag": "\"129f…\"", "size": 8388608 }, …],
  "missing": [3] }
```

The resuming client:
1. calls this, and gets back its lost receipts plus the missing list;
2. starts the progress bar at `uploadedBytes / sizeBytes`;
3. presigns and uploads only `missing`, reading those byte ranges from disk;
4. completes with old and new receipts together.

**Why not a `parts` table in Postgres?** A part only counts once storage has it. If the client had to report each part to the API, a crash between "stored" and "reported" would desync the two. Asking the storage server means there's one source of truth.

`ListParts` returns at most 1,000 parts per page, so `listUploadedParts` loops on `NextPartNumberMarker` while `IsTruncated` is set.

## Where the file lives, and who knows what

Resume only works because **the client still has the file**. The API never knows where it is, and never needs to.

```
 YOUR LAPTOP                                   SERVER SIDE
 ┌──────────────────────────────────┐          ┌───────────────────────────────────────┐
 │ D:\videos\final.mp4  (228 MB)    │          │ API + Postgres                         │
 │   only the client knows this path│          │   videos row: id, size_bytes=239266402,│
 │                                  │          │   upload_id, raw_path (storage key)    │
 │ backend\.upload-state\d410….json │          │   (no laptop path, no bytes)           │
 │   {"videoId": "31852180…"}       │          │                                        │
 │   the bookmark: which upload     │          │ RustFS session (upload_id)             │
 │   belongs to this file           │          │   parts 1–8 stored, with ETags         │
 └──────────────────────────────────┘          └───────────────────────────────────────┘
```

| Piece of knowledge | Lives on | Who uses it |
|---|---|---|
| The **file path** and **the bytes** | the laptop only | the client reads byte ranges from it |
| Which upload this file belongs to (`videoId`) | the laptop (`.upload-state/`) | the client, to know which upload to resume |
| How many parts there should be (`size_bytes` → `partCount`) | Postgres | the API |
| Which parts arrived (number, size, ETag) | RustFS | the API asks it with `ListParts` |

The API never asks "where is your file?". It only ever talks in terms of `videoId` and part numbers. The client is the only one that can turn "part 9" into bytes, because only it can open the file:

```
part 9  →  bytes [8 × 8 MiB, 9 × 8 MiB)  →  fs.read(file, start = 67108864, length = 8388608)
```

**What a resume looks like, from the client's side:**

```
1. user runs:  npm run upload -- D:\videos\final.mp4 --club …
2. CLI fingerprints the file (path + size + mtime) → d410…
3. CLI finds .upload-state\d410….json → videoId 31852180…        (laptop memory)
4. CLI → API:  GET /videos/31852180…/upload/parts
5. API → RustFS: ListParts → parts 1–8                            (storage memory)
6. API → CLI:  { missing: [9 … 29], uploaded: [receipts 1–8] }
7. CLI reads bytes for parts 9–29 from D:\videos\final.mp4 and PUTs them to RustFS
8. CLI → API: complete with receipts 1–29
```

**What breaks resume, and what happens:**

| Situation | Result |
|---|---|
| File deleted or moved | The client can't read the missing bytes. The upload can't be finished from this machine and stays `UPLOADING` until it's aborted or cleaned up (Sprint 5). |
| File edited (different bytes, size or mtime) | New fingerprint → the CLI starts a **new** upload, so it never mixes old parts with new bytes. If the size stayed the same but the bytes changed, old parts and new parts would make a corrupt video; the fingerprint exists to prevent that. |
| `.upload-state/` deleted | The client forgets the `videoId` → starts a new upload. The old one is orphaned (same cleanup story). |
| A different laptop with a copy of the same file | Works, if that client knows the `videoId`. The server side only needs the `videoId` and the right bytes for each part. |
| Browser tab closed | A browser can't reopen a file by itself. The user has to pick the same file again; the page matches it (name + size + lastModified) to a saved `videoId` in `localStorage`, then resumes the same way. |

So "resume" is a cooperation: **RustFS remembers what it has, Postgres remembers what it should have, and the client remembers which upload it was and still has the bytes.** Lose any one of those and you start over.

## Step 5: complete and abort

### Complete

`POST /videos/:videoId/upload/complete` `{ parts: [{ partNumber, etag }] }` → `completeVideoUpload`

1. The receipts must cover **exactly** parts `1…partCount`; otherwise 400 `PARTS_MISMATCH` with `missing`/`unexpected`.
2. `completeUpload` **sorts** them (S3 requires ascending order) and **re-quotes** ETags (`quoteEtag`), so clients that strip quotes still work.
3. RustFS stitches the parts into one object, without copying the bytes through anything. The session and its separate parts are gone; `raw-uploads` now lists the object, with the `ContentType` given at initiation.
4. **Size check** (`getStoredSize` → `HeadObject`): the stitched object's real `ContentLength` is compared with the declared `size_bytes` (see below).
5. `transition(UPLOADING → PROCESSING, { uploadId: null })`.

### Verifying the size

The client *declared* the size at initiation, and the part plan, the 5 GB limit and the progress bar all rely on it. RustFS never saw that promise and stores whatever arrives (any part up to 5 GiB). So after stitching, the API asks storage what it really holds. `HeadObject` returns only metadata, so it's cheap even for 5 GB.

On a mismatch the object is deleted (`deleteRawObject`), the video goes `UPLOADING → ERROR` with a reason, and the client gets 400 `SIZE_MISMATCH` `{declared, actual}`. It never enters `PROCESSING`, so a worker can never pick it up. Measured:

| Last part | Stored | Result |
|---|---|---|
| 1,000,000 B (short) | 17,777,216 | 400, `ERROR` "Uploaded 17777216 bytes but 20000000 were declared", object deleted |
| 6,000,000 B (long) | 22,777,216 | 400, `ERROR`, object deleted |
| 3,222,784 B (correct) | 20,000,000 | 200, `PROCESSING`, object kept |

**Commit, then fail the request.** The `ERROR` status is written inside `withUploadLock`'s transaction. Throwing there would roll it back, leaving the video `UPLOADING` and the object deleted, so the database and storage would disagree. So the callback *returns* `{ video, sizeMismatch }`, and the service throws the 400 after the transaction has committed.

Storage errors are mapped to useful messages:

| S3 error | Meaning | Response |
|---|---|---|
| `InvalidPart` | a part is missing or an ETag doesn't match | 400 `UPLOAD_INCOMPLETE`, video stays `UPLOADING` |
| `InvalidPartOrder` | not ascending | 400 |
| `EntityTooSmall` | a non-last part < 5 MiB | 400 |
| `NoSuchUpload` | session already completed or aborted | 409 |

### Abort

`DELETE /videos/:videoId/upload` → `abortVideoUpload`

`AbortMultipartUpload` deletes every stored part, then `transition(UPLOADING → ERROR, { errorMessage })`. Abort is idempotent towards storage: a `NoSuchUpload` is ignored, since the goal (no session) is already met.

### Keeping storage and database in agreement

Complete and abort each do **an S3 call and a status change**. Both run inside `withUploadLock`, a `SELECT … FOR UPDATE` on the video row held across the S3 call, so for one video they run one after the other and the loser gets 409. Details and the trade-off are in [locking.md](locking.md), section 7.

Measured after the tests: `PROCESSING` rows = objects in the bucket, the aborted `ERROR` row has no parts left, and there are 0 open sessions.

## The CLI client

`backend/src/scripts/upload.ts` is a complete resumable client, and the reference for the future browser uploader.

```bash
cd backend
export KLYRO_EMAIL=you@example.com KLYRO_PASSWORD='…'
npm run upload -- ~/videos/final.mp4 --club <clubId> --title "Cup final"
```

```
started 08193acb…: 128 parts of 8.0 MB, 4 at a time
[#####.........................]  15.6%  160.0 MB / 1024.0 MB  154.1 MB/s     ← killed here
resuming 08193acb…: 20/128 parts already stored
[##############################] 100.0% 1024.0 MB / 1024.0 MB
done: video 08193acb… is PROCESSING
```

What it does, and why:

| Behaviour | How | Why |
|---|---|---|
| Remembers the upload | `.upload-state/<fingerprint>.json` holds `videoId`; fingerprint = path + size + mtime | Editing the file starts a new upload instead of mixing old parts with new bytes |
| Resumes | On start, `GET …/upload/parts`; 404/409 → start over | Storage is the source of truth; the receipts come back from `ListParts` |
| Reads only what it sends | `handle.read(buffer, 0, length, (n-1) × partSize)` | Missing parts are byte ranges of the local file |
| Parallel, bounded | 4 workers pull from a shared queue | Throughput without 640 sockets; memory stays at 4 × 8 MiB |
| Presigns in batches | 32 part numbers per request | Few API calls, few live URLs |
| Retries | Each part up to 4 attempts with exponential backoff | A blip on one part doesn't kill a 5 GB upload |
| Survives token expiry | On 401, `POST /auth/refresh` with the `rt` cookie; logs in again only if that fails | Uploads can outlive an access token, and logging in is rate-limited (5 per 15 min) |
| Completes | Old receipts + new ones → `…/complete`, then deletes the state file | |

Measured: a 1 GB file killed at 16% resumed from part 21/128, and the stored object's SHA-256 matched the local file exactly.

## The video state machine

```
            complete ok              worker finishes (Sprint 6)
UPLOADING ─────────────► PROCESSING ─────────────► READY
    │                        │
    │ abort / size mismatch  │ processing fails
    ▼                        ▼
  ERROR ◄────────────────────┘
```

`TRANSITIONS` in `repositories/video.repository.ts` is the single source of truth. `transition(id, from, to, changes)` throws `IllegalTransitionError` for an arrow that isn't allowed (a bug → 500) and returns `undefined` when the row has already moved (a normal race → 409). `READY` and `ERROR` are terminal.

## Endpoints

| Method | Path | Who | Returns |
|---|---|---|---|
| POST | `/clubs/:clubId/videos/uploads` | `club_owner`, `admin` | 201 `{videoId, status, partSize, partCount}` |
| POST | `/videos/:videoId/upload/parts` | the uploader | `{expiresAt, parts:[{partNumber, url}]}` |
| GET | `/videos/:videoId/upload/parts` | the uploader | `{partSize, partCount, sizeBytes, uploadedBytes, uploaded, missing}` |
| POST | `/videos/:videoId/upload/complete` | the uploader | `{videoId, status: "PROCESSING"}` |
| DELETE | `/videos/:videoId/upload` | the uploader | 204 |

The `/videos/:videoId/upload/*` routes return 404 for anyone but the uploader (who must still be `club_owner`/`admin`), and 409 once the upload is finished.

## Not covered yet

- **Abandoned uploads.** A session nobody completes or aborts keeps its parts forever. That needs a cleanup job (Sprint 5).
- **Content checks.** We trust `contentType`; `ffprobe` verifies the file really is a video (Sprint 6).

## Try it yourself

```bash
# console: http://localhost:9001  (S3_ACCESS_KEY / S3_SECRET_KEY)
npm run storage:init                      # buckets + CORS, safe to rerun

# a part's ETag is its MD5
head -c 8388608 /dev/urandom > p.bin
curl -s -D - -o /dev/null -X PUT --data-binary @p.bin "<presigned url>" | grep -i etag
md5sum p.bin
```

1. Initiate a 20 MB upload, upload part 1 only, then call `GET …/upload/parts`: `missing` is `[2, 3]`.
2. Upload part 2 twice with different bytes and watch its ETag change in `GET …/upload/parts`.
3. Complete with the *first* ETag for part 2: 400, status still `UPLOADING`. Then complete with the right one.
4. Look at `raw-uploads` in the console before and after completing.

## Cheat sheet

| Term | Meaning |
|---|---|
| Multipart upload | A session on storage (`UploadId`) that collects parts and stitches them on complete |
| Part | A numbered slot (1-10,000), 5 MiB to 5 GiB except the last |
| Presigned URL | A pre-signed request; a time-limited capability for one operation |
| ETag | Content fingerprint; for a part, its MD5; the receipt you hand back on complete |
| `ListParts` | What storage has: the basis of resume |
| `Complete` | Sorted receipts → one object |
| `Abort` | Delete all parts, end the session |
| `HeadObject` | Metadata only (size, type, ETag); used to verify the declared size |
| `ExposeHeaders: ETag` | Lets browser JS read the receipt |
