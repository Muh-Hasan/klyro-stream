# Bruno

[Bruno](https://www.usebruno.com/) is the API client for this project. Requests are plain-text `.bru` files in the `bruno/` folder, so they are committed and reviewed like code.

## Setup

1. Install the Bruno desktop app: https://www.usebruno.com/downloads
2. In Bruno, choose **Open Collection** and select the `bruno/` folder at the repo root.
3. In the environment dropdown (top right), select **local**.
4. Start the API (`npm run dev` in `backend/`), then open **health → Get health** and press **Send** (Ctrl+Enter).

## Folder layout

```
bruno/
├── bruno.json            # collection config
├── environments/
│   └── local.bru         # baseUrl = http://localhost:4000
└── health/               # one folder per feature
    └── Get health.bru
```

## Adding a request

1. Right-click the feature folder (or the collection, to add a folder with **New Folder**) and choose **New Request**.
2. Give it a clear name, e.g. `Register user`.
3. Use the `{{baseUrl}}` variable instead of a hard-coded host: `{{baseUrl}}/auth/register`.
4. Set the method, body (**Body → JSON**) and headers as needed.
5. Save with Ctrl+S. Bruno writes a `.bru` file into the folder; commit it with the feature it covers.

Keep one folder per feature to match the routes in `backend/src/routes/index.ts` (`health/`, `auth/`, `clubs/`, ...).

## Variables and environments

- Add shared values to `environments/local.bru` under `vars { ... }`, then use them as `{{name}}`.
- To target another server, add a new environment (e.g. `staging`) from **Environments → Configure**.
- Never commit secrets. Mark a variable as **secret** in the environment settings; Bruno then keeps its value out of the `.bru` file.
- To pass a value from one request to the next (e.g. a login token), set it in the first request's **Script → Post Response**:

  ```js
  bru.setVar("accessToken", res.getBody().accessToken);
  ```

  and use it in later requests as `{{accessToken}}` (e.g. **Auth → Bearer Token**).

## Running from the command line

With the API running, from the `bruno/` folder:

```bash
npx @usebruno/cli run --env local
```

This sends every request in the collection and prints each response status. Add `-r` to include subfolders when running a single folder, e.g. `npx @usebruno/cli run health --env local`.

## Video uploads

The `videos/` folder uploads a real video end to end: initiate, presign, every part straight to RustFS, progress, complete. It uses `videos/fixtures/sample-video.mp4`, which is **git-ignored** (GitHub rejects files over 100 MB), so put any mp4 at that path first.

The scripts read the local file, so the collection needs Bruno's **Developer** JavaScript sandbox: in the app, open the collection settings and set **JavaScript Sandbox → Developer Mode**; on the CLI, pass `--sandbox developer`. Run **auth → Login** and **clubs → Create club** first, so `accessToken` and `clubId` are set.

| # | Request | Goes to | Script does | Asserts |
|---|---|---|---|---|
| 1 | Initiate upload | API | sets `sizeBytes` from the file on disk; saves `videoId`, `partSize`, `partCount` | 201, `UPLOADING` |
| 2 | Presign parts | API | asks for parts `1..partCount`; saves `partUrls` | 200 |
| 3 | Upload part | **RustFS** (presigned URL, no auth header) | reads only that part's byte range from the file; **repeats itself** with `bru.runner.setNextRequest` until every part is sent | 200 and an `ETag`, per part |
| 4 | Upload progress | API | saves the receipts as `uploadedParts` | nothing missing |
| 5 | Complete upload | API | | 200, `PROCESSING` |
| 6 | Abort upload | API | | none: use it *instead of* Complete; after Complete it returns 409, which is expected |

From the command line (API running, `accessToken` from a login):

```bash
cd bruno
npx @usebruno/cli run videos --env local --sandbox developer --env-var accessToken=<token> --env-var clubId=<clubId>
```

With the 228 MB sample: 34 requests (29 of them "Upload part"), 66/66 assertions, about 2.5 s locally.

For parallel parts and resume after a kill, use the CLI: `npm run upload -- <file> --club <clubId>` in `backend/`. See [learning/uploads.md](learning/uploads.md) and [learning/uploads-lab.md](learning/uploads-lab.md).
