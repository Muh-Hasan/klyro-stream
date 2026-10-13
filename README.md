# KlyroStream

A private video platform for sports clubs: upload match footage from any device, have it transcoded into adaptive HLS streams, and share it only with your club.

## Run it locally

Needs Docker and Node 24.

```bash
docker compose up -d          # Postgres, Redis, RustFS (S3), Mailpit
cd backend
cp .env.example .env          # then fill in the secrets it lists
npm install
npm run db:migrate
npm run storage:init
npm run dev                   # API on http://localhost:4000
npm run dev:worker            # second terminal: the video worker
```

| | |
|---|---|
| Upload a video from the CLI | `npm run upload -- <file> --club <clubId>` |
| Job dashboard (Bull Board) | http://localhost:4000/admin/queues, with `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` set in `.env` |
| Repair stuck videos | `npm run videos:requeue-stuck -- --dry-run` |
| Expire abandoned uploads | `npm run videos:expire-uploads -- --dry-run` |
| API requests | the Bruno collection in `bruno/` ([guide](docs/bruno.md)) |

How it works: [uploads](docs/learning/uploads.md) · [job queues and workers](docs/learning/queues.md) · [locking](docs/learning/locking.md) · [indexes](docs/learning/indexes.md)
