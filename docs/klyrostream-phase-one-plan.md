# KlyroStream — Phase 1 Sprint Plan

Sep 27, 2026 · @Muhammad Hasan

KlyroStream is worth building, but it only stands out if you finish it deep: measured numbers, failure handling and one AI feature. Phase 1 is 13 small sprints, each ending in something you can demo on its own. Start applying for jobs after Sprint 6.

## Verdict: yes, if you finish it deep

KlyroStream stands out because it solves real distributed-systems problems: GB-sized uploads, background processing, streaming and access control. Most portfolio APIs are CRUD; this one is a pipeline with real failure modes.

The risk is the genre. "YouTube clone with FFmpeg and HLS" is a popular tutorial project, so a stack list alone reads as tutorial-following. In 2026, reviewers judge depth: a few deeply built systems with concrete numbers (p95 latency, throughput), tests, CI, architecture docs, load tests and AI used with measured impact ([Nucamp](https://www.nucamp.co/blog/top-10-backend-portfolio-projects-for-2026-that-actually-get-you-hired)). Video pipelines are not on the common "top 10" lists, which helps: finished well, it is less crowded than e-commerce or chat apps.

| What reviewers look for | What KlyroStream will show | Sprint |
| --- | --- | --- |
| Non-trivial architecture | Direct-to-storage multipart uploads, queue plus a separate worker, HLS bitrate ladder | 4–6 |
| Failure handling | Resumable uploads, idempotent jobs, retries with backoff, ERROR state with a reason | 4–6 |
| Security thinking | Refresh-token rotation, hashed reset tokens, signed playlists, download quotas with an audit log | 2, 3, 7 |
| Concrete numbers | k6 p95 for the API, transcode minutes per GB, live dashboards | 9, 11 |
| Tests and CI | Integration tests for auth and uploads, GitHub Actions running lint, typecheck and tests | 11 |
| Documentation | README with architecture diagram, ADRs, short case study, demo video | 11 |
| AI with measured impact | Whisper captions plus search inside video transcripts, with accuracy and timing | 12 |
| Easy to run | One command: `docker compose up` | 11 |

Three additions to the original plan make it stand out:

1. **Numbers.** A k6 load test and processing timings in the README.
2. **One AI feature.** Auto-generated captions and "search inside videos" (Sprint 12).
3. **A story.** Pitch it as a private video library for sports clubs and academies sharing match footage. That gives the clubs, roles and download quotas a reason to exist.

Scope, honestly: Phase 1 is about 4–6 weeks of steady part-time work, not one weekend. With two other projects to build, start applying once Sprint 6 works and keep building while you apply.

## What changed since the original plan

Four tools in the original plan were abandoned or reached end of life during 2025–26, and several library APIs changed. The plan below already uses the new choices.

| Area | Original plan | Use now | Why |
| --- | --- | --- | --- |
| Local object storage | MinIO | **RustFS** (S3-compatible, web console, Apache 2.0). Fallback: SeaweedFS | MinIO stopped free Docker images in Oct 2025 and abandoned the Community Edition ([Minimus](https://www.minimus.io/post/minio-docker-image-changes-how-to-find-a-secure-minio-alternative), [rmoff](https://rmoff.net/2026/01/14/alternatives-to-minio-for-single-node-local-s3/), [comparison](https://rilavek.com/resources/self-hosted-s3-compatible-object-storage-2026)) |
| Log shipping to Loki | Promtail | **Grafana Alloy** | Promtail reached end of life in March 2026 ([Grafana forum](https://community.grafana.com/t/promtail-end-of-life-eol-march-2026-how-to-migrate-to-grafana-alloy-for-existing-loki-server-deployments/159636)) |
| Local email catcher | MailHog | **Mailpit** | MailHog is unmaintained; Mailpit is the maintained drop-in ([SendPigeon](https://sendpigeon.dev/blog/mailpit-vs-mailhog)) |
| FFmpeg from Node | fluent-ffmpeg (playbook) | **Spawn `ffmpeg` directly** with `child_process` | fluent-ffmpeg was archived on May 22, 2025 ([issue #1324](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324)) |
| Logger | Winston | **pino + pino-http** | Decided earlier: faster, JSON-first, Loki-friendly |
| Linting | `.eslintrc.json` | **`eslint.config.js`** (flat config) + `typescript-eslint` | ESLint 10 removed the old config format ([ESLint](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/)) |
| TypeScript | latest | **Pin `typescript@5`** (6.0 also works) | TS 7 is outside typescript-eslint's supported range — the error you hit |
| Validation | Zod 3 style | **Zod 4**: `z.email()`, `z.url()` | `z.string().email()` is deprecated ([Zod](https://zod.dev/v4)) |
| Express | 4 + `asyncHandler` | **Express 5**, no wrapper | Rejected promises reach the error handler natively ([PkgPulse](https://www.pkgpulse.com/guides/express-is-dead-long-live-express)) |
| Drizzle tables | object in 3rd argument | **Array**: `(t) => [index(...)]` | Object form is deprecated; stay on stable 0.x, v1 is still beta ([Drizzle](https://orm.drizzle.team/docs/latest-releases)) |
| BullMQ job ids | `video:${id}` (playbook) | **`video-${id}`** | BullMQ rejects `:` in custom job ids ([BullMQ](https://taskforcesh-bullmq.mintlify.app/jobs/job-ids)) |
| LocalStack (Phase 2) | Free, no account | **Free account + auth token**, non-commercial only | Changed March 23, 2026 ([LocalStack](https://blog.localstack.cloud/2026-upcoming-pricing-changes/)) |

Use Node 24 (current LTS) in `.nvmrc`.

## System architecture

Two Node processes from one codebase (API and worker) share three stores; the heavy work — moving and transcoding video — never runs inside an HTTP request.

&#91;embedded content: KlyroStream Phase 1 architecture · upload-to-playback flow\]

Following one video through the numbers:

1. The web app calls the API over REST and keeps a Socket.io connection open for live events.
2. The API hands out presigned part URLs; the browser uploads the file straight to storage. Playback segments later come from storage the same way, on 5-minute signed URLs.
3. On completion the API marks the video PROCESSING and enqueues a job in Redis.
4. A worker pulls the job when it has capacity — the API is never blocked by it.
5. The worker downloads the raw file, transcodes it to HLS, and uploads playlists, segments and a thumbnail.
6. It marks the video READY in Postgres and sends a "video ready" email; the API hears the queue event and pushes `video:ready` to the club's Socket.io room.

## Project structure

One repo, one backend codebase with two entry points (`server.ts` for the API, `worker.ts` for background jobs), a separate frontend, and infrastructure config beside them. This is the layered layout used by most production Express services; folders appear only when their first file does.

```text
klyro-stream/
├── backend/
│   ├── src/
│   │   ├── config/            env.ts (Zod-validated), constants.ts
│   │   ├── lib/               clients for external systems — the only code that knows vendors
│   │   │   ├── db/            client.ts, schema.ts
│   │   │   ├── redis/         client.ts
│   │   │   ├── storage/       s3Client.ts, presign.ts
│   │   │   ├── queue/         connection.ts, queues.ts, bullBoard.ts
│   │   │   ├── mail/          mailer.ts, templates/
│   │   │   ├── auth/          passport.ts, googleStrategy.ts
│   │   │   └── realtime/      socket.ts
│   │   ├── middleware/        auth, rbac, validate, error, metrics, rateLimit
│   │   ├── routes/            index.ts + one *.routes.ts per resource
│   │   ├── controllers/       thin: read request → call service → send response
│   │   ├── validators/        Zod schemas per resource
│   │   ├── services/          business rules; shared by API and worker
│   │   ├── repositories/      all database queries
│   │   ├── worker/
│   │   │   ├── processors/    video.processor.ts, email.processor.ts, captions.processor.ts
│   │   │   ├── pipeline/      download, probe, transcode, thumbnail, upload, cleanup
│   │   │   └── metricsServer.ts
│   │   ├── types/             express.d.ts, shared domain types
│   │   ├── utils/             logger.ts, metrics.ts, errors.ts
│   │   ├── app.ts             builds the Express app (no listen — testable)
│   │   ├── server.ts          API entry: HTTP + Socket.io + graceful shutdown
│   │   └── worker.ts          worker entry: BullMQ workers + graceful shutdown
│   ├── drizzle/               generated SQL migrations (committed)
│   ├── scripts/               storage-init, seed, upload CLI, socket-listen, requeue-stuck
│   ├── tests/                 unit/, integration/, load/ (k6)
│   ├── Dockerfile             multi-stage, with api and worker targets
│   ├── drizzle.config.ts  eslint.config.js  tsconfig.json  vitest.config.ts
│   └── package.json  .env.example
├── frontend/                  Vite + React (Sprint 10)
├── docker/                    prometheus/, grafana/provisioning/, loki/, alloy/
├── docs/
│   ├── adr/                   0001-postgres-over-mongodb.md, …
│   ├── api/                   Bruno collection
│   └── NOTES.md  case-study.md
├── .github/workflows/ci.yml
├── docker-compose.yml
├── .nvmrc  .gitignore
└── README.md
```

Dependency rules keep it clean as it grows:

- `routes → controllers → services → repositories → lib`. Arrows only point right.
- The worker uses `services`, `repositories` and `lib`, never `routes` or `controllers`.
- `lib` never imports `services`. Swapping RustFS for S3 in Phase 2 touches `lib/storage` and nothing else.
- Controllers never see `req` below them: pass plain values to services, so the worker can call the same service.

Keep plain relative imports (`../services/auth.service.js`) through Phase 1. Path aliases add build configuration that is easy to get wrong with ESM; revisit them only if imports become painful.

## Why it's structured this way

Every layer exists so one kind of change touches one place. When an interviewer asks "why did you structure it like this?", these are your answers.

| Layer | Its only job | Why it matters |
| --- | --- | --- |
| `routes/` | Map a URL to its middleware chain and controller | The whole API surface, and who may call each endpoint, is readable in one folder |
| `validators/` | Describe valid input with Zod | Bad input is rejected at the edge; the same schema gives you TypeScript types for free |
| `controllers/` | Translate HTTP to a function call and back | Services never see `req` or `res`, so the worker, scripts and tests can call them too |
| `services/` | Business rules: who may do what, status changes, quotas | One home for the rules; the API and worker can't drift apart because they share it |
| `repositories/` | Every SQL query | Indexes, query tuning and N+1 fixes happen in one place; services stay readable |
| `lib/` | Talk to vendors: Postgres, Redis, storage, queue, mail | Phase 2 swaps (RustFS → S3, Mailpit → SES) change one folder, not the business logic |
| `config/env.ts` | Load and validate configuration | A bad deploy fails at startup with a clear message, not at 2 a.m. on the first request |
| `app.ts` vs `server.ts` | Build the app vs run it | Tests import the app without opening a port; the server owns startup and shutdown |
| `worker.ts` | A second entry point for background jobs | FFmpeg can peg a CPU for minutes; in its own process it can't freeze API requests, crash the API, or stop it scaling separately |

The architectural choices behind the diagram:

| Choice | Instead of | Why |
| --- | --- | --- |
| Presigned direct-to-storage uploads | Uploading through the API | The API would hold GBs in memory and bandwidth; direct upload is also resumable and is exactly how S3 works in production |
| A queue between API and worker | Transcoding inside the request | Requests stay fast; jobs survive restarts, retry with backoff, and absorb upload spikes |
| Postgres | MongoDB | Users, clubs, members and videos are relational; quotas need transactions; foreign keys stop orphaned rows |
| Redis for tokens, limits and jobs | Database tables | These are short-lived and need expiry; Redis TTLs delete them automatically |
| One status-transition helper | Updating `status` anywhere | A video can't jump from UPLOADING to READY by accident; the state machine is enforced in one function |
| Private storage plus signed URLs | Public buckets | A leaked link expires in minutes; access is re-checked on every playlist request |
| Request id carried into jobs | Separate logs per process | One id follows a video from HTTP request to finished transcode across two processes |

Where does new code go?

- It reads or writes the database → a repository function.
- It decides whether something is allowed or what happens next → a service.
- It calls an outside system → `lib/`.
- It inspects the request (auth, roles, limits) before the handler → middleware.
- It is a background step of a job → `worker/pipeline/`.
- It is a one-off admin task → `scripts/`.

And one rule against over-engineering: don't create a layer, interface or abstraction until a second caller needs it. A repository function with one caller is fine; an abstract `BaseRepository` class for six tables is not.

## Sprint map

&#91;embedded content: Phase 1 sprint map · 13 sprints, 2 gates\]

Read it row by row. Sprints 0–6 build the core story (accounts, upload, transcode); that is enough to start applying. Sprints 7–11 make it complete and provable while you apply.

## How to run a sprint

One sprint at a time, no calendar. A sprint is done when its checklist is ticked and you can show it to someone.

1. Open only the current sprint. Don't read ahead.
2. Skim its **Learn** links (30–45 minutes). Just enough vocabulary, not mastery.
3. Build the tasks in order. Check each **Expected output** before starting the next.
4. Commit after every task with a conventional commit, e.g. `feat(auth): add refresh rotation`.
5. Finish with the **Showcase**: a screenshot or 30-second GIF added to a Progress section in the README.
6. Write 2–3 lines in `docs/NOTES.md`: what surprised you, what you decided and why. These become interview answers.
7. Stuck for 45 minutes? Ask me with the file, the error and what you tried.

| Sprint | You can demo | Status |
| --- | --- | --- |
| S0 Foundation | App boots with one command, `/health` green | Not started |
| S1 Local accounts | Register and log in from Bruno | Not started |
| S2 Secure sessions | Full session lifecycle plus a reset email in Mailpit | Not started |
| S3 Google and clubs | Sign in with Google, create a club, invite a member | Not started |
| S4 Uploads | Upload a 1 GB file, kill it mid-way, resume it | Not started |
| S5 Job queue | Jobs flow and retry in Bull Board | Done (GIF pending) |
| S6 Transcoding | Raw video in, playable HLS out | Done (GIF pending) |
| S7 Library and playback | Search, stream and download through the API | Done (GIF pending) |
| S8 Real-time and email | Upload in one client, live "ready" event in another | Done (GIF pending) |
| S9 Observability | Live Grafana dashboard and log search | Done |
| S10 Frontend demo | Recorded upload-to-playback demo | Not started |
| S11 Proof and polish | Reviewer runs it in one command; README has numbers | Not started |
| S12 AI captions | Search a spoken word, jump to that moment | Not started |

## Sprint 0 — Foundation

**Showcase:** clone the repo, run `docker compose up -d` and `npm run dev`, and `GET /health` reports Postgres and Redis as up. Mostly done — tasks 2 and 10 are the upgrades still worth doing.

**Learn:** Postgres vs MongoDB thinking (tables, foreign keys, migrations) · [Drizzle migrations](https://orm.drizzle.team/docs/migrations) · why ESM imports end in `.js` ([TypeScript modules](https://www.typescriptlang.org/docs/handbook/modules/theory.html)).

**Tech:** Node 24, TypeScript 5, tsx, Express 5, Zod 4, Drizzle + postgres.js, pino, Docker Compose.

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | Project setup: `.nvmrc` = 24, `"type": "module"`, TypeScript pinned to 5, `dev` script with `tsx watch` | `npx tsc --version` prints 5.x; `npm run dev` starts the server | [Node releases](https://nodejs.org/en/about/previous-releases) · [tsx](https://tsx.is) |
| 2 | Lint and format with ESLint flat config and Prettier | `npm run lint` passes using `eslint.config.js`, no `.eslintrc` | [typescript-eslint getting started](https://typescript-eslint.io/getting-started) · [Prettier](https://prettier.io/docs/install) |
| 3 | Git hygiene: `.gitignore`, `.env.example`, conventional commits | `git log` reads like `feat(db): add schema` | [Conventional Commits](https://www.conventionalcommits.org) · your commit cheat sheet |
| 4 | Folder structure (see Conventions section) | `src/config`, `lib`, `routes`, `controllers`, `services`, `repositories`, `utils` exist as needed | Playbook, "Folder structure" |
| 5 | `docker-compose.yml` with Postgres and Redis, each with a healthcheck | `docker compose ps` shows both **healthy** | [Compose file reference](https://docs.docker.com/reference/compose-file/services/#healthcheck) |
| 6 | Env validation in `src/config/env.ts` with Zod 4 (`z.url()`, `z.coerce.number()`) | Removing `DATABASE_URL` crashes at startup with a clear message | [Zod API](https://zod.dev/api) |
| 7 | pino logger with `pino-pretty` in dev and redaction of secrets | Pretty logs in dev; JSON when `NODE_ENV=production` | [pino](https://getpino.io) · [redaction](https://getpino.io/#/docs/redaction) |
| 8 | Drizzle schema (6 tables, array syntax), generate and migrate | 6 tables visible in `npm run db:studio`; SQL files committed in `drizzle/` | [Drizzle + Postgres](https://orm.drizzle.team/docs/get-started/postgresql-new) · [indexes](https://orm.drizzle.team/docs/indexes-constraints) · your `schema.ts` |
| 9 | App skeleton: `app.ts`/`server.ts` split, `AppError` classes, error middleware, 404, graceful shutdown | Any error returns `{ error: { code, message } }`; Ctrl+C logs a clean shutdown | [Express error handling](https://expressjs.com/en/guide/error-handling.html) · [Express 5 migration](https://expressjs.com/en/guide/migrating-5.html) |
| 10 | `GET /health` pings Postgres (`select 1`) and Redis (`PING`) | 200 with `{ postgres: "up", redis: "up" }`; 503 when you stop a container | Drizzle `db.execute(sql\`select 1\`)\` · [ioredis](https://github.com/redis/ioredis) |

Reference code — lint config (`npm i -D eslint @eslint/js typescript-eslint eslint-config-prettier`):

```js
// eslint.config.js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default defineConfig(
  { ignores: ['dist', 'drizzle', 'node_modules'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  { rules: { '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] } },
);
```

Env validation — separate secrets for access and refresh tokens, so leaking one doesn't compromise the other:

```ts
// config/env.ts
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  FRONTEND_URL: z.url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
```

Error classes and the one error handler every route relies on:

```ts
// utils/errors.ts
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') { super(401, code, message); }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') { super(403, code, message); }
}
export class NotFoundError extends AppError {
  constructor(message = 'Not found', code = 'NOT_FOUND') { super(404, code, message); }
}
export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'CONFLICT') { super(409, code, message); }
}

// middleware/error.middleware.ts
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  logger.error({ err, method: req.method, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};
```

Health check and graceful shutdown (export `queryClient` from `lib/db/client.ts`):

```ts
// routes/health.routes.ts
const check = (fn: () => Promise<unknown>) =>
  fn().then(() => 'up' as const, () => 'down' as const);

router.get('/', async (_req, res) => {
  const [postgres, cache] = await Promise.all([
    check(() => db.execute(sql`select 1`)),
    check(() => redis.ping()),
  ]);
  const ok = postgres === 'up' && cache === 'up';
  res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', postgres, redis: cache });
});

// server.ts
const server = buildApp().listen(env.PORT, () => logger.info({ port: env.PORT }, 'API listening'));

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    await Promise.allSettled([queryClient.end(), redis.quit()]);
    clearTimeout(force);
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandled rejection');
  shutdown('unhandledRejection');
});
```

Compose healthcheck, so other services can wait for a ready database:

```yaml
postgres:
  image: postgres:17-alpine
  environment: { POSTGRES_USER: klyro, POSTGRES_PASSWORD: klyro_dev, POSTGRES_DB: klyro }
  ports: ['5432:5432']
  volumes: [postgres_data:/var/lib/postgresql/data]
  healthcheck:
    test: ['CMD-SHELL', 'pg_isready -U klyro -d klyro']
    interval: 5s
    retries: 10
```

- [ ] Server boots and connects to Postgres
- [ ] Schema migrated, 6 tables exist
- [ ] ESLint flat config replaces `.eslintrc`
- [ ] `/health` checks Postgres and Redis and returns 503 when one is down
- [ ] Graceful shutdown closes the HTTP server, DB pool and Redis
- [ ] README has a "Run locally" section that works on a fresh clone

## Sprint 1 — Local accounts

**Showcase:** from a Bruno collection, register a user, log in, and get an access token; bad input returns a clean 400. Done — tasks 5 and 6 are small modernisations.

**Learn:** [JWT introduction](https://jwt.io/introduction) (signed, not encrypted) · [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) (why bcrypt, cost 12) · the layered pattern: route → controller → service → repository.

**Tech:** bcrypt, jsonwebtoken, Zod 4 validation middleware.

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | `validate(schema, 'body' \| 'query' \| 'params')` middleware | Invalid body returns 400 `VALIDATION_ERROR` with field details | [Zod error formatting](https://zod.dev/error-formatting) (`z.flattenError`) |
| 2 | User repository: `findByEmail`, `findById`, `create`; lowercase emails before saving | All user SQL lives in `user.repository.ts` | [Drizzle select](https://orm.drizzle.team/docs/select) · [insert](https://orm.drizzle.team/docs/insert) |
| 3 | `POST /auth/register` with bcrypt cost 12 | 201 with user and access token; duplicate email returns 409 | [bcrypt](https://github.com/kelektiv/node.bcrypt.js) |
| 4 | `POST /auth/login` | Wrong email and wrong password both return 401 "Invalid credentials" | [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) |
| 5 | Access token with `sub` = user id and a 15-minute expiry | Token decodes at jwt.io with `sub` and `exp` | [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) |
| 6 | Remove `asyncHandler`: Express 5 forwards async errors itself | Throwing inside an async controller still returns the error shape | [Express 5 migration](https://expressjs.com/en/guide/migrating-5.html) |
| 7 | Start a Bruno collection in `docs/api/` (plain files, versioned in git) | Saved requests for register and login, with example responses | [Bruno docs](https://docs.usebruno.com) · [Bruno collections](https://docs.usebruno.com/get-started/bruno-basics/create-a-collection) |

Reference code — validation that works with Express 5, where `req.query` is read-only and can't be overwritten:

```ts
// middleware/validate.middleware.ts
import type { RequestHandler } from 'express';
import { z, type ZodType } from 'zod';

type Part = 'body' | 'query' | 'params';

export const validate = (schema: ZodType, part: Part = 'body'): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request',
        z.flattenError(result.error).fieldErrors));
    }
    res.locals[part] = result.data; // controllers read parsed, typed values from here
    next();
  };
```

A thin controller and a route with no `asyncHandler` (Express 5 catches async errors):

```ts
// validators/auth.schema.ts
export const registerSchema = z.object({
  email: z.email().max(320).transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(128),
});
export type RegisterInput = z.infer<typeof registerSchema>;

// controllers/auth.controller.ts
export const register: RequestHandler = async (_req, res) => {
  const input = res.locals.body as RegisterInput;
  const result = await authService.registerUser(input);
  res.status(201).json(result);
};

// routes/auth.routes.ts
router.post('/register', validate(registerSchema), authController.register);
```

The "check then insert" race: two requests can pass `findByEmail` together, so also map the database's unique-violation error:

```ts
// utils/db-errors.ts
export const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

// services/auth.service.ts
try {
  user = await userRepo.create({ email, passwordHash, provider: 'local' });
} catch (err) {
  if (isUniqueViolation(err)) throw new ConflictError('Email already registered');
  throw err;
}
```

- [ ] Register and login work
- [ ] Passwords stored as bcrypt hashes only
- [ ] Validation errors return 400 with details
- [ ] Zod schemas use `z.email()`, not `z.string().email()`
- [ ] `asyncHandler` removed
- [ ] Collection exported to `docs/api/`

## Sprint 2 — Secure sessions

**Showcase:** a complete auth lifecycle — login sets a refresh cookie, refresh rotates it, logout kills it, and "forgot password" delivers a reset email you can open in Mailpit. After this sprint the hardest concepts in the project are behind you.

**Learn:** [refresh-token rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation) · [HttpOnly cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#restrict_access_to_cookies) · [Redis SET with expiry](https://redis.io/docs/latest/commands/set/) · [OWASP forgot password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

**Tech:** ioredis, cookie-parser, Nodemailer, Mailpit, helmet, cors, express-rate-limit.

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | Redis client in `lib/redis/client.ts`; make `REDIS_URL` required | Log line "Redis connected" on boot | [ioredis](https://github.com/redis/ioredis) |
| 2 | Refresh token with a `jti`, set as HttpOnly cookie `rt` (`SameSite=Lax`, `Secure` in production, `path=/auth`) on register and login | Response body has only the access token; the cookie appears in Bruno's cookie jar | [cookie-parser](https://expressjs.com/en/resources/middleware/cookie-parser.html) · [res.cookie](https://expressjs.com/en/api.html#res.cookie) |
| 3 | `requireAuth` middleware, typed `req.user`, `GET /auth/me` | `/auth/me` returns 200 with a token, 401 without | [Declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html) |
| 4 | `POST /auth/refresh` with rotation: blacklist the old `jti` in Redis (`blacklist:token:{jti}`, TTL = remaining lifetime) and issue a new pair | New access token; replaying the old refresh cookie returns 401 | [Auth0 rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation) |
| 5 | `POST /auth/logout`: blacklist the refresh token, clear the cookie, always 204 | Refresh after logout returns 401 | [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) |
| 6 | Add `token_version` to `users` (migration); put it in refresh tokens and reject stale versions | Bumping the number logs the user out on every device | [Drizzle migrations](https://orm.drizzle.team/docs/migrations) |
| 7 | Mailpit in Compose; Nodemailer transport in `lib/mail/mailer.ts` | A test email shows at `localhost:8025` | [Mailpit](https://mailpit.axllent.org/docs/install/docker/) · [Nodemailer SMTP](https://nodemailer.com/smtp/) |
| 8 | `POST /auth/forgot-password`: always 200; 32-byte random token; store only its SHA-256 hash in Redis for 30 minutes; email the link | Reset email arrives in Mailpit; unknown emails get the same 200 | Code from our earlier chat · [Node crypto](https://nodejs.org/api/crypto.html) |
| 9 | `POST /auth/reset-password`: consume the token once, hash the new password, bump `token_version` | Password changes; reusing the link returns 401; old refresh tokens stop working | [OWASP forgot password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) |
| 10 | Hardening: `helmet()`, `cors({ origin: FRONTEND_URL, credentials: true })`, rate limit on login, register, forgot and reset | 6th login attempt in 15 minutes returns 429; security headers present | [helmet](https://helmetjs.github.io) · [cors](https://expressjs.com/en/resources/middleware/cors.html) · [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) |

Reference code — the Redis blacklist. Using `SET … NX` makes "use a refresh token" atomic, so two parallel refreshes with the same token can't both succeed; the key expires when the token would have expired anyway:

```ts
// services/token.service.ts
const REFRESH_TTL_S = 7 * 24 * 60 * 60;

export const signAccessToken = (userId: string) =>
  jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: '15m' });

export const signRefreshToken = (userId: string, tokenVersion: number) =>
  jwt.sign({ ver: tokenVersion }, env.JWT_REFRESH_SECRET, {
    subject: userId, jwtid: randomUUID(), expiresIn: REFRESH_TTL_S,
  });

export const verifyRefreshToken = (token: string) => {
  const p = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload & { ver: number };
  return { userId: p.sub!, jti: p.jti!, ver: p.ver, exp: p.exp! };
};

/** Marks the token used. Returns false if it was already used (replay). */
export const consumeRefreshToken = async (jti: string, exp: number) => {
  const ttl = Math.max(exp - Math.floor(Date.now() / 1000), 1);
  const res = await redis.set(`blacklist:token:${jti}`, '1', 'EX', ttl, 'NX');
  return res === 'OK';
};

// services/auth.service.ts
export const refresh = async (token: string) => {
  const { userId, jti, ver, exp } = verifyRefreshToken(token);
  const user = await userRepo.findById(userId);
  if (!user || user.tokenVersion !== ver) throw new UnauthorizedError('Session expired');
  if (!(await consumeRefreshToken(jti, exp))) {
    await userRepo.bumpTokenVersion(userId); // replay = likely theft: log out everywhere
    throw new UnauthorizedError('Refresh token reuse detected');
  }
  return issueTokens(user); // new access token + new refresh cookie
};
```

Cookie options and the auth guard:

```ts
// config/cookies.ts
export const refreshCookie = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
} as const;

// middleware/auth.middleware.ts
export const requireAuth: RequestHandler = (req, _res, next) => {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) return next(new UnauthorizedError());
  try {
    const { sub } = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    req.user = { id: sub! };
    next();
  } catch {
    next(new UnauthorizedError('Invalid or expired token'));
  }
};
```

Rate limits stored in Redis survive restarts and work across several API instances ([rate-limit-redis](https://github.com/express-rate-limit/rate-limit-redis)):

```ts
// middleware/rateLimit.middleware.ts
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args: string[]) => redis.call(...args) as never }),
  handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many attempts')),
});
```

- [ ] Refresh token only ever travels in an HttpOnly cookie
- [ ] Rotation works; a replayed refresh token is rejected
- [ ] Logout is idempotent and clears the cookie
- [ ] Reset tokens are hashed, single-use and expire in 30 minutes
- [ ] Forgot-password never reveals whether an email exists
- [ ] Password reset logs out all other sessions
- [ ] Auth routes are rate limited; helmet and CORS are on
- [ ] Collection updated; `docs/NOTES.md` explains the two anti-enumeration and hashing decisions

## Sprint 3 — Google sign-in, clubs and RBAC

**Showcase:** sign in with Google, create a club, invite a teammate as a viewer, and watch the viewer get 403 on an admin-only action. This turns the API into a multi-tenant product.

**Learn:** [OAuth 2 simplified](https://aaronparecki.com/oauth-2-simplified/) (authorization code flow) · [Drizzle transactions](https://orm.drizzle.team/docs/transactions) · [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) (deny by default).

**Tech:** passport, passport-google-oauth20, Google Cloud Console.

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | Create a Google OAuth client; redirect URI `http://localhost:4000/auth/google/callback`; add ID, secret and `FRONTEND_URL` to env | Credentials in `.env`, validated by Zod | [Google OAuth for web servers](https://developers.google.com/identity/protocols/oauth2/web-server) |
| 2 | Passport Google strategy with `session: false` and a cookie-backed `state` + PKCE store: find by Google `sub`, else create when the email is unused; if the email belongs to a password account, refuse (`?error=use_password`). An account keeps the method it was created with: no linking, no switching, no password for Google accounts. New users from an invitation always set a password | A Google login creates exactly one user row; a password account is never merged with a Google identity | [passport-google-oauth20](https://www.passportjs.org/packages/passport-google-oauth20/) |
| 3 | Callback sets the refresh cookie and redirects to the frontend — no token in the URL | Browser lands on `FRONTEND_URL/auth/callback`; `POST /auth/refresh` then returns an access token | [OAuth 2 security best practice](https://datatracker.ietf.org/doc/html/rfc9700) |
| 4 | `POST /clubs` in one transaction: club row, creator as `admin`, a `download_quotas` row | Three rows appear together, or none if one insert fails | [Drizzle transactions](https://orm.drizzle.team/docs/transactions) |
| 5 | `GET /clubs` (my clubs) and `GET /clubs/:id` (members only) | Non-members get 404 or 403, never the club data | Playbook, Day 4 |
| 6 | `requireClubRole('club_owner')` middleware with hierarchy admin > club\_owner > viewer | One middleware guards every club route; 403 on too-low roles | [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) |
| 7 | Invitations: admin invites by email with a role → `club_invitations` row (hashed token, 7-day expiry) and an email. The invitee accepts or rejects; an existing user must be signed in as that email, a new user sets only a password and is signed in. Admin can list and revoke pending invites | Nobody joins a club without accepting; one pending invite per (club, email); token single-use | [OWASP forgot password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) (same token rules) |
| 7b | Members: list, change role, remove, leave; block removing or demoting the last admin | Every action returns the right status; last admin cannot leave | [Drizzle update](https://orm.drizzle.team/docs/update) · [delete](https://orm.drizzle.team/docs/delete) |
| 8 | Write the RBAC matrix (role × action) in the README | A table reviewers can check in 10 seconds | [Markdown tables](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-tables) |

Reference code — one middleware for every club permission. Non-members get 404, so outsiders can't probe which clubs exist:

```ts
// middleware/rbac.middleware.ts
const rank = { viewer: 1, club_owner: 2, admin: 3 } as const;
type ClubRole = keyof typeof rank;

export const requireClubRole = (min: ClubRole, param = 'clubId'): RequestHandler =>
  async (req, res, next) => {
    const role = await clubRepo.getMemberRole(req.params[param], req.user!.id);
    if (!role) return next(new NotFoundError('Club not found'));
    if (rank[role] < rank[min]) return next(new ForbiddenError(`Requires ${min} role`));
    res.locals.clubRole = role;
    next();
  };

// routes/clubs.routes.ts
router.get('/:clubId', requireAuth, requireClubRole('viewer'), clubs.get);
router.post('/:clubId/members', requireAuth, requireClubRole('admin'), validate(inviteSchema), clubs.invite);
```

Transactional club creation — all three rows or none:

```ts
// repositories/club.repository.ts
export const createWithOwner = (name: string, ownerId: string) =>
  db.transaction(async (tx) => {
    const [club] = await tx.insert(clubs).values({ name, ownerId }).returning();
    await tx.insert(clubMembers).values({ clubId: club.id, userId: ownerId, role: 'admin' });
    await tx.insert(downloadQuotas).values({ clubId: club.id });
    return club;
  });
```

Google callback that never puts a token in the URL:

```ts
// routes/auth.routes.ts
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${env.FRONTEND_URL}/login?error=oauth` }),
  (req, res) => {
    const user = req.user as User;
    res.cookie('rt', signRefreshToken(user.id, user.tokenVersion), refreshCookie);
    res.redirect(`${env.FRONTEND_URL}/auth/callback`); // frontend then calls POST /auth/refresh
  },
);
```

- [ ] Google sign-in works end to end; tokens never appear in a URL
- [ ] One sign-in method per account: Google sign-in never merges into a password account and vice versa
- [ ] Admins can demote or remove other admins, but the club creator (`clubs.owner_id`) cannot be demoted, removed, or leave (403 `CLUB_CREATOR_PROTECTED`)
- [ ] Club creation is transactional and creates a quota row
- [ ] Every club route is guarded by membership and role
- [ ] The last admin cannot be removed
- [ ] Joining a club always goes through an accepted invitation

Roles are per club: `club_members.role` is the only role in the system. Any signed-in user can create a club and becomes its admin; one user can belong to many clubs with a different role in each. A platform-wide admin is parked (see "Parked: platform admin").
- [ ] RBAC matrix in the README; collection updated

## Sprint 4 — Object storage and resumable uploads

**Showcase:** a CLI uploads a 1 GB video straight to storage in parallel chunks with a progress bar; kill it halfway, run it again, and it resumes. The API never touches the video bytes. This is the heart of the project — give it the most time.

**Learn:** [S3 multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) (initiate → parts with ETags → complete) · [presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) · [bucket CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html).

**Tech:** RustFS (S3-compatible), `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | Add RustFS to Compose (S3 API on 9000, console on 9001) and S3 env vars | Console opens in the browser | [RustFS](https://github.com/rustfs/rustfs) · [RustFS for local dev](https://zenn.dev/onozaty/articles/local-s3-rustfs?locale=en) · fallback: [SeaweedFS](https://github.com/seaweedfs/seaweedfs) |
| 2 | `scripts/storage-init.ts`: create `raw-uploads`, `hls-output`, `thumbnails` if missing; set CORS allowing browser `PUT` and exposing the `ETag` header | Running it twice changes nothing; buckets listed in the console | [CreateBucket](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/CreateBucketCommand/) · [PutBucketCors](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/PutBucketCorsCommand/) |
| 3 | `lib/storage/s3Client.ts` with `forcePathStyle: true`; a second client on the public endpoint used only for presigning | Presigned URLs use `localhost`, even when the API later runs inside Docker | [S3Client config](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/) |
| 4 | ~~Add storage to `/health`~~ — dropped: `/health` stays a plain liveness check | — | — |
| 5 | Video repository plus a `transition(id, from, to)` helper that allows only UPLOADING → PROCESSING → READY or ERROR | Illegal transitions throw; the rule lives in one place | [Drizzle update with where](https://orm.drizzle.team/docs/update) |
| 6 | `POST /videos/uploads`: role check; allow mp4, mov, avi up to 5 GB; pick part size; `CreateMultipartUpload`; insert video as UPLOADING | Returns `videoId`, `uploadId`, `partSize`, `partCount`; a 6 GB request gets 400 | [CreateMultipartUpload](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/CreateMultipartUploadCommand/) |
| 7 | `POST /videos/:id/upload/parts`: presign a batch of part numbers (1-based), 1-hour expiry | Array of `{ partNumber, url }` | [s3-request-presigner](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/) |
| 8 | `GET /videos/:id/upload/parts`: `ListParts` so a client can resume | Lists part numbers and ETags already uploaded | [ListParts](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/ListPartsCommand/) |
| 9 | `POST /videos/:id/upload/complete` (parts sorted, ETags kept with quotes) → PROCESSING; `DELETE /videos/:id/upload` aborts → ERROR | File visible in `raw-uploads`; aborted uploads leave no parts behind | [CompleteMultipartUpload](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/CompleteMultipartUploadCommand/) |
| 10 | After completion, `HeadObject` checks the stored size against the declared size | Mismatch sets ERROR with a reason | [HeadObject](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/HeadObjectCommand/) |
| 11 | `scripts/upload.ts` CLI: 4 parts in parallel, progress bar, resume from `ListParts` | 1 GB upload completes; a killed upload resumes where it stopped | Node [fs.createReadStream](https://nodejs.org/api/fs.html#fscreatereadstreampath-options) with `start`/`end` |

Reference code — storage service in Compose (check the [RustFS README](https://github.com/rustfs/rustfs) for current env names):

```yaml
rustfs:
  image: rustfs/rustfs:latest
  ports: ['9000:9000', '9001:9001']   # S3 API, web console
  environment:
    RUSTFS_ACCESS_KEY: klyro
    RUSTFS_SECRET_KEY: klyro_dev_storage
    RUSTFS_CONSOLE_ENABLE: 'true'
  volumes: [storage_data:/data]
```

Two clients: one for server-to-storage calls, one only for signing URLs the browser will use. Without the second, presigned URLs point at `rustfs:9000`, which a browser can't reach once the API runs in Docker:

```ts
// lib/storage/s3Client.ts
const base = {
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
};
export const s3 = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });              // http://rustfs:9000
export const s3Public = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT }); // http://localhost:9000

// lib/storage/presign.ts
export const presignPart = (key: string, uploadId: string, partNumber: number) =>
  getSignedUrl(
    s3Public,
    new UploadPartCommand({ Bucket: BUCKETS.raw, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: 3600 },
  );
```

Part sizing within S3's limits (at most 10,000 parts; every part but the last at least 5 MiB):

```ts
const MiB = 1024 * 1024;
export const planParts = (size: number) => {
  const partSize = Math.max(8 * MiB, Math.ceil(size / 10_000));
  return { partSize, partCount: Math.ceil(size / partSize) };
};
```

Bucket CORS from the init script — `ExposeHeaders: ['ETag']` is what lets the browser read each part's ETag:

```ts
// scripts/storage-init.ts
await s3.send(new PutBucketCorsCommand({
  Bucket: BUCKETS.raw,
  CORSConfiguration: {
    CORSRules: [{
      AllowedOrigins: [env.FRONTEND_URL],
      AllowedMethods: ['PUT', 'GET'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    }],
  },
}));
```

- [x] Buckets and CORS created by a script, not by clicking
- [x] Video bytes never pass through the API
- [x] Type and size rules enforced at initiation
- [x] Upload resumes after being killed
- [x] Status changes only through the transition helper
- [x] ~~`/health` includes storage~~ (dropped)
- [ ] ADR written: why presigned multipart instead of uploading through the API
- [ ] 30-second GIF of the resume in the README

## Sprint 5 — Job queue and worker skeleton

**Showcase:** finish an upload and watch its job move through waiting → active → completed in Bull Board; turn on a failure flag and watch it retry with backoff, then land in failed with the video marked ERROR. The worker is a stub — real FFmpeg comes next sprint.

**Learn:** [BullMQ: what is a queue](https://docs.bullmq.io/what-is-bullmq) (producer, worker, job lifecycle) · [retrying failed jobs](https://docs.bullmq.io/guide/retrying-failing-jobs) · [going to production](https://docs.bullmq.io/guide/going-to-production).

**Tech:** bullmq, @bull-board/express, @bull-board/api.

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | `lib/queue/connection.ts` with its own ioredis connection and `maxRetriesPerRequest: null` | No BullMQ connection warnings on boot | [BullMQ connections](https://docs.bullmq.io/guide/connections) |
| 2 | `video-processing` queue: 3 attempts, exponential backoff from 5 s, keep the last 100 completed and 500 failed | Options visible on each job in Bull Board | [Queue options](https://docs.bullmq.io/guide/queues) |
| 3 | Enqueue on upload completion with `jobId: video-${id}` (no colon) | Completing twice creates one job, not two | [Job ids](https://docs.bullmq.io/guide/jobs/job-ids) |
| 4 | `src/worker.ts` entry point and `npm run dev:worker`; stub processor that reports progress 0→100 | Progress bar moves in Bull Board | [Workers](https://docs.bullmq.io/guide/workers) · [job progress](https://docs.bullmq.io/guide/workers#progress) |
| 5 | `FAIL_RATE` env flag to force failures; on the final attempt mark the video ERROR with the reason; throw `UnrecoverableError` for bad input | Retries show growing delays; the third failure sets ERROR | [Stop retrying jobs](https://docs.bullmq.io/patterns/stop-retrying-jobs) |
| 6 | Worker graceful shutdown with `worker.close()` on SIGTERM; set `concurrency` | Ctrl+C finishes the active job before exiting | [Graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown) |
| 7 | Bull Board at `/admin/queues`, protected with basic auth from env | Dashboard asks for a password | [bull-board](https://github.com/felixmosh/bull-board) |
| 8 | `scripts/requeue-stuck.ts`: re-enqueue videos stuck in PROCESSING with no job | Restarting Redis mid-demo does not lose a video forever | [Queue.getJob](https://api.docs.bullmq.io/classes/v5.Queue.html) |

Reference code — the producer side, with idempotent job ids:

```ts
// lib/queue/queues.ts
export type TranscodeJob = { videoId: string; requestId?: string };

export const videoQueue = new Queue<TranscodeJob>('video-processing', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 }, // 5s, 10s, 20s
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

export const enqueueTranscode = (videoId: string, requestId?: string) =>
  videoQueue.add('transcode', { videoId, requestId }, { jobId: `video-${videoId}` });
```

The consumer side: mark ERROR only after the last attempt, and finish the running job before exiting:

```ts
// worker.ts
const worker = new Worker<TranscodeJob>('video-processing', processVideo, {
  connection: queueConnection,
  concurrency: env.WORKER_CONCURRENCY, // start with 1: FFmpeg is CPU-heavy
});

worker.on('failed', async (job, err) => {
  if (!job) return;
  const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
  logger.error({ err, jobId: job.id, videoId: job.data.videoId, attempt: job.attemptsMade, final }, 'job failed');
  if (final) await videoService.markError(job.data.videoId, err.message);
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'worker shutting down');
  await worker.close(); // waits for the active job
  await Promise.allSettled([queueConnection.quit(), queryClient.end()]);
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [x] API and worker run as two separate processes from one codebase
- [x] Duplicate completions do not create duplicate jobs
- [x] Retries back off; final failure marks the video ERROR with a reason
- [x] Worker shuts down without dropping a running job
- [x] Bull Board is password-protected
- [x] Stuck PROCESSING videos and abandoned uploads can be repaired (`videos:requeue-stuck`, `videos:expire-uploads`)
- ~~ADR written: why a queue and a separate worker~~ (dropped; the reasoning lives in [learning/queues.md](learning/queues.md))
- [ ] GIF of jobs flowing and retrying in the README

## Sprint 6 — Transcoding worker

**Showcase:** a raw MP4 goes in; out come a thumbnail and an HLS stream with 1080p, 720p and 480p renditions that switches quality as you throttle the network. This completes the core story — **start applying for jobs after this sprint.**

**Learn:** [what HLS is](https://developer.apple.com/documentation/http-live-streaming) (master playlist, variant playlists, segments) · [Apple HLS authoring spec](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices) (bitrate ladder) · [FFmpeg HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2).

**Tech:** FFmpeg and ffprobe in the worker container, Node `child_process.spawn` (fluent-ffmpeg is archived).

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | Worker Dockerfile (`node:24-slim` + `apt-get install ffmpeg`) and a `worker` service in Compose | `docker compose exec worker ffmpeg -version` works | [Node Docker best practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md) · [multi-stage builds](https://docs.docker.com/build/building/multi-stage/) |
| 2 | Stream the raw object to `/tmp/klyro/<jobId>/source` | File on disk matches the object size | [GetObject](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/GetObjectCommand/) · [stream.pipeline](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-options) |
| 3 | `ffprobe -print_format json` for duration, width, height; save `duration_seconds`; no video stream → `UnrecoverableError` | Metadata saved on the video row | [ffprobe](https://ffmpeg.org/ffprobe.html) |
| 4 | Build the ladder: 1080/720/480, only renditions at or below the source height (never upscale); 6-second segments; aligned keyframes | One `master.m3u8` plus one playlist per rendition | [FFmpeg HLS](https://ffmpeg.org/ffmpeg-formats.html#hls-2) (`var_stream_map`, `master_pl_name`) |
| 5 | Run FFmpeg with `spawn(args)` (no shell), read `-progress pipe:1`, report job progress | Bull Board shows real transcode progress | [child\_process.spawn](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options) · [FFmpeg -progress](https://ffmpeg.org/ffmpeg.html#Main-options) |
| 6 | Thumbnail at 5 s (10% of duration for short clips), 640 px wide | `thumbnail.jpg` looks right | [FFmpeg seeking](https://trac.ffmpeg.org/wiki/Seeking) |
| 7 | Upload outputs to `hls-output/<videoId>/` and `thumbnails/<videoId>.jpg` with correct content types | Playlists served as `application/vnd.apple.mpegurl`, segments as `video/mp2t` | [@aws-sdk/lib-storage Upload](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-storage/) |
| 8 | Transition to READY with paths and metadata; final failure → ERROR with `error_message` | Video row shows READY or a readable error | Sprint 4, task 5 helper |
| 9 | Delete the temp folder in `finally`, success or failure | `/tmp/klyro` empty after every job | [fs.rm](https://nodejs.org/api/fs.html#fspromisesrmpath-options) |
| 10 | Log processing time and input size per job | A number for the README, e.g. "X minutes per GB on my laptop" | pino child logger with `videoId` |
| 11 | Play the master playlist in the hls.js demo page or VLC | Quality switches when you throttle the network | [hls.js demo](https://hlsjs.video-dev.org/demo/) |

Reference code — one Dockerfile, two targets. Only the worker image carries FFmpeg:

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/server.js"]

FROM api AS worker
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
USER node
CMD ["node", "dist/worker.js"]
```

The processor skeleton — each step is its own small function in `worker/pipeline/`, and the temp folder is always removed:

```ts
// worker/processors/video.processor.ts
export const processVideo = async (job: Job<TranscodeJob>) => {
  const dir = path.join(os.tmpdir(), 'klyro', job.id!);
  const log = logger.child({ jobId: job.id, videoId: job.data.videoId, requestId: job.data.requestId });
  try {
    await fs.mkdir(dir, { recursive: true });
    const video = await videoRepo.findById(job.data.videoId);
    if (!video?.rawPath) throw new UnrecoverableError('Video or source file missing');

    const src = await downloadToFile(video.rawPath, path.join(dir, 'source'));
    const meta = await probe(src); // { duration, width, height, hasAudio }
    await transcodeHls(src, path.join(dir, 'hls'), meta, (pct) => job.updateProgress(pct));
    await makeThumbnail(src, path.join(dir, 'thumb.jpg'), meta.duration);
    await uploadDir(path.join(dir, 'hls'), BUCKETS.hls, `${video.id}/`);
    await uploadFile(path.join(dir, 'thumb.jpg'), BUCKETS.thumbs, `${video.id}.jpg`);

    await videoService.markReady(video.id, {
      hlsPath: `${video.id}/master.m3u8`,
      thumbnailPath: `${video.id}.jpg`,
      durationSeconds: Math.round(meta.duration),
    });
    log.info('transcode complete');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};
```

Building the FFmpeg command — one decode, split into renditions no taller than the source, keyframes every 6 seconds so all renditions switch cleanly:

```ts
// worker/pipeline/transcode.ts
const LADDER = [
  { height: 1080, videoKbps: 5000, audioKbps: 128 },
  { height: 720, videoKbps: 2800, audioKbps: 128 },
  { height: 480, videoKbps: 1400, audioKbps: 96 },
];

export const buildHlsArgs = (src: string, out: string, sourceHeight: number, hasAudio: boolean) => {
  const rungs = LADDER.filter((r) => r.height <= sourceHeight);
  if (rungs.length === 0) rungs.push({ ...LADDER[2], height: sourceHeight - (sourceHeight % 2) });

  const split = `[0:v]split=${rungs.length}${rungs.map((_, i) => `[v${i}]`).join('')}`;
  const scales = rungs.map((r, i) => `[v${i}]scale=-2:${r.height}[v${i}o]`).join(';');
  const args = ['-y', '-i', src, '-filter_complex', `${split};${scales}`];

  rungs.forEach((r, i) => {
    args.push('-map', `[v${i}o]`, `-c:v:${i}`, 'libx264', `-b:v:${i}`, `${r.videoKbps}k`,
      `-maxrate:v:${i}`, `${Math.round(r.videoKbps * 1.07)}k`, `-bufsize:v:${i}`, `${r.videoKbps * 1.5}k`);
    if (hasAudio) args.push('-map', 'a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, `${r.audioKbps}k`);
  });

  args.push(
    '-preset', 'veryfast',
    '-force_key_frames', 'expr:gte(t,n_forced*6)',
    '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
    '-hls_segment_filename', `${out}/v%v/seg_%03d.ts`,
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', rungs.map((_, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`)).join(' '),
    '-progress', 'pipe:1', '-nostats',
    `${out}/v%v/index.m3u8`,
  );
  return args;
};

export const runFfmpeg = (args: string[], durationS: number, onProgress: (pct: number) => void) =>
  new Promise<void>((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] }); // args array: no shell injection
    let stderrTail = '';
    ff.stdout.on('data', (chunk: Buffer) => {
      const m = /out_time_us=(\d+)/.exec(chunk.toString());
      if (m) onProgress(Math.min(99, Math.round((Number(m[1]) / 1e6 / durationS) * 100)));
    });
    ff.stderr.on('data', (c: Buffer) => { stderrTail = (stderrTail + c.toString()).slice(-4000); });
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderrTail.slice(-500)}`)));
  });
```

- [x] Worker container has FFmpeg; API container does not need it
- [x] No upscaling; renditions match the source
- [x] Progress, READY and ERROR all visible
- [x] Temp files always cleaned up; a bad file never crashes the worker
- [x] Processing time recorded in `docs/NOTES.md`
- [x] README: architecture diagram (Mermaid) of upload → queue → worker → storage
- [ ] Demo GIF of raw video in, adaptive stream out — then start applying

## Sprint 7 — Library, playback and downloads

**Showcase:** a complete video API in Bruno — list, search and filter a club's videos, stream one through signed playlists, and download it until the club's quota runs out. After this sprint the backend is feature-complete.

**Learn:** [offset vs cursor pagination](https://use-the-index-luke.com/no-offset) · [Postgres pattern matching and ILIKE](https://www.postgresql.org/docs/current/functions-matching.html) · why presigning only the master playlist fails (segments are separate objects).

**Tech:** Drizzle queries and transactions, S3 `ListObjectsV2`, `DeleteObjects`, presigned `GetObject`.

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | `GET /clubs/:clubId/videos?page&limit&status&q`: limit capped at 50, newest first, `q` matched with ILIKE (escape `%` and `_`) | `{ items, page, limit, total }`; query uses `videos_club_created_idx` | [Drizzle filters](https://orm.drizzle.team/docs/operators) · optional [pg\_trgm index](https://www.postgresql.org/docs/current/pgtrgm.html) |
| 2 | `GET /videos/:id`: full metadata plus a 10-minute signed thumbnail URL | Title, status, duration, resolution, size, thumbnail | [presigned GetObject](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html) |
| 3 | `PATCH /videos/:id` (title, description) for the uploader or club\_owner and above | Viewers get 403 | Sprint 3, task 6 |
| 4 | `DELETE /videos/:id`: remove every object under the video's prefixes in batches of 1,000, remove a still-waiting job, then the row | Nothing left in any bucket for that id | [DeleteObjects](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/DeleteObjectsCommand/) |
| 5 | Signed streaming: `GET /videos/:id/stream/master.m3u8` rewrites variant URIs to API routes; each variant route rewrites segment lines to 5-minute presigned URLs | hls.js plays the API URL; copying a segment URL stops working after 5 minutes | [HLS playlist format](https://datatracker.ietf.org/doc/html/rfc8216) |
| 6 | `POST /videos/:id/download`: in one transaction, increment quota only if under the limit, insert a `download_logs` row, return a presigned URL with `Content-Disposition: attachment` | Downloads work until the limit, then 403 `QUOTA_EXCEEDED`; every download logged | Snippet below · [Drizzle transactions](https://orm.drizzle.team/docs/transactions) |
| 7 | `GET /clubs/:id/quota` (members) and `PATCH /clubs/:id/quota` (platform admin only — a club admin must not raise their own limit) | Admin can raise the limit; usage visible | Sprint 3 RBAC |
| 8 | Bruno collection covers every endpoint with example responses | Collection folder committed in `docs/api/` | [Bruno docs](https://docs.usebruno.com) |

Reference: the quota check must be one atomic statement, or two parallel requests can both slip under the limit.

```ts
// services/download.service.ts
export const createDownload = async (videoId: string, clubId: string, userId: string) => {
  return db.transaction(async (tx) => {
    const [quota] = await tx
      .update(downloadQuotas)
      .set({ usedCount: sql`${downloadQuotas.usedCount} + 1` })
      .where(and(
        eq(downloadQuotas.clubId, clubId),
        lt(downloadQuotas.usedCount, downloadQuotas.quotaLimit),
      ))
      .returning();
    if (!quota) throw new ForbiddenError('Download quota exceeded', 'QUOTA_EXCEEDED');

    await tx.insert(downloadLogs).values({ videoId, userId });
    return presignDownload(videoId); // GetObject + ResponseContentDisposition
  });
};
```

Signed streaming — playlists come through the API (access checked on every request); segments go straight to storage on 5-minute URLs:

```ts
// services/stream.service.ts
const readText = async (key: string) => {
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKETS.hls, Key: key }));
  return obj.Body!.transformToString();
};

export const masterPlaylist = async (videoId: string) => {
  const text = await readText(`${videoId}/master.m3u8`);
  // "v0/index.m3u8" → "/videos/<id>/stream/v0.m3u8"
  return text.replace(/^(v\d+)\/index\.m3u8$/gm, `/videos/${videoId}/stream/$1.m3u8`);
};

export const variantPlaylist = async (videoId: string, variant: string) => {
  if (!/^v\d+$/.test(variant)) throw new NotFoundError(); // never build keys from raw input
  const text = await readText(`${videoId}/${variant}/index.m3u8`);
  const lines = await Promise.all(
    text.split('\n').map((line) =>
      line.endsWith('.ts')
        ? getSignedUrl(s3Public, new GetObjectCommand({
            Bucket: BUCKETS.hls, Key: `${videoId}/${variant}/${line}`,
          }), { expiresIn: 300 })
        : line,
    ),
  );
  return lines.join('\n');
};

// controller: res.type('application/vnd.apple.mpegurl').send(body)
// frontend: hls.js adds the Bearer token to playlist requests via its xhrSetup option
```

- [x] Listing is paginated, filterable and searchable; search input is escaped
- [x] Streams play only through signed, expiring URLs
- [x] Quota is enforced atomically; every download is logged
- [x] Delete leaves no orphaned objects
- [x] ~~ADR written~~ (dropped by decision; signing and the CloudFront signed-cookie plan are explained in `docs/learning/playback.md` §9)
- [x] Bruno collection complete (in `bruno/`, not `docs/api/`)

## Sprint 8 — Real-time events and email notifications

**Showcase:** run a listener script for a club in one terminal, upload in another; the listener prints transcode progress and then `video:ready`, and a "your video is ready" email lands in Mailpit.

**Learn:** [Socket.io rooms](https://socket.io/docs/v4/rooms/) · [Socket.io middleware for auth](https://socket.io/docs/v4/middlewares/) · [BullMQ QueueEvents](https://docs.bullmq.io/guide/events) (how the API hears about work done in another process).

**Tech:** socket.io, socket.io-client (for the test script), BullMQ QueueEvents, Nodemailer + Mailpit.

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | Attach Socket.io to the API's HTTP server with the same CORS origin | Client connects to `ws://localhost:4000` | [Socket.io server](https://socket.io/docs/v4/server-initialization/) |
| 2 | Handshake auth: verify the access token from `socket.handshake.auth.token` | No token or a bad token → connection refused | [Socket.io middlewares](https://socket.io/docs/v4/middlewares/) |
| 3 | `club:join` event checks membership, then joins room `club:<id>` | Non-members get an error event, not the room | [Rooms](https://socket.io/docs/v4/rooms/) |
| 4 | In the API, listen to `QueueEvents` for progress, completed and failed; emit `video:progress`, `video:ready`, `video:failed` to the club room | Events arrive in the listener while the worker runs | [QueueEvents](https://docs.bullmq.io/guide/events) |
| 5 | `notifications` queue: when a video is READY, enqueue a `send-email` job; the worker sends it via Nodemailer with retries | Email in Mailpit; stopping Mailpit causes retries, not lost emails | [BullMQ](https://docs.bullmq.io) · [Nodemailer](https://nodemailer.com/message/) |
| 6 | `scripts/socket-listen.ts` using socket.io-client | Prints events as they happen | [socket.io-client](https://socket.io/docs/v4/client-api/) |
| 7 | Optional: Redis adapter so several API instances share rooms | Two API processes both deliver events | [Redis adapter](https://socket.io/docs/v4/redis-adapter/) |

Reference: the worker never talks to Socket.io directly; the API relays queue events.

```ts
// lib/realtime/socket.ts
export const initRealtime = (server: http.Server) => {
  const io = new Server(server, { cors: { origin: env.FRONTEND_URL, credentials: true } });

  io.use((socket, next) => {
    try {
      const { sub } = verifyAccessToken(socket.handshake.auth.token);
      socket.data.userId = sub;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('club:join', async (clubId: string) => {
      if (await clubRepo.isMember(clubId, socket.data.userId)) socket.join(`club:${clubId}`);
    });
  });

  const events = new QueueEvents('video-processing', { connection: queueConnection });
  events.on('completed', async ({ jobId }) => {
    const video = await videoRepo.findById(jobId.replace('video-', ''));
    if (video) io.to(`club:${video.clubId}`).emit('video:ready', { videoId: video.id });
  });
  return io;
};
```

- [x] Sockets require a valid access token
- [x] Clients only receive events for clubs they belong to
- [x] Progress, ready and failed events all reach the client
- [x] Emails are sent from a queue with retries
- [ ] GIF: upload in one window, live update in another

## Sprint 9 — Observability

**Showcase:** a Grafana dashboard showing request rate, error rate, p95 latency, queue depth and transcode time moving live while you upload; search one `videoId` and see its logs from the API and the worker together; an alert fires when errors pass 5%.

**Learn:** [Prometheus metric types](https://prometheus.io/docs/concepts/metric_types/) (counter, gauge, histogram) · [metric naming and labels](https://prometheus.io/docs/practices/naming/) (no ids as labels) · [PromQL basics](https://prometheus.io/docs/prometheus/latest/querying/basics/).

**Tech:** prom-client, pino-http, Prometheus, Grafana, Loki, Grafana Alloy.

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | `utils/metrics.ts` registry with default Node metrics; `GET /metrics` | Prometheus text at `/metrics` | [prom-client](https://github.com/siimon/prom-client) |
| 2 | HTTP middleware: `http_requests_total` and `http_request_duration_seconds`, labelled by route pattern, not URL | Labels read `/videos/:id`, never real ids | Snippet below |
| 3 | `pino-http` with a request id (`x-request-id`); pass it into job data so worker logs carry it | One id links a request to its job | [pino-http](https://github.com/pinojs/pino-http) |
| 4 | Worker metrics on port 9464: `video_jobs_total{status}`, `video_processing_duration_seconds`, `queue_depth{state}` (polled every 15 s), `active_workers` | Worker `/metrics` responds | [BullMQ getJobCounts](https://api.docs.bullmq.io/classes/v5.Queue.html) |
| 5 | Prometheus in Compose scraping API and worker | Both targets **UP** at `localhost:9090/targets` | [Prometheus config](https://prometheus.io/docs/prometheus/latest/configuration/configuration/) |
| 6 | Grafana with datasources and dashboard provisioned from files in `docker/grafana/` | Fresh `docker compose up` shows the dashboard, no clicking | [Grafana provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/) |
| 7 | Loki plus Grafana Alloy reading Docker container logs | `{service="api"} \|= "videoId"` returns lines in Grafana Explore | [Loki with Docker](https://grafana.com/docs/loki/latest/setup/install/docker/) · [loki.source.docker](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.docker/) |
| 8 | Alert rule: 5xx rate above 5% for 2 minutes, notifying via email to Mailpit | Forcing errors triggers an alert email | [Grafana alerting](https://grafana.com/docs/grafana/latest/alerting/) |

Reference:

```ts
// middleware/metrics.middleware.ts
export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    end({ method: req.method, route });
  });
  next();
};
```

```text
Request rate:  sum(rate(http_requests_total[1m]))
Error rate:    sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))
p95 latency:   histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

- [x] API and worker both expose metrics; no ids used as labels
- [x] Dashboard and datasources come from files in the repo
- [x] Logs from both processes searchable in one place by request id or video id
- [x] Error-rate alert fires and emails
- [x] Dashboard screenshot in the README

## Sprint 10 — Frontend demo app

**Showcase:** a 2–3 minute screen recording — sign in, pick a club, upload with a progress bar, see the card flip from PROCESSING to READY without refreshing, play it with adaptive quality, download it. It doesn't need to be pretty; it needs to prove the system works.

**Learn:** [Vite + React](https://vite.dev/guide/) · [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview) (server state) · why the access token lives in memory, not localStorage ([OWASP HTML5 storage](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage)).

**Tech:** React, TypeScript, Vite, React Router, TanStack Query, socket.io-client, hls.js (or Video.js).

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | `frontend/` with Vite React TS, React Router and TanStack Query | `npm run dev` serves on 5173 | [Vite](https://vite.dev/guide/) · [React Router](https://reactrouter.com/start/declarative/installation) |
| 2 | Auth: access token in memory; on load call `/auth/refresh` (cookie); on 401 refresh once and retry | Reloading keeps you signed in; no token in localStorage | [fetch credentials](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#credentials) |
| 3 | Login, register and "Sign in with Google" pages; protected-route wrapper | Signed-out users land on `/login` | [React Router](https://reactrouter.com) |
| 4 | Club picker and create-club form | Switching clubs changes the library | [TanStack mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) |
| 5 | Upload page: type and size check, 4 parts in parallel, progress bar, resume (store `uploadId` keyed by file name + size + lastModified), cancel | Refreshing mid-upload and choosing the same file resumes it | Snippet below · [XMLHttpRequest progress](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/upload) |
| 6 | Library grid: thumbnails, status badges, search, status filter, pagination; socket updates status live | A card turns READY on its own | [socket.io-client](https://socket.io/docs/v4/client-api/) |
| 7 | Player page with hls.js pointed at the signed master playlist; download button that shows quota errors | Plays with quality switching; quota error shown clearly | [hls.js](https://github.com/video-dev/hls.js) · [Video.js](https://videojs.com) |
| 8 | Record the demo and add it to the README | Link or GIF at the top of the README | [OBS](https://obsproject.com) or any screen recorder |

Reference: upload parts with a small concurrency pool and keep each part's ETag.

```ts
const uploadParts = async (file: File, videoId: string, partSize: number, done: Set<number>) => {
  const total = Math.ceil(file.size / partSize);
  const todo = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !done.has(n));
  const urls = await api.presignParts(videoId, todo); // [{ partNumber, url }]
  const parts: { PartNumber: number; ETag: string }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const { partNumber, url } = urls[next++];
      const blob = file.slice((partNumber - 1) * partSize, partNumber * partSize);
      const res = await fetch(url, { method: 'PUT', body: blob });
      parts.push({ PartNumber: partNumber, ETag: res.headers.get('ETag')! }); // needs CORS ExposeHeaders: ETag
      onProgress(parts.length + done.size, total);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return parts;
};
```

- [ ] Token never stored in localStorage; reload keeps the session
- [ ] Upload shows progress, resumes and can be cancelled
- [ ] Library updates live from socket events
- [ ] Player switches quality; download respects the quota
- [ ] Demo recording in the README

## Sprint 11 — Proof and polish

**Showcase:** a reviewer clones the repo, runs one command, and everything starts — API, worker, storage, database, dashboards. The README leads with a demo, an architecture diagram and real numbers. CI is green. **Phase 1 is done here.**

**Learn:** [Vitest](https://vitest.dev/guide/) · [GitHub Actions service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers) · [k6 load testing](https://grafana.com/docs/k6/latest/get-started/write-your-first-test/) · [Architecture Decision Records](https://adr.github.io).

**Tech:** Docker multi-stage builds, Vitest, Supertest, GitHub Actions, k6, Mermaid.

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | API Dockerfile (multi-stage, non-root, `npm ci --omit=dev`); a one-off `migrate` service runs before the API | `docker compose up` starts everything on a fresh clone | [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/) · [depends\_on conditions](https://docs.docker.com/compose/how-tos/startup-order/) |
| 2 | `npm run seed`: demo users, a club and a short sample video | Reviewer can log in with documented demo credentials | Drizzle inserts |
| 3 | Unit tests for token, status-transition and quota logic; integration tests for auth and upload initiation against real Postgres and Redis | `npm test` passes; services around 70% coverage | [Vitest](https://vitest.dev) · [Supertest](https://github.com/ladjs/supertest) · optional [Testcontainers](https://node.testcontainers.org) |
| 4 | GitHub Actions: install, lint, typecheck, test with Postgres and Redis service containers; build both images | Green check on every push | [Node.js in Actions](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs) |
| 5 | k6 test: login plus list videos at 50 virtual users for 2 minutes; time transcoding a 1 GB file with 1 and 2 workers | A "Performance" table in the README with p95, error rate and minutes per GB | [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/) |
| 6 | README: one-line pitch, demo GIF, Mermaid architecture diagram, features, stack and why, run steps, env table, Bruno collection, RBAC matrix, numbers, "what I'd do next" | A stranger understands it in 2 minutes | [Mermaid](https://mermaid.js.org/syntax/flowchart.html) · [GitHub Mermaid](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams) |
| 7 | ADRs in `docs/adr/`: Postgres over MongoDB, Drizzle, presigned multipart, queue plus worker, signed playlists, RustFS, pino | 6–8 short files, one decision each | [ADR templates](https://adr.github.io/adr-templates/) |
| 8 | 1–2 page case study from `docs/NOTES.md`: problem, design, hardest bug, numbers, next steps | Linked from the README; reusable for interviews | Your notes |
| 9 | Clean-up: no stray `console.log`, `npm audit` reviewed, tag `v1.0.0` | GitHub release published | [GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) |

Reference code — CI with real Postgres and Redis as service containers:

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend } }
    services:
      postgres:
        image: postgres:17-alpine
        env: { POSTGRES_USER: klyro, POSTGRES_PASSWORD: klyro, POSTGRES_DB: klyro_test }
        ports: ['5432:5432']
        options: --health-cmd "pg_isready -U klyro" --health-interval 5s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
    env:
      DATABASE_URL: postgresql://klyro:klyro@localhost:5432/klyro_test
      REDIS_URL: redis://localhost:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm, cache-dependency-path: backend/package-lock.json }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run db:migrate
      - run: npm test
```

A k6 script whose thresholds fail the run if p95 or error rate slip:

```js
// tests/load/list-videos.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 50,
  duration: '2m',
  thresholds: { http_req_duration: ['p(95)<300'], http_req_failed: ['rate<0.01'] },
};

export default function () {
  const res = http.get(`${__ENV.API}/clubs/${__ENV.CLUB}/videos?limit=20`, {
    headers: { Authorization: `Bearer ${__ENV.TOKEN}` },
  });
  check(res, { 'status 200': (r) => r.status === 200 });
}
```

- [ ] One command runs the whole system on a fresh machine
- [ ] Tests and CI green
- [ ] README shows demo, diagram and performance numbers
- [ ] ADRs and case study written
- [ ] `v1.0.0` tagged — pin the repo on your GitHub profile

## Load testing guide (k6)

A load test is an experiment with a question, not "hit it with 50 users". For KlyroStream you want three answers: how fast is it under normal load, where does it break, and what happens when it breaks. The deliverable is a Performance table in the README plus one bottleneck you found and fixed, with before-and-after numbers.

### Vocabulary you need

| Term | Meaning |
| --- | --- |
| VU (virtual user) | One loop running your `default` function over and over, in parallel with the others |
| Iteration | One run of the `default` function |
| Closed model (`vus`, `ramping-vus`) | A fixed number of users. If the API slows down, they send fewer requests, which hides the slowdown |
| Open model (`constant-arrival-rate`, `ramping-arrival-rate`) | A fixed request rate, like real traffic. Requests keep arriving even when the API is slow. **Use this for throughput and latency numbers** |
| Check | An assertion on a response (`status is 200`). A failing check doesn't stop the test; it's counted |
| Threshold | A pass/fail rule for the whole run (`p(95)<300`). If broken, k6 exits non-zero, so CI can fail on it |
| p95 / p99 | 95% / 99% of requests were faster than this. Report these, never the average |
| Tags and groups | Labels for splitting results per endpoint (`name:list`) |
| `setup()` / `teardown()` | Run once before and after: log in, create test data, clean up |
| `dropped_iterations` | Requests k6 couldn't start on time in arrival-rate mode — a sign the system (or your VU pool) couldn't keep up |

### The six test types

From the [Grafana k6 test-type guide](https://grafana.com/docs/k6/latest/testing-guides/test-types/). Run them in this order; each one's result sets the numbers for the next.

| Type | Question it answers | Shape for KlyroStream |
| --- | --- | --- |
| Smoke | Does the script work at all? | 1–2 VUs for 1 minute |
| Average load | How does it behave on a normal day? | Your expected rate (start with a guess such as 20 requests/s) for 10 minutes |
| Stress | Does it degrade gracefully above normal? | 2–3× average for 10 minutes |
| Spike | Does it survive a sudden burst? | Jump to 10× in 10 seconds, hold 1 minute, drop |
| Soak | Does it leak memory or connections over time? | Average load for 1–2 hours |
| Breakpoint | What is the capacity limit? | Ramp the rate up until thresholds fail, then stop |

### What to test in KlyroStream

| Scenario | Endpoints | What it proves | Watch in Grafana |
| --- | --- | --- | --- |
| Browse | list, search, get video | Queries and indexes hold up | p95 by route, Postgres connections |
| Auth | login, refresh | bcrypt cost per request (about 250 ms at cost 12, by design) and that the rate limiter returns 429 | CPU, 429 count |
| Upload control plane | initiate, presign parts, complete (small 5–10 MB files) | API overhead of the upload flow, without your network speed in the way | p95 by route |
| Streaming | master and variant playlists, then segments | Cost of signing every segment URL per playlist request | p95 on the variant route, CPU |
| Pipeline | enqueue many videos at once | Videos per hour and minutes per GB, with 1 vs 2 workers | `queue_depth`, `video_processing_duration_seconds` |

Socket.io isn't plain WebSocket, so k6 can't speak it directly; leave real-time out, or test it later with a tool that supports Socket.io.

### A realistic script

Open-model arrival rate, login once in `setup()`, per-endpoint tags and thresholds:

```js
// tests/load/browse.js
import http from 'k6/http';
import { check, group } from 'k6';
import { SharedArray } from 'k6/data';

const API = __ENV.API || 'http://localhost:4000';
const terms = new SharedArray('terms', () => JSON.parse(open('./data/search-terms.json')));

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-arrival-rate', // open model: traffic keeps coming even if the API slows
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: 20, duration: '2m' }, // warm up to average load
        { target: 20, duration: '5m' }, // hold
        { target: 60, duration: '2m' }, // stress: 3x average
        { target: 0, duration: '1m' },  // recovery
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:list}': ['p(95)<300'],   // starting targets — adjust after your first run
    'http_req_duration{name:search}': ['p(95)<500'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const res = http.post(`${API}/auth/login`,
    JSON.stringify({ email: __ENV.EMAIL, password: __ENV.PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } });
  check(res, { 'logged in': (r) => r.status === 200 });
  return { token: res.json('accessToken'), clubId: __ENV.CLUB };
}

export default function ({ token, clubId }) {
  const req = (name) => ({ headers: { Authorization: `Bearer ${token}` }, tags: { name } });

  group('library', () => {
    const list = http.get(`${API}/clubs/${clubId}/videos?limit=20`, req('list'));
    check(list, { 'list 200': (r) => r.status === 200 });

    const q = terms[Math.floor(Math.random() * terms.length)];
    const search = http.get(`${API}/clubs/${clubId}/videos?q=${encodeURIComponent(q)}`, req('search'));
    check(search, { 'search 200': (r) => r.status === 200 });
  });
}
```

A breakpoint test only changes the options — ramp until it breaks, and stop the moment it does:

```js
export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-arrival-rate',
      startRate: 10, timeUnit: '1s', preAllocatedVUs: 100, maxVUs: 1000,
      stages: [{ target: 500, duration: '15m' }],
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true }],
    http_req_duration: [{ threshold: 'p(95)<1000', abortOnFail: true }],
  },
};
// Result to report: "handled N requests/s before p95 passed 1 s"
```

### Make the numbers honest

- **Seed real volume first.** Empty tables make every query fast. Seed around 10,000 videos across several clubs so indexes actually matter.
- **Test the production build.** `npm run build`, `NODE_ENV=production`, logs at `info`. Pretty-printed debug logs alone can halve throughput.
- **Cap the API's resources.** k6 and the API share your laptop. Limit the API container (`deploy.resources.limits.cpus: '1'`, `memory: 512M`) so results mean "one small server" and are repeatable.
- **Mind token expiry.** Access tokens last 15 minutes; set `JWT_ACCESS_TTL=2h` in the load-test env, or soak tests fail halfway with 401s.
- **Disable or raise the auth rate limit** for throughput tests, and test the limiter separately to prove it returns 429.
- **Warm up** for a minute before the part you measure, and run each test twice; trust numbers that repeat.

### Run it and watch it live

```bash
# 1. Smoke
k6 run tests/load/smoke.js

# 2. Real run, with results streamed into your own Prometheus and Grafana
K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write \
K6_PROMETHEUS_RW_TREND_STATS="p(95),p(99),avg" \
k6 run -o experimental-prometheus-rw --tag testid=browse-v1 \
  -e API=http://localhost:4000 -e EMAIL=load@klyro.dev -e PASSWORD=*** -e CLUB=<clubId> \
  tests/load/browse.js
```

Prometheus must run with `--web.enable-remote-write-receiver`; then import Grafana dashboard **19665** (k6 Prometheus). You'll see k6's load and your API's metrics side by side on the same time axis ([k6 Prometheus output](https://grafana.com/docs/k6/latest/results-output/real-time/prometheus-remote-write/)).

### Read the results

1. Did thresholds pass? The run's exit code and the summary's ✓/✗ lines tell you.
2. Look at p95 and p99 per tag, plus `http_req_failed` and `checks`.
3. Check `dropped_iterations`. Above zero means the target rate wasn't met.
4. Line up the slow minutes with Grafana: CPU, `nodejs_eventloop_lag_seconds`, Postgres connections, queue depth. The first thing to saturate is your bottleneck.
5. Fix one thing, rerun the identical test, record before and after.

Likely first findings, to confirm rather than assume:

- Search with `ILIKE '%term%'` can't use a normal index → add a `pg_trgm` GIN index.
- Signing every segment on each variant-playlist request burns CPU → cache the signed playlist in Redis for a minute.
- The Postgres pool (`max: 10`) saturates under stress → requests queue waiting for a connection.
- Login throughput is capped by bcrypt, by design → that's why it's rate limited, not "fixed".

### Pipeline throughput (not an HTTP test)

Transcoding speed is measured with a script, not k6: `scripts/bench-pipeline.ts` uploads one sample file N times and times how long the queue takes to drain. Record it from `video_processing_duration_seconds` in Grafana.

| Workers × concurrency | Sample | Time per video | Videos per hour |
| --- | --- | --- | --- |
| 1 × 1 | 1 GB, 1080p | measure | measure |
| 2 × 1 | 1 GB, 1080p | measure | measure |

### What goes in the README

```markdown
## Performance

Tested on: <CPU>, <RAM>; API limited to 1 CPU / 512 MB; 10,000 seeded videos.

| Test | Load | p95 | Errors |
| --- | --- | --- | --- |
| Browse (average) | 20 req/s for 5 min | ... ms | ...% |
| Browse (stress) | 60 req/s for 2 min | ... ms | ...% |
| Breakpoint | ramp to failure | fails at ... req/s | |

Bottleneck found: search used a sequential scan. Added a pg_trgm GIN index:
p95 for search went from ... ms to ... ms.
```

- [ ] Smoke, average-load, stress and breakpoint runs done on seeded data
- [ ] Thresholds in every script; CI runs the smoke test
- [ ] One bottleneck found, fixed and measured before and after
- [ ] Pipeline throughput measured with 1 and 2 workers
- [ ] Performance section in the README

## Sprint 12 — AI captions and transcript search (optional)

**Showcase:** every video gets auto-generated captions in the player, and searching a club for a spoken phrase ("penalty") returns the video and the exact second it was said; clicking jumps there. Runs locally with no API costs.

**Learn:** [how Whisper transcribes](https://github.com/openai/whisper#approach) · [WebVTT](https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API) · [Postgres full-text search](https://www.postgresql.org/docs/current/textsearch-intro.html).

**Tech:** whisper.cpp (local), FFmpeg, BullMQ job chaining, Postgres `tsvector` + GIN index.

| # | Task | Expected output | How-to and references |
| --- | --- | --- | --- |
| 1 | Add whisper.cpp and a small model to the worker image | `whisper-cli --help` runs in the container | [whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| 2 | `captions` queue, enqueued when a video becomes READY | Caption job visible in Bull Board after each transcode | [BullMQ flows](https://docs.bullmq.io/guide/flows) or a plain enqueue |
| 3 | Extract mono 16 kHz audio with FFmpeg; run Whisper to produce VTT and timestamped JSON | `captions.vtt` with sensible timings | [Whisper + FFmpeg in a Node worker](https://dev.to/kyle_clipspeedai/auto-caption-generation-whisper-ffmpeg-in-a-nodejs-worker-53b0) |
| 4 | Add a subtitles rendition to the HLS master (`EXT-X-MEDIA:TYPE=SUBTITLES`) | Player shows a CC toggle | [WebVTT in HLS](https://dev.to/masonwritescode/shipping-webvtt-subtitles-in-hls-that-actually-stay-in-sync-a-hands-on-guide-for-2026-22cd) · [RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216) |
| 5 | `video_transcript_segments` table with a generated `tsvector` column and GIN index | Migration committed | [Drizzle generated columns](https://orm.drizzle.team/docs/generated-columns) |
| 6 | `GET /clubs/:id/search?q=` returning video, start time and snippet | Results ranked by relevance | Snippet below |
| 7 | Frontend: result click opens the player at that second | Jumps straight to the moment | [hls.js API](https://github.com/video-dev/hls.js/blob/master/docs/API.md) (`video.currentTime`) |
| 8 | Measure: seconds of processing per audio minute; word error rate on one 2-minute clip; label captions "auto-generated" | Numbers and known limits (accents, crowd noise) in the README | [WER explained](https://en.wikipedia.org/wiki/Word_error_rate) |

Reference:

```sql
SELECT v.id, v.title, s.start_ms,
       ts_headline('english', s.text, q) AS snippet
FROM video_transcript_segments s
JOIN videos v ON v.id = s.video_id
CROSS JOIN websearch_to_tsquery('english', $1) q
WHERE v.club_id = $2 AND s.tsv @@ q
ORDER BY ts_rank(s.tsv, q) DESC
LIMIT 20;
```

- [ ] Captions generated locally, shown in the player, marked auto-generated
- [ ] Search inside transcripts returns timestamps and jumps to them
- [ ] Accuracy and timing measured and written up honestly
- [ ] ADR written: local Whisper vs a paid API (cost, privacy, speed)

## Conventions for every sprint

These apply everywhere, so they live here once instead of in each sprint.

| Area | Convention |
| --- | --- |
| Commits | Conventional Commits with a scope: `feat(videos): presign upload parts`. Scopes: `auth`, `clubs`, `videos`, `storage`, `queue`, `worker`, `db`, `api`, `obs`, `web`, `docs`, `ci`. One logical change per commit |
| Branches | `main` stays runnable. Work on `feat/<sprint-topic>`, open a PR to yourself, merge when the sprint checklist passes |
| API shape | JSON only. Errors: `{ error: { code, message, details? } }`. Lists: `{ items, page, limit, total }`. camelCase in JSON, snake\_case in the database |
| Status codes | 400 validation · 401 not signed in · 403 not allowed · 404 not found (also for resources the user may not know exist) · 409 conflict · 429 rate limited · 503 dependency down |
| Config | Read env only through `config/env.ts`. Every new variable goes into `.env.example` and the README env table |
| Logging | pino, object first: `logger.info({ videoId, jobId }, 'transcode done')`. Never log tokens, passwords or full request bodies |
| API docs | Every new endpoint gets a Bruno request with an example response in `docs/api/` |
| Decisions | A new ADR in `docs/adr/` whenever you pick between two real options |
| Notes | 2–3 lines in `docs/NOTES.md` per sprint: surprise, decision, number |
| Tooling | Node 24, TypeScript 5 (pinned), ESLint flat config, Prettier; `npm run lint && npm run typecheck` before every commit |

## Backlog: transfer club ownership

The club creator is protected from being demoted, removed, or leaving. To let them step away:

- `POST /clubs/:clubId/transfer` `{ userId }`, creator only; the target must already be an admin.
- One transaction: lock the club row, check the caller is still `owner_id`, set `owner_id` to the target.
- Afterwards the old creator is an ordinary admin and can leave or be demoted.

## Parked: platform admin

Sprint 3 has club roles only. Add a platform-wide admin when the first platform-level action is needed (Sprint 7 quota changes at the latest).

| Piece | Plan |
| --- | --- |
| Schema | `users.is_platform_admin boolean not null default false`; set by a seed script or SQL, never through the API |
| Middleware | `requirePlatformAdmin` next to `requireClubRole`; 403 otherwise |
| First uses | `PATCH /clubs/:id/quota`; later list or suspend clubs and users |
| Rule | A platform admin gets no club role implicitly; club data still goes through `requireClubRole` unless a route says otherwise |

## Backlog: email verification on registration

Local sign-up does not prove the user owns the email today. Add it after Sprint 3.

| Piece | Plan |
| --- | --- |
| Schema | `users.email_verified_at timestamptz null` |
| Already verified | Accounts created from an invitation (the link proved the inbox) and from Google (`email_verified: true`) set it on creation |
| Flow | `POST /auth/register` sends a link with a single-use token (`emailverify:{sha256}` in Redis, 24 h, `GETDEL`); `POST /auth/verify-email { token }` sets `email_verified_at`; `POST /auth/resend-verification` is rate limited |
| Gate | Unverified users can sign in but get 403 `EMAIL_NOT_VERIFIED` on club creation and invitation accept |
| Password reset | A completed reset also marks the email verified |
| Google linking | Not planned: an account keeps the sign-in method it was created with (Sprint 3 decision) |

## Parked for Phase 2 (cloud)

Nothing below is needed to finish Phase 1 or to start applying. It stays parked until Sprint 11 is done.

| Topic | What it replaces or adds | Note for later |
| --- | --- | --- |
| LocalStack | Rehearse AWS locally | Now needs a free account and auth token; non-commercial use only |
| Terraform | `docker-compose.yml` as infrastructure | dev, staging and prod environments |
| AWS S3 + CloudFront | RustFS and API-signed playlists | CloudFront signed cookies replace the playlist rewriting from Sprint 7 |
| RDS Postgres, ElastiCache Redis | Local containers | Only connection strings change, thanks to `config/env.ts` |
| SQS, SNS, SES | BullMQ notifications and Mailpit | Compare job queue vs message queue in an ADR |
| Kubernetes (minikube → EKS) | Compose | Liveness and readiness probes use `/health`; worker autoscaling on `queue_depth` |
| GitHub Actions deploy → ECR → EKS | Sprint 11 CI | Build once, deploy per environment |
| CloudWatch, New Relic | Local Grafana stack | Distributed tracing across API and worker; $50 billing alarm |

## Sources

Pages opened while checking this plan (September 2026):

- [Top 10 backend portfolio projects for 2026 — Nucamp](https://www.nucamp.co/blog/top-10-backend-portfolio-projects-for-2026-that-actually-get-you-hired)
- [MinIO Docker image changes — Minimus](https://www.minimus.io/post/minio-docker-image-changes-how-to-find-a-secure-minio-alternative)
- [Alternatives to MinIO for single-node local S3 — Robin Moffatt](https://rmoff.net/2026/01/14/alternatives-to-minio-for-single-node-local-s3/)
- [Self-hosted S3 storage in 2026: RustFS, SeaweedFS, Garage — Rilavek](https://rilavek.com/resources/self-hosted-s3-compatible-object-storage-2026)
- [Promtail end of life, March 2026 — Grafana forum](https://community.grafana.com/t/promtail-end-of-life-eol-march-2026-how-to-migrate-to-grafana-alloy-for-existing-loki-server-deployments/159636)
- [Phasing out fluent-ffmpeg — GitHub issue #1324](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324)
- [LocalStack 2026 pricing and packaging](https://blog.localstack.cloud/2026-upcoming-pricing-changes/)
- [Drizzle latest releases](https://orm.drizzle.team/docs/latest-releases)
- [Zod 4 release notes](https://zod.dev/v4)
- [ESLint v10.0.0 released](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/)
- [Mailpit vs MailHog — SendPigeon](https://sendpigeon.dev/blog/mailpit-vs-mailhog)
- [BullMQ job ids](https://taskforcesh-bullmq.mintlify.app/jobs/job-ids)
- [Express in 2026 — PkgPulse](https://www.pkgpulse.com/guides/express-is-dead-long-live-express)
- [k6 load test types — Grafana](https://grafana.com/docs/k6/latest/testing-guides/test-types/)
- [k6 Prometheus remote write output — Grafana](https://grafana.com/docs/k6/latest/results-output/real-time/prometheus-remote-write/)
