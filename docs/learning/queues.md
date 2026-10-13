# Job queues, workers and BullMQ

How KlyroStream moves slow work (transcoding, emails, captions) out of HTTP requests and into a separate worker process. It starts from zero: what a queue is, what BullMQ is, what a "worker" actually is, how jobs get processed, concurrency vs parallelism, and the limits. It then compares BullMQ with RabbitMQ and Kafka, and ends with how to structure multi-stage work (single job, step job, flow). Every section points at real code, a measurement, or the sprint that will use it. See also [uploads.md](uploads.md) for how a video reaches PROCESSING, and [locking.md](locking.md) for the state-machine transition the worker relies on.

**Contents**

1. [Fundamentals](#part-1-fundamentals): the problem, queues, BullMQ, workers, how a job is processed, concurrency, limits, durability
2. [BullMQ vs RabbitMQ vs Kafka](#part-2-bullmq-vs-rabbitmq-vs-kafka)
3. [KlyroStream's queue setup](#part-3-klyrostreams-queue-setup)
4. [Structuring multi-stage work](#part-4-structuring-multi-stage-work): single job, step job, flow, and why transcode + thumbnail is not a flow
5. [The plan per sprint](#part-5-the-plan-for-klyrostream), gotchas, further reading

---

# Part 1: Fundamentals

## The problem

Transcoding a 1 GB video takes minutes of CPU. If `POST /videos/:id/complete` did it inline:

- **The request hangs for minutes.** Proxies and browsers time out long before FFmpeg finishes.
- **A restart loses the work.** Deploy, crash, Ctrl+C: the half-done transcode is gone, and nobody remembers that it was needed.
- **Spikes hurt everyone.** Ten uploads finishing together means ten FFmpeg processes fighting the API for CPU, and login gets slow.
- **No retries.** A transient failure (RustFS briefly down) becomes a permanent failure.

## What a queue is

A restaurant. The waiter (API) takes an order, writes a ticket, pins it on the rail, and goes back to the customers. The cooks (workers) take tickets off the rail one by one and cook. The waiter never waits at the stove, and if one cook goes home the tickets are still on the rail for the next one.

```
 producer ──add job──▶ [ queue: job5 job4 job3 ] ──take job──▶ consumer
 (the API)              (stored somewhere durable)              (the worker)
```

- The **producer** only says *what* needs doing ("transcode video 42") and moves on.
- The **queue** stores that note somewhere that survives restarts.
- The **consumer** does the work at its own pace, and tells the queue whether it succeeded.

This *decouples* the two sides in time (the work happens later), in speed (spikes wait in the queue instead of overloading the API) and in failure (a crashed worker doesn't break uploads; the job waits).

## What BullMQ is

BullMQ is **an npm library, not a server.** There is no "BullMQ process" running anywhere. The server is **Redis**, which already runs in our Compose stack. BullMQ is code that runs *inside your Node processes* and stores the queue as Redis keys.

```
   API process (node server.js)              Worker process (node worker.js)
   ┌───────────────────────────┐             ┌───────────────────────────┐
   │ Express routes            │             │ BullMQ Worker             │
   │ BullMQ Queue  ── add() ─┐ │             │   └─ processVideo(job)    │
   └─────────────────────────┼─┘             └──────────▲────────────────┘
                             │                          │ take job, report result
                             ▼                          │
                 ┌──────────────────────────────────────┴──┐
                 │ Redis: bull:video-processing:wait        │
                 │        bull:video-processing:active      │
                 │        bull:video-processing:video-<id>  │  (one hash per job)
                 │        …                                 │
                 └──────────────────────────────────────────┘
```

The two processes never call each other. Redis is the only thing between them.

BullMQ gives you three main classes:

| Class | Side | Does |
|---|---|---|
| `Queue` | producer | `add()` jobs, inspect counts, pause, clean |
| `Worker` | consumer | takes jobs one by one and runs your function on each |
| `QueueEvents` | anyone | listens to "progress / completed / failed" events from any process |

Plus `FlowProducer` for trees of jobs (Part 4).

## What a "worker" is

The word means three different things, and mixing them up is the usual source of confusion:

| Meaning | What it is concretely | In KlyroStream |
|---|---|---|
| **The processor** | A plain async function: `(job) => Promise<result>`. Return = success, throw = failure. It knows nothing about Redis. | `processVideo(job)` in `src/worker/…` |
| **The `Worker` object** | A BullMQ class instance. It loops: wait for a job, lock it, call the processor, record the result, repeat. | `new Worker('video-processing', processVideo, …)` |
| **The worker process** | A separate running Node program (its own PID, memory, CPU), whose whole job is to hold `Worker` objects. | `node dist/worker.js` (dev: `npm run dev:worker`) |

So the processor is a function, the `Worker` is the machine that calls that function, and the worker process is the program the machine runs in.

### Same codebase, two programs

The API and the worker are **two entry points into one codebase**:

```
backend/src/
├── server.ts     → starts Express + creates a Queue (producer). Never processes jobs.
├── worker.ts     → creates a Worker (consumer). Never listens on HTTP.
├── lib/          → db, redis, storage, queue: shared by both
└── modules/      → repositories, services: shared by both
```

```ts
// src/worker.ts (Sprint 5, step 4), roughly
const worker = new Worker<TranscodeJob>(VIDEO_QUEUE, processVideo, {
  connection: queueConnection('worker'),
  concurrency: env.WORKER_CONCURRENCY,
});
// …plus graceful shutdown on SIGTERM
```

You run them as two commands, two terminals in dev, two containers in Docker (the Sprint 6 Dockerfile builds one image with two targets, and only the worker target installs FFmpeg). The worker imports the same `videoRepository` and `transition` helper the API uses, so the rules for "PROCESSING → READY" live in one place.

### Why not run the Worker inside the API process?

It would work, since a `Worker` is just an object. We don't do it, because:

- **CPU competition.** A transcode next to Express makes every API request slow. Separate processes let the OS schedule them, and in production they run on different machines.
- **Independent scaling.** Need more transcoding? Start more worker processes. The API count stays the same, and vice versa.
- **Crash isolation.** A bug that kills the worker (FFmpeg on a weird file, out of memory) doesn't take the API down.
- **Different needs.** The worker needs FFmpeg, lots of temp disk and long shutdown times. The API needs none of that.

## How BullMQ processes a job, step by step

What actually happens between `add()` and "completed":

```
 API                         Redis                                   Worker process
 ───                         ─────                                   ──────────────
 queue.add('transcode',      Lua script (atomic):                    blocked on BZPOPMIN(marker)
   {videoId}, {jobId})  ───▶  - job id already exists? → stop          (asleep, using no CPU)
                              - HSET job hash (data, opts)
                              - LPUSH id onto  …:wait
                              - ZADD  …:marker  ───────────────────▶ wakes up
                                                                    │
                             Lua moveToActive (atomic):  ◀──────────┤ "give me a job"
                              - move id  wait → active              │
                              - SET lock key (token, 30 s TTL)      │
                              - return job data ───────────────────▶│ processor(job) runs
                                                                    │   job.updateProgress(40) → HSET + event
                             lock renewed every 15 s  ◀─────────────┤   (in the background)
                                                                    │ processor returns / throws
                             Lua moveToFinished (atomic):  ◀────────┤
                              - remove from active, drop lock
                              - success → …:completed (+ return value)
                              - error, attempts left → …:delayed (backoff)
                              - error, no attempts left → …:failed
                              - emit event; trim per removeOnComplete/Fail
                              - hand back the NEXT waiting job ────▶ start it right away
```

Points worth noticing:

- **Waiting costs nothing.** The worker isn't polling every 100 ms. It sends a *blocking* Redis command (`BZPOPMIN` on a "marker" key) on its own connection, which is why BullMQ opens a second, blocking connection. Redis replies the moment a job arrives.
- **Every state change is one Lua script.** Redis runs one script at a time, so two workers can never both take the same job, and "does this job id exist? then create it" can't race. This is the same idea as the atomic Redis commands in [locking.md](locking.md), just bigger.
- **Finishing a job fetches the next one** in the same round trip, so a busy worker doesn't go back to blocking between jobs.
- **Order:** jobs are taken FIFO (oldest first), unless they have a `priority` or a `delay`. With concurrency above 1, jobs *start* in order but can *finish* in any order.

### Job states

```
                add()
                  │
      ┌───────────┼───────────────┐
      ▼           ▼               ▼
   waiting     delayed      waiting-children        (flow parents start here)
      │           │ (time       │ (all children
      │           │  passes)    │  finished)
      │◀──────────┘◀────────────┘
      ▼
   active ── processor throws, attempts left ──▶ delayed (backoff) ──▶ waiting
      │
      ├── processor returns ─────────────────▶ completed
      └── throws on last attempt, or
          throws UnrecoverableError ─────────▶ failed
```

There is also `prioritized` (waiting, but sorted by priority) and `paused` (the queue is paused).

### Locks and stalled jobs

When a worker takes a job it gets a **lock** in Redis (`lockDuration`, default 30 s) and renews it every 15 s while the processor runs. If the worker process dies, the renewals stop, the lock expires, and a periodic check (`stalledInterval`, default 30 s) moves the job back to waiting so another worker can pick it up. After `maxStalledCount` (default 1) stalls it fails instead, so a job that crashes the worker every time can't loop forever.

Renewal runs on the worker's event loop. If the processor blocks the loop (a long synchronous loop, heavy JSON parsing), renewals stop and a healthy job is marked stalled and **run twice**. FFmpeg runs in a child process via `spawn`, so the event loop stays free. Keep it that way.

### Delivery is at least once

A crash after the work is done but before BullMQ records "completed" means the job runs again. Every processor must be **safe to run twice**:

- re-read the row and check the state before doing anything (the worker requires `PROCESSING`);
- write outputs to deterministic paths (`hls-output/<videoId>/…`), so a rerun overwrites instead of duplicating;
- make the final write a conditional state transition (`PROCESSING → READY` via the Sprint 4 `transition` helper), so a second "mark ready" is a no-op or a clear error.

## Concurrency vs parallelism

Two words that sound the same and aren't:

- **Concurrency:** several tasks are *in progress* at the same time, taking turns on one CPU core. A single cook with three pans: while one pan heats, they chop for another.
- **Parallelism:** several tasks are *executing* at the same instant on different cores. Three cooks.

Node runs your JavaScript on **one thread**. So inside one Node process you get concurrency, never parallelism, for JavaScript code. Waiting (network, disk, a child process) doesn't use the thread, so while one job waits another can run.

BullMQ's `concurrency` option is **concurrency**: how many processors one `Worker` keeps in flight at once (default 1). Extra **processes** give **parallelism**.

Measured on this machine (8 cores, Redis in Docker, 6 jobs of 1 s each):

| Setup | Job is… | Total time | Why |
|---|---|---|---|
| 1 process, `concurrency: 1` | waiting (`setTimeout`, like I/O) | **6.2 s** | one at a time |
| 1 process, `concurrency: 3` | waiting | **2.1 s** | three wait at once: concurrency helps |
| 1 process, `concurrency: 3` | busy CPU loop in JS | **6.0 s** | one thread: the "three" just queue up behind each other |
| 2 processes, `concurrency: 1` each | busy CPU loop in JS | **3.1 s** | two threads on two cores: real parallelism |

Rules that follow:

- I/O-heavy jobs (send an email, call an API, small DB work): raise `concurrency`.
- CPU-heavy **JavaScript**: concurrency doesn't help (and blocks lock renewal). Use more processes, or BullMQ's *sandboxed processors* (pass a file path instead of a function, optionally with `useWorkerThreads: true`) so each job runs in its own child process or thread.

### Where FFmpeg fits

FFmpeg is a separate OS process. From Node's point of view, `await runFfmpeg(…)` is *waiting*, so `concurrency: 3` really would run three FFmpegs in parallel on the CPU. But **libx264 already uses all cores for a single encode**. Three at once just split the same 8 cores three ways: each runs about 3× slower, uses 3× the RAM and temp disk, and total throughput barely changes. Hence `WORKER_CONCURRENCY=1` for the video queue to start, and Sprint 11 measures 1 vs 2 workers instead of guessing.

## Limits: what bounds throughput

| Knob / limit | Scope | What it does | KlyroStream |
|---|---|---|---|
| `concurrency` | one `Worker` object | max jobs in flight in that process | 1 for video (CPU-bound), higher for emails later |
| Number of worker processes | your deployment | parallelism; each process has its own `concurrency` | 1 in dev; scale in Sprint 11 / Phase 2 |
| `queue.setGlobalConcurrency(n)` | the whole queue, all workers | caps active jobs across every worker | not needed yet |
| `limiter: { max, duration }` | the whole queue | at most `max` jobs started per `duration` ms | e.g. "10 emails/s" for an SMTP provider |
| Redis memory | Redis | every waiting job and kept result is RAM | small payloads (ids) + `removeOnComplete/Fail` |
| Redis throughput | Redis | single-threaded, still far more jobs/s than we'll ever add | not a concern: our jobs take minutes, not ms |
| Lock / stalled settings | per worker | how fast a dead worker's job is rescued | defaults (30 s) are fine |

The real limit for us is **CPU minutes of FFmpeg**, not anything in BullMQ. The queue's job is to make that limit safe: excess work waits in Redis instead of overloading a machine.

## Durability: what if Redis restarts?

The queue lives in Redis, so it is only as durable as Redis. Our `docker-compose.yml` runs `redis-server --appendonly yes`: every write is appended to a file on the `redis_data` volume and replayed on restart. With the default `appendfsync everysec`, a hard crash loses at most about the last second of writes. Verified on the running container: `appendonly yes`, `maxmemory-policy noeviction`.

`noeviction` matters. With an eviction policy like `allkeys-lru`, Redis would *silently delete* job keys when memory fills up. With `noeviction` it refuses new writes instead, and `add()` fails loudly.

For a video platform that's the right trade-off. A job lost in that last second leaves a video stuck in PROCESSING, and the requeue script (Sprint 5, step 8) picks it up. Postgres stays the source of truth; the queue is a to-do list derived from it.

---

# Part 2: BullMQ vs RabbitMQ vs Kafka

All three move work or messages between processes, but they are different kinds of tools.

| | **BullMQ** | **RabbitMQ** | **Kafka** |
|---|---|---|---|
| What it is | Job-queue **library** on top of Redis | Message **broker** (a server) | Distributed **log** (a server cluster) |
| Mental model | A to-do list where every item has a state | A post office that routes letters into mailboxes | An append-only journal that many readers replay at their own pace |
| Unit | A *job* with state, attempts, progress, result | A *message*, deleted once acknowledged | A *record* at an offset in a partition; kept for days, read many times |
| Retries + backoff | Built in (`attempts`, `backoff`) | Manual: nack + requeue, or dead-letter exchange + TTL tricks | Manual: retry topics, or block the partition |
| Delayed jobs | Built in (`delay`) | Plugin or TTL + dead-letter | Not really: build it yourself |
| Progress, return values, job history | Built in | No | No |
| Parent/child workflows | Built in (flows) | No | No (stream processing frameworks instead) |
| Routing | By queue name | Rich: exchanges, topics, headers, fan-out | By topic + partition key |
| Replay old messages | No, completed jobs are eventually removed | No, acked = gone | **Yes**, that's the point |
| Ordering | FIFO per queue (completion order varies with concurrency) | FIFO per queue | Strict per partition |
| Parallelism | Add workers / concurrency, freely | Add consumers, freely | Capped by partition count |
| Throughput sweet spot | Thousands of jobs/s, long-running jobs | Tens of thousands of msgs/s | Millions of records/s |
| Languages | Node first (ports exist for Python, Elixir, PHP) | Any (AMQP is a standard protocol) | Any |
| Ops cost for us | **Zero new servers**: Redis already runs | A new server (Erlang) to run, monitor, back up | A cluster: brokers, KRaft controllers, partitions, retention tuning |
| Dashboard | Bull Board (job-level) | Management UI (queue-level) | Third-party UIs (topic/offset-level) |

### When each one fits

- **BullMQ:** "do this task, eventually, with retries, and tell me how it went". Background jobs in a Node app: transcoding, emails, reports, webhooks, scheduled tasks.
- **RabbitMQ:** many services, possibly in different languages, exchanging messages with flexible routing ("send `order.created` to billing and shipping, and everything matching `order.*` to audit"). The classic microservices message bus.
- **Kafka:** high-volume **event streams** that several systems consume independently and may need to **replay**: clickstreams, video-view analytics, change-data-capture, audit logs, event sourcing. It isn't a task queue; there are no per-message retries or delays, and one slow message blocks its whole partition.

### Why BullMQ for KlyroStream

- **The shape of our work is "jobs", not "events".** A few long, expensive tasks (minutes each) that need retries, backoff, progress for the UI, a final failed/completed state, and a dashboard. That's exactly BullMQ's built-in feature set; with RabbitMQ or Kafka we'd rebuild most of it.
- **No new infrastructure.** Redis is already there for rate limits and token blacklists.
- **One language.** The whole backend is Node + TypeScript, and BullMQ is native to it, with typed job data shared by producer and worker.
- **Scale fits.** Kafka shines at millions of events per second; we'll have dozens of uploads per hour. Kafka here would be like renting a cargo ship to deliver a letter.

### When we'd add something else

- **Kafka**, if Phase 2+ tracks every play/pause/seek for analytics and several consumers (recommendations, billing, dashboards) read the same stream. Even then, transcoding stays on BullMQ: events and jobs coexist.
- **RabbitMQ**, if a service in another language joins (say, a Python ML service) and we need cross-language routing. BullMQ's Python port might cover that too.

Being able to say *why not* Kafka is a good interview answer. "Kafka is a log for event streams; our workload is a small number of expensive jobs that need retries and progress" shows you picked the tool for the workload, not the hype.

---

# Part 3: KlyroStream's queue setup

### Connections: `src/lib/queue/connection.ts`

BullMQ gets its own Redis connections, separate from the cache/rate-limit client in `src/lib/redis/client.ts`:

| | Producer (API) | Worker |
|---|---|---|
| `maxRetriesPerRequest` | `null` (BullMQ requirement) | `null` (a `Worker` throws without it) |
| `enableOfflineQueue` | `false`: when Redis is down, `add()` rejects in ~1 ms, so the request fails fast | `true`: the worker waits for Redis to come back |
| `connectionName` | `klyro:producer` | `klyro:worker` (BullMQ also opens a blocking copy, `bull:<base64 queue name>`, for `BZPOPMIN`) |

`closeQueueConnections()` uses `quit()` on connections that are `ready` and `disconnect()` on the rest. `quit()` *sends a command*, which fails when Redis is already down, and shutdown has to work exactly then.

Each connection is created on first use (`queueConnection('producer' | 'worker')`), so the API never opens a worker connection. They are deliberately **not** `lazyConnect`. A `Queue` or `Worker` runs its setup once, in its constructor, and caches the result. With a lazy connection and Redis down at boot, that setup fails and the queue stays broken **even after Redis returns**. With an eager connection, setup waits for Redis instead. So `enqueueTranscode` puts a 2-second limit on `add()`: a request during that "Redis has never been up" window fails quickly. The job is still created once Redis arrives, which is harmless because the jobId is idempotent.

Measured, API booted with Redis down:

| | lazyConnect (before) | eager + 2 s limit (now) |
|---|---|---|
| Enqueue while Redis has never been up | rejects in 1 ms | rejects after 2 s |
| Enqueue after Redis comes back | **"Connection is closed" forever** | works |
| Enqueue after Redis drops later | rejects in 1 ms | rejects in 1 ms |

The same trap exists in `rate-limit-redis`: it loads its Lua scripts once at boot and caches the promise. With `passOnStoreError: true`, a failed load meant **every rate limit silently turned off** until a restart. `RecoveringRedisStore` in `rate-limit.middleware.ts` reloads a failed script, so limiting resumes once Redis is back. The lesson is general: **anything that does one-time setup against a dependency must handle that dependency being down at boot.**

### The queue: `src/lib/queue/queues.ts`

```ts
export const videoQueue = new Queue<TranscodeJob>(VIDEO_QUEUE, {
  connection: queueConnection('producer'),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 }, // retry after 5 s, then 10 s
    removeOnComplete: { count: 100 },                // keep the last 100 successes
    removeOnFail: { count: 500 },                    // keep more failures, those get debugged
  },
});

videoQueue.on('error', …); // without a listener, a Redis outage crashes the process

export const enqueueTranscode = (videoId: string, requestId?: string) =>
  videoQueue.add('transcode', { videoId, requestId }, { jobId: transcodeJobId(videoId) });
```

- **Pointers, not state.** The payload is an id. The worker reads the current row from Postgres, never a snapshot from enqueue time.
- **Idempotent id.** `video-<uuid>`, so a double `/complete` or a requeue script creates one job. Use `-`, not `:`, because `:` separates Redis key parts. Measured: adding the same id twice stores one job, and the stored `requestId` is the first one. The `Job` returned by the second `add()` shows the data you passed, not the stored data.
- **The id only blocks while the job exists.** Once `removeOnComplete` evicts it (after 100 newer completions), the same id can be added again and runs again. A "re-process this video" feature should use a new id (e.g. `video-<uuid>-r2`) instead of relying on eviction timing.
- **Enqueue after commit.** `completeVideoUpload` commits `UPLOADING → PROCESSING` first, then enqueues. Enqueueing inside the transaction could start a worker that reads the row *before* the commit and sees `UPLOADING`. If the enqueue fails after the commit, the video is stuck in PROCESSING with no job, and `scripts/requeue-stuck.ts` (step 8) is the safety net. The fully robust version, writing the job into a Postgres "outbox" table in the same transaction, is the *transactional outbox* pattern; it is out of scope for Phase 1.

### Retries and the state machine

| What happened | BullMQ | Video row |
|---|---|---|
| Processor returns | `completed` | `PROCESSING → READY` (done by the processor) |
| Throws, attempts left | `delayed` → retried with backoff | stays `PROCESSING` |
| Throws on the 3rd attempt | `failed` | `PROCESSING → ERROR` with the reason |
| Throws `UnrecoverableError` (no video stream, row not PROCESSING) | `failed` immediately, no retries | `ERROR` (or untouched if it wasn't ours) |

Retrying only helps for failures that can change: network blips, RustFS restarting, a full disk. A corrupt file fails identically three times, so it throws `UnrecoverableError` and fails at once.

---

# Part 4: Structuring multi-stage work

The Sprint 6 pipeline has several stages:

```
download raw → ffprobe → transcode 1080/720/480 → thumbnail → upload HLS + thumbnail → READY
```

BullMQ gives three shapes for this.

## 1. Single job

One processor does every stage, in order, in one temp folder (the Sprint 6 reference `processVideo`).

```ts
export const processVideo = async (job: Job<TranscodeJob>) => {
  const dir = path.join(os.tmpdir(), 'klyro', job.id!);
  try {
    const src = await downloadToFile(video.rawPath, path.join(dir, 'source'));
    const meta = await probe(src);
    await transcodeHls(src, path.join(dir, 'hls'), meta, (pct) => job.updateProgress(pct));
    await makeThumbnail(src, path.join(dir, 'thumb.jpg'), meta.duration);
    await uploadDir(…); await uploadFile(…);
    await markReady(…);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};
```

- **Good:** simplest to read, test and debug; one entry in Bull Board; stages share the local file system, so the source is downloaded and decoded **once**.
- **Bad:** a retry starts from zero. If the upload fails after a 4-minute transcode, attempt 2 transcodes again.

## 2. Step job

Still one job, but it records which stage finished in its own data, so a retry resumes:

```ts
enum Step { Download, Transcode, Upload, Finalize, Done }

export const processVideo = async (job: Job<TranscodeJob & { step?: Step }>) => {
  let step = job.data.step ?? Step.Download;
  while (step !== Step.Done) {
    switch (step) {
      case Step.Download:
        await downloadToFile(…);
        step = Step.Transcode;
        break;
      case Step.Transcode:
        await transcodeHls(…);
        await uploadDir(…); // the output must be durable before the step counts as done
        step = Step.Finalize;
        break;
      // …
    }
    await job.updateData({ ...job.data, step }); // saved in Redis; a retry starts here
  }
};
```

The catch is **durability**. A retry may run on a different machine, or on the same one after a restart, with an empty `/tmp`. "Transcode done" is only true if the segments are already in RustFS. Each step must:

1. make its output durable (RustFS, Postgres) **before** `updateData`;
2. be safe to re-run, because the process can die after the work but before `updateData`.

So in practice the checkpoints sit at "outputs uploaded" boundaries, not after every local command.

- **Good:** expensive stages aren't repeated; still one job, readable in Bull Board.
- **Bad:** more code; every checkpoint needs a durable output; easy to get subtly wrong.

## 3. Flow: parent and children

A flow is a **tree of jobs** added atomically by a `FlowProducer`. Children run first, possibly in parallel on different workers and in different queues. The parent sits in `waiting-children` and runs only when they have all finished, and it can read their return values.

```ts
const flows = new FlowProducer({ connection: queueConnection('producer') });

await flows.add({
  name: 'finalize',
  queueName: 'video-processing',
  data: { videoId },
  opts: { jobId: `video-${videoId}` },
  children: [
    { name: 'rendition', queueName: 'renditions', data: { videoId, height: 1080 }, opts: { jobId: `video-${videoId}-1080` } },
    { name: 'rendition', queueName: 'renditions', data: { videoId, height: 720 },  opts: { jobId: `video-${videoId}-720` } },
    { name: 'rendition', queueName: 'renditions', data: { videoId, height: 480 },  opts: { jobId: `video-${videoId}-480` } },
    { name: 'thumbnail', queueName: 'renditions', data: { videoId },               opts: { jobId: `video-${videoId}-thumb` } },
  ],
});

// parent processor, runs after all children
const finalize = async (job: Job) => {
  const results = await job.getChildrenValues(); // { 'bull:renditions:video-…-720': { playlist, bandwidth }, … }
  await writeMasterPlaylist(videoId, Object.values(results));
  await markReady(videoId, …);
};
```

Trees can nest: a child can have its own children. That gives you "A then B then C" ordering, where the deepest job runs first and each stage is a separate job.

### What happens when a child fails

This is the part that bites. Measured on bullmq 6.3.12 with two children (720 succeeds, 480 throws `UnrecoverableError`):

| Option on the failing child | Parent ends up | Parent processor ran? | Parent sees |
|---|---|---|---|
| *(none, the default)* | **`waiting-children` forever** | no | nothing |
| `failParentOnFailure: true` | `failed`, reason `child …:480 failed` | **no** | n/a |
| `ignoreDependencyOnFailure: true` | `completed` | yes | 720 in `getChildrenValues()`, 480 in `getIgnoredChildrenFailures()` |
| `continueParentOnFailure: true` | `completed` | yes, **as soon as a child fails**, even if siblings are still running | same as above |
| `removeDependencyOnFailure: true` | `completed` | yes | 720 only; the failure is invisible |

Consequences for KlyroStream:

- **Always set a failure option.** The default leaves the video in PROCESSING with a parent nobody will ever run.
- **With `failParentOnFailure`, the parent's processor never runs**, so "on the final failure, set ERROR" cannot live in the parent. It has to move to a `failed` event listener on the worker (or into the child's own last attempt).
- **`ignoreDependencyOnFailure`** fits "a missing rendition is acceptable": publish 1080 + 720 without 480. **`failParentOnFailure`** fits "all or nothing".
- **Re-adding a finished flow** with the same parent id returned the existing id, and the parent did not run again, so deterministic ids keep flows idempotent too.

### Dynamic children

The rendition ladder depends on the source height ("never upscale"), which is only known after `ffprobe`. So the tree can't be built at enqueue time. The pattern: a running job adds children pointing at itself, then pauses until they finish.

```ts
import { WaitingChildrenError } from 'bullmq';

const plan = async (job: Job, token?: string) => {
  if (job.data.step === 'probe') {
    const meta = await probeRemote(job.data.videoId);
    for (const height of ladderFor(meta.height)) {
      await renditionQueue.add('rendition', { videoId: job.data.videoId, height }, {
        jobId: `video-${job.data.videoId}-${height}`,
        parent: { id: job.id!, queue: job.queueQualifiedName },
      });
    }
    await job.updateData({ ...job.data, step: 'finalize' });
    if (await job.moveToWaitingChildren(token!)) throw new WaitingChildrenError(); // resumes when children finish
  }
  // step === 'finalize': read children, write master playlist, mark READY
};
```

This combines the step-job idea (`updateData`) with flows.

## Why not a flow of steps (transcode job, thumbnail job, …)?

The tempting design is one job per stage:

```
flow parent: finalize (mark READY)
 ├── child: transcode   (download → ffmpeg → upload HLS)
 └── child: thumbnail   (download → ffmpeg 1 frame → upload jpg)

or as a chain (deepest runs first):
 finalize ◀── upload ◀── transcode ◀── probe ◀── download
```

It looks cleaner on a diagram. Three things make it worse for us, though.

**1. Jobs don't share a disk.** Each job may run on a different worker process, possibly on a different machine. Whatever one stage leaves in `/tmp` is invisible to the next. So every stage has to start by downloading its input from RustFS and finish by uploading its output:

| Design, 1 GB source | Source downloads | Extra uploads of intermediate files |
|---|---|---|
| Single job (Sprint 6 plan) | 1 | 0 |
| Flow: transcode child + thumbnail child | 2 | 0 |
| Chain: download → probe → transcode → upload as separate jobs | 1 per stage that touches the file (3+) | each stage re-uploads what the next needs |

A 1-second thumbnail job that first downloads a 1 GB file is 99% overhead.

**2. The parts aren't independent.** The thumbnail needs the duration (5 s, or 10% of short clips), which comes from `ffprobe`. The rendition ladder needs the height, also from `ffprobe`. So the "parallel" children all depend on a probe stage, which means either another job level or probing twice.

**3. The cost isn't spread.** Transcode is about 99% of the time. Splitting off a 1-second thumbnail doesn't make anything faster, and on one machine it competes for the same cores.

Splitting into jobs helps when the stages are **independent, expensive and retryable on their own**, and preferably when there are **several machines** to run them. The thumbnail is cheap and dependent. The transcode is one FFmpeg run that already uses every core.

**When the thumbnail *would* make sense as its own job:** if we wanted a thumbnail on screen **before** the transcode finishes, it could run as an early, separate job that reads the source *directly from a presigned URL*. FFmpeg can seek over HTTP with range requests (`ffmpeg -ss 5 -i "<presigned url>" -frames:v 1 thumb.jpg`), fetching only the bytes around that frame instead of the whole file. That's a reasonable later improvement, and it's a chain ("enqueue thumbnail and transcode side by side"), not a flow, because nothing needs to wait for both.

## Choosing: rules of thumb

| Situation | Use |
|---|---|
| Work is cheap to repeat, or one stage dominates the cost | **Single job** |
| Sequential stages, each expensive, with durable outputs between them | **Step job** |
| Independent pieces that can run in parallel on different workers, then one combining step | **Flow** |
| Follow-up work that must not delay the main result | **Chain**: the processor enqueues the next job when it succeeds |
| "Wait until all of these finish, then do X" | **Flow** (that is exactly what a parent is) |

Chaining vs flow is a common confusion. A flow parent **waits for every child**. If the video should be playable as soon as HLS is ready, with captions arriving later, captions must *not* be a child of anything that gates READY. Chain them instead.

---

# Part 5: The plan for KlyroStream

| Sprint | Work | Shape | Why |
|---|---|---|---|
| **5** Job queue | Stub processor: re-read row, fake progress, `PROCESSING → READY` | Single job | Nothing expensive yet; learn retries, failure, shutdown first |
| **6** Transcoding | download → probe → one FFmpeg run (all renditions) → thumbnail → upload → READY | Single job | One download, one decode, FFmpeg writes the master playlist, one machine. Measure first. If the "X minutes per GB" number shows retries re-transcoding hurts, add step checkpoints at the upload boundary |
| **7** Delete video | Remove a still-waiting job before deleting objects and the row | `videoQueue.getJob(id)` → `remove()` | Removing an `active` job throws (it's locked); the processor's "row must be PROCESSING" check covers that race |
| **8** Real-time + email | API listens with `QueueEvents`; READY triggers a `send-email` job on a `notifications` queue | Chain | The email must not delay or fail the video. Its own queue gets its own retries (and a higher `concurrency`, since it's I/O) |
| **9** Observability | Queue depth, processing time, failure rate in Grafana | Metrics from `getJobCounts` | Queue depth growing faster than it drains = add workers |
| **11** Proof | Time a 1 GB file with 1 and 2 workers | Extra worker processes | Shows the queue scaling horizontally |
| **12** AI captions (optional) | Extract audio → Whisper → VTT → add subtitles to master | Chain from READY, or a small flow (`audio` child → `captions` parent) | Captions must not gate playback; a flow only makes sense *within* the caption pipeline |
| **Phase 2** | Several worker machines, long videos | Flow with dynamic children (one rendition per child), or segment-level parallel encoding | Only now does parallelism across machines beat one FFmpeg run |

So: **flows are a real option, but not for the core transcode yet.** The first place they will likely earn their keep is captions (Sprint 12) or multi-machine transcoding (Phase 2).

## Gotchas checklist

- [ ] Every `Queue`/`Worker` has an `'error'` listener (an unhandled `'error'` crashes Node).
- [ ] Worker connections use `maxRetriesPerRequest: null`.
- [ ] Redis runs with persistence (AOF) and `maxmemory-policy noeviction`.
- [ ] Job ids are deterministic and contain no `:`.
- [ ] Payload holds ids, not state; the processor re-reads and checks the row.
- [ ] Processors are safe to run twice (at-least-once delivery).
- [ ] Non-retryable failures throw `UnrecoverableError`.
- [ ] The final failure sets the video to ERROR, in the processor's last attempt or in a `failed` listener (always the listener for flow parents with `failParentOnFailure`).
- [ ] Flow children always have a failure option set.
- [ ] Nothing blocks the worker's event loop for more than a few seconds (lock renewal).
- [ ] `concurrency` matches the work: 1 for FFmpeg, higher for I/O jobs.
- [ ] `removeOnComplete` / `removeOnFail` are set, so Redis doesn't grow forever.
- [ ] Shutdown closes workers first (lets active jobs finish), then queues, then connections, and works with Redis down.

## Further reading

- [BullMQ guide](https://docs.bullmq.io/guide/introduction): queues, workers, jobs
- [Workers](https://docs.bullmq.io/guide/workers), [concurrency](https://docs.bullmq.io/guide/workers/concurrency) and [sandboxed processors](https://docs.bullmq.io/guide/workers/sandboxed-processors)
- [Retrying failing jobs](https://docs.bullmq.io/guide/retrying-failing-jobs) and [stalled jobs](https://docs.bullmq.io/guide/workers/stalled-jobs)
- [Rate limiting](https://docs.bullmq.io/guide/rate-limiting) and [global concurrency](https://docs.bullmq.io/guide/queues/global-concurrency)
- [Flows](https://docs.bullmq.io/guide/flows) and [failure options for children](https://docs.bullmq.io/guide/flows/fail-parent)
- [Process step jobs](https://docs.bullmq.io/patterns/process-step-jobs) (includes the dynamic-children pattern)
- [Idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) (RDB vs AOF)
- [RabbitMQ tutorials](https://www.rabbitmq.com/tutorials) and [Kafka introduction](https://kafka.apache.org/intro)
- [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)
