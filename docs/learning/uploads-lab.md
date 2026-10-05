# Uploads lab: test steps 7–11 yourself

A hands-on companion to [uploads.md](uploads.md). Each lab starts with the idea in a few lines, then gives commands to run and what you should see. You'll do by hand what the CLI does automatically, then let the CLI do it. Read [Where the file lives](uploads.md#where-the-file-lives-and-who-knows-what) first: it explains why resume needs the file on your disk, and why the API never knows where that is.

Everything uses `bruno/videos/fixtures/sample-video.mp4`: **239,266,402 bytes (228.2 MiB)**. It's git-ignored (GitHub rejects files over 100 MB), so each machine needs its own copy at that path; any mp4 works, but the numbers below are for this one. The API plans it as:

| partSize | partCount | parts 1–28 | part 29 (last) |
|---|---|---|---|
| 8,388,608 (8 MiB) | 29 | 8,388,608 bytes each | 4,385,378 bytes |

Run all commands in **Git Bash** from the repo root.

## 0. Setup

```bash
docker compose up -d                      # postgres, redis, mailpit, rustfs
(cd backend && npm run storage:init)      # buckets + CORS
(cd backend && npm run dev)               # in a second terminal: API on :4000
```

Helpers for this shell session (paste once):

```bash
API=http://localhost:4000
VIDEO=bruno/videos/fixtures/sample-video.mp4
SIZE=239266402
PART=8388608
json() { node -pe "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); $1"; }
```

Register, log in and create a club:

```bash
EMAIL=lab-$RANDOM@example.com; PASS='Passw0rd!lab'
curl -s -X POST $API/auth/register -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" >/dev/null
TOKEN=$(curl -s -X POST $API/auth/login -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | json j.accessToken)
H=(-H "authorization: Bearer $TOKEN" -H 'content-type: application/json')
CLUB=$(curl -s -X POST $API/clubs "${H[@]}" -d '{"name":"Lab club"}' | json j.club.id)
echo "token ${#TOKEN} chars, club $CLUB"
```

If `TOKEN` comes back `undefined`, you hit the login rate limit (5 per 15 minutes); see [Troubleshooting](#troubleshooting).

Start an upload. This is step 6, the starting point for everything below:

```bash
V=$(curl -s -X POST $API/clubs/$CLUB/videos/uploads "${H[@]}" \
  -d "{\"title\":\"Bike ride\",\"contentType\":\"video/mp4\",\"sizeBytes\":$SIZE}" | json 'console.error(j), j.videoId')
```

Expect `{ videoId, status: 'UPLOADING', partSize: 8388608, partCount: 29 }`.

Two more helpers, now that `$V` exists:

```bash
presign() { curl -s -X POST $API/videos/$V/upload/parts "${H[@]}" -d "{\"partNumbers\":[$1]}" | json 'j.parts[0].url'; }
part()    { dd if=$VIDEO bs=$PART skip=$(($1 - 1)) count=1 status=none; }   # the bytes of part N, read from the local file
```

`part` is the core client idea: part N is just a byte range of the file, `[(N-1) × 8 MiB, N × 8 MiB)`. Nothing on the server ever extracts it.

```bash
part 1  | wc -c     # 8388608
part 29 | wc -c     # 4385378
```

## Lab 1: presigned URLs (step 7)

**Idea.** RustFS knows nothing about users or clubs; it only checks signatures made with the secret key. The API decides *who* may upload, then signs a URL for one part of one session for one hour. Whoever holds the URL can do exactly that, and nothing else.

**1a. Look inside a URL**

```bash
URL=$(presign 1)
node -e 'const u=new URL(process.argv[1]); console.log(u.origin+u.pathname); for (const [k,v] of u.searchParams) console.log(" ", k.padEnd(22), v.slice(0,60))' "$URL"
```

Find: the host (`localhost:9000`, because it was signed with `s3Public`), `X-Amz-Expires=3600`, `X-Amz-SignedHeaders=host`, `partNumber=1`, and the `uploadId`, which came from the database and never from you.

**1b. Use it, straight to RustFS**

```bash
part 1 | curl -s -D - -o /dev/null -X PUT --data-binary @- "$URL" | grep -iE '^HTTP/1.1 [0-9]|^etag'
```

Expect `200 OK` and an `etag`.

**1c. Tamper with it.** Each of these should print 403:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PUT --data-binary x "${URL/partNumber=1/partNumber=2}"   # other part
curl -s -o /dev/null -w '%{http_code}\n' -X PUT --data-binary x "${URL/original.mp4/evil.exe}"      # other key
curl -s -o /dev/null -w '%{http_code}\n' -X PUT --data-binary x "${URL%%\?*}"                       # no signature
```

**1d. Bad requests to the API**

```bash
curl -s -X POST $API/videos/$V/upload/parts "${H[@]}" -d '{"partNumbers":[30]}'    # 400 PART_OUT_OF_RANGE (only 29)
curl -s -X POST $API/videos/$V/upload/parts "${H[@]}" -d '{"partNumbers":[1,1]}'   # 400 must be unique
curl -s -X POST $API/videos/$V/upload/parts "${H[@]}" -d '{"partNumbers":[0]}'     # 400 start at 1
```

**1e. Someone else.** Register a second user (same commands as setup, saving `TOKEN2`), then:

```bash
curl -s -X POST $API/videos/$V/upload/parts -H "authorization: Bearer $TOKEN2" -H 'content-type: application/json' -d '{"partNumbers":[1]}'
```

Expect 404 `UPLOAD_NOT_FOUND`, the same answer as for a video that doesn't exist.

## Lab 2: ETags (step 7–8)

**Idea.** An ETag is a fingerprint of content. For a part, it's the MD5 of that part's bytes. It's the receipt you hand back at the end. A part number is a slot: upload it again and the slot holds the new bytes and a new ETag.

```bash
part 2 | curl -s -D - -o /dev/null -X PUT --data-binary @- "$(presign 2)" | grep -i etag
part 2 | md5sum
```

The two values match.

Now overwrite slot 2 with different bytes and keep the old receipt for Lab 4:

```bash
OLD2=$(part 2 | md5sum | cut -c1-32)
head -c $PART /dev/urandom | curl -s -D - -o /dev/null -X PUT --data-binary @- "$(presign 2)" | grep -i etag   # new etag
part 2 | curl -s -D - -o /dev/null -X PUT --data-binary @- "$(presign 2)" | grep -i etag                      # back to the real bytes; etag == OLD2 again
```

Same bytes give the same ETag; different bytes give a different one.

## Lab 3: resume (step 8)

**Idea.** RustFS remembers every part that fully arrived. A `PUT` stores all of a part or none of it. Postgres knows how many parts there should be. So `missing = {1..29} − {what RustFS has}`, and nobody has to store progress.

```bash
curl -s $API/videos/$V/upload/parts "${H[@]}" | json 'j.uploaded=j.uploaded.map(p=>p.partNumber), JSON.stringify(j)'
```

Expect `uploaded: [1, 2]`, `missing: [3 … 29]`, `uploadedBytes: 16777216`.

Pretend you crashed: upload a few more parts, ask again, and only send what's missing:

```bash
for n in 3 4 5; do part $n | curl -s -o /dev/null -X PUT --data-binary @- "$(presign $n)"; done
MISSING=$(curl -s $API/videos/$V/upload/parts "${H[@]}" | json 'j.missing.join(" ")')
echo "still missing: $MISSING"
for n in $MISSING; do part $n | curl -s -o /dev/null -X PUT --data-binary @- "$(presign $n)"; echo -n "$n "; done; echo
curl -s $API/videos/$V/upload/parts "${H[@]}" | json '`missing=${j.missing.length} uploadedBytes=${j.uploadedBytes}`'
```

Expect `missing=0 uploadedBytes=239266402`. Then open the RustFS console (http://localhost:9001 → `raw-uploads`). There's **no object yet**: parts live inside the session until complete.

## Lab 4: complete and abort (step 9)

**Idea.** Complete hands back every receipt. Storage stitches the parts into one object, and the video goes `UPLOADING → PROCESSING`. Abort deletes all parts and the video goes `UPLOADING → ERROR`. Both lock the video row during the storage call, so they can't both win.

Collect the receipts:

```bash
RECEIPTS=$(curl -s $API/videos/$V/upload/parts "${H[@]}" | json 'JSON.stringify(j.uploaded.map(p=>({partNumber:p.partNumber,etag:p.etag})))')
```

**4a. Incomplete set.** Drop part 29:

```bash
curl -s -X POST $API/videos/$V/upload/complete "${H[@]}" -d "{\"parts\":$(echo "$RECEIPTS" | json 'JSON.stringify(j.slice(0,28))')}"
```

Expect 400 `PARTS_MISMATCH {missing:[29]}`.

**4b. Stale receipt.** Overwrite part 2 again so `OLD2` becomes stale, then try to complete with it:

```bash
head -c $PART /dev/urandom | curl -s -o /dev/null -X PUT --data-binary @- "$(presign 2)"
curl -s -X POST $API/videos/$V/upload/complete "${H[@]}" -d "{\"parts\":$(echo "$RECEIPTS" | json 'JSON.stringify(j)')}"
```

Expect 400 `UPLOAD_INCOMPLETE`. The status is still `UPLOADING`, so it can be retried. Put the real bytes back (`part 2 | curl … "$(presign 2)"`), then:

**4c. Complete**

```bash
curl -s -X POST $API/videos/$V/upload/complete "${H[@]}" -d "{\"parts\":$RECEIPTS}"
```

Expect `{status: 'PROCESSING'}`. The console now shows `original.mp4`, 239,266,402 bytes, with an ETag ending in **`-29`** (an MD5 of the 29 part MD5s, so it's not the MD5 of the whole file). Download it from the console and compare:

```bash
sha256sum $VIDEO ~/Downloads/original.mp4
```

**4d. Too late.** Complete again, abort, ask for progress: each gives 409 `UPLOAD_NOT_IN_PROGRESS`.

```bash
curl -s -X POST   $API/videos/$V/upload/complete "${H[@]}" -d "{\"parts\":$RECEIPTS}"
curl -s -X DELETE $API/videos/$V/upload "${H[@]}"
curl -s           $API/videos/$V/upload/parts "${H[@]}"
```

**4e. Abort.** Start a new upload, send two parts, abort:

```bash
V=$(curl -s -X POST $API/clubs/$CLUB/videos/uploads "${H[@]}" -d "{\"title\":\"To abort\",\"contentType\":\"video/mp4\",\"sizeBytes\":$SIZE}" | json j.videoId)
for n in 1 2; do part $n | curl -s -o /dev/null -X PUT --data-binary @- "$(presign $n)"; done
curl -s -o /dev/null -w 'abort → %{http_code}\n' -X DELETE $API/videos/$V/upload "${H[@]}"
```

Expect 204. The row is `ERROR` with "Upload aborted by the uploader", and the parts are gone.

**4f. Race (optional).** New upload, all parts, then fire complete and abort together:

```bash
V=$(curl -s -X POST $API/clubs/$CLUB/videos/uploads "${H[@]}" -d '{"title":"Race","contentType":"video/mp4","sizeBytes":1000}' | json j.videoId)
E=$(head -c 1000 $VIDEO | curl -s -D - -o /dev/null -X PUT --data-binary @- "$(presign 1)" | grep -i etag | tr -d '\r"' | cut -d' ' -f2)
curl -s -o /dev/null -w 'complete=%{http_code} ' -X POST $API/videos/$V/upload/complete "${H[@]}" -d "{\"parts\":[{\"partNumber\":1,\"etag\":\"$E\"}]}" &
curl -s -o /dev/null -w 'abort=%{http_code}\n'   -X DELETE $API/videos/$V/upload "${H[@]}" &
wait
```

Exactly one gets 200/204 and the other 409. Never both.

## Lab 5: size check (step 10)

**Idea.** The size was only *declared* by the client; RustFS stores whatever arrives. After stitching, the API reads the real size with `HeadObject`. On a mismatch it deletes the object and the video goes straight to `ERROR`, never `PROCESSING`.

Upload the video honestly, except send part 29 truncated to 1 MB:

```bash
V=$(curl -s -X POST $API/clubs/$CLUB/videos/uploads "${H[@]}" -d "{\"title\":\"Liar\",\"contentType\":\"video/mp4\",\"sizeBytes\":$SIZE}" | json j.videoId)
for n in $(seq 1 28); do part $n | curl -s -o /dev/null -X PUT --data-binary @- "$(presign $n)"; done
part 29 | head -c 1000000 | curl -s -o /dev/null -X PUT --data-binary @- "$(presign 29)"
RECEIPTS=$(curl -s $API/videos/$V/upload/parts "${H[@]}" | json 'JSON.stringify(j.uploaded.map(p=>({partNumber:p.partNumber,etag:p.etag})))')
curl -s -X POST $API/videos/$V/upload/complete "${H[@]}" -d "{\"parts\":$RECEIPTS}"
```

Expect 400 `SIZE_MISMATCH {declared: 239266402, actual: 235881024}`. The row is `ERROR` "Uploaded 235881024 bytes but 239266402 were declared", and no object is in the bucket.

## Lab 6: the CLI (step 11)

**Idea.** The CLI does everything above for you: initiate, presign in batches of 32, 4 parts in parallel, retries, a progress bar, and resume after you kill it, using a bookmark file in `.upload-state/`.

```bash
cd backend
export KLYRO_EMAIL=$EMAIL KLYRO_PASSWORD=$PASS
npm run upload -- ../bruno/videos/fixtures/sample-video.mp4 --club $CLUB --title "Bike ride (CLI)"
```

Press **Ctrl+C** around 30%:

```
started 31852180…: 29 parts of 8.0 MB, 4 at a time
[########......................]  28.0%  64.0 MB / 228.2 MB  99.8 MB/s
interrupted - run the same command again to resume
```

Look at the bookmark:

```bash
cat .upload-state/*.json      # {"videoId":"31852180…","partSize":8388608,"partCount":29,…}
```

Run the **same command** again:

```
resuming 31852180…: 8/29 parts already stored
[##############################] 100.0%  228.2 MB / 228.2 MB
done: video 31852180… is PROCESSING
```

`.upload-state/` is empty again. Measured on this file: the resumed object's SHA-256 matched the original exactly.

Things to try:
- Kill it, **abort** the upload with `curl -X DELETE …/upload`, then run again. You get "previous upload … is gone (UPLOAD_NOT_IN_PROGRESS), starting over".
- Kill it, `touch ../bruno/videos/fixtures/sample-video.mp4` (which changes its mtime), then run again. That's a new fingerprint, so you get a new upload. The old one is left `UPLOADING` (the abandoned uploads that the Sprint 5 cleanup job will handle).
- Change `CONCURRENCY` in `src/scripts/upload.ts` to 1, then 16, and compare MB/s.

**About `.upload-state/`.** It's the CLI's bookmark folder: one JSON file per in-progress upload, holding the `videoId` (no secrets). The file name is a hash of the file's path, size and modification time. It's created where you run the command (`backend/`), deleted on success, and git-ignored. Deleting it only means the next run starts a fresh upload.

## Lab 7: Bruno

The `bruno/videos/` folder uploads the same `sample-video.mp4` for real: it declares the size read from disk, presigns all 29 parts, then **"Upload part" repeats itself 29 times**, each time reading only that part's byte range from the file, exactly like the CLI but one part at a time. Its scripts read the local file, so it needs Bruno's **Developer** JavaScript sandbox:

```bash
cd bruno
npx @usebruno/cli run videos --env local --sandbox developer --env-var accessToken=$TOKEN --env-var clubId=$CLUB
```

Expect `Requests 34 (34 Passed)` (1 initiate + 1 presign + 29 parts + progress + complete + abort) and `Assertions 66/66`. "Abort upload" returns 409 because it runs after "Complete upload"; that's expected. In the Bruno app, switch the collection to Developer Mode first. Details are in [../bruno.md](../bruno.md).

## Peek behind the curtain

```bash
# the rows
docker exec klyro-postgres-1 psql -U klyro -d klyro -c \
  "SELECT left(id::text,8) id, title, status, size_bytes, upload_id IS NOT NULL AS has_session, error_message FROM videos ORDER BY created_at DESC LIMIT 10"
```

- RustFS console at http://localhost:9001 (`S3_ACCESS_KEY` / `S3_SECRET_KEY` from `backend/.env`): objects in `raw-uploads` exist only for completed uploads.
- API logs (the `npm run dev` terminal) show each request; the bytes never appear there.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `TOKEN` is `undefined`, login gives 429 | Login is rate-limited to 5 per 15 min | Wait, or locally: `docker exec klyro-redis-1 sh -c 'for k in $(redis-cli --scan --pattern "rl:login:*"); do redis-cli del "$k"; done'` |
| 401 `INVALID_TOKEN` midway through a lab | Access token expired | Run the login line again and rebuild `H=(…)` |
| 403 from RustFS on a `PUT` | URL expired (1 h), was edited, or signed for another host | Presign again. If it always fails, check `S3_PUBLIC_ENDPOINT` is the host you're calling |
| 404 `UPLOAD_NOT_FOUND` | Not the uploader, no longer `club_owner`/`admin`, or wrong `$V` | `echo $V`, check your role |
| 409 `UPLOAD_NOT_IN_PROGRESS` | Already completed or aborted | Start a new upload |
| 400 `UPLOAD_INCOMPLETE` | A receipt doesn't match what's stored | Re-read receipts with `GET …/upload/parts` |
| Browser upload: request OK but no ETag readable | Bucket CORS missing `ExposeHeaders: ETag` | `npm run storage:init` |
| `dd: command not found` | Not in Git Bash | Use Git Bash, or `tail -c +$(( (N-1)*PART + 1 )) $VIDEO \| head -c $PART` |
