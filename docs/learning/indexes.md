# Database indexes (PostgreSQL)

How indexes work, and every index KlyroStream uses, tied to real code and measured with `EXPLAIN ANALYZE`. See also [locking.md](locking.md) for how concurrent writes stay correct, and [uploads.md](uploads.md) for resumable video uploads.

## What an index is

A table is stored as an unordered pile of rows (the *heap*). To answer `WHERE email = 'a@b.com'` without help, Postgres reads **every row** and throws away the ones that don't match. That is a **sequential scan**: its cost grows with the table.

An index is a separate, **sorted** structure that maps column values to row locations. The default type is a **B-tree**, a balanced tree a few levels deep. Finding one value means walking from the root to a leaf, which is a handful of page reads whether the table has 100 rows or 100 million.

```
            [ m ]                       root
          /       \
     [ c | g ]   [ r | w ]              branches
     /   |   \    ...
 [a b] [d e f] [h i ...]                leaves → point at rows in the heap
```

Besides `=`, a B-tree also handles `<`, `>`, `BETWEEN`, `ORDER BY`, `IN`, and `LIKE 'prefix%'`. Postgres has other index types (GIN for arrays/JSON/full-text, GiST for geometry/ranges, BRIN for huge append-only tables, hash), but every index in this project is a B-tree.

## What it costs

Indexes are not free:

- **Writes get slower.** Every `INSERT`, every `DELETE`, and every `UPDATE` of an indexed column must also update each index on the table.
- **Disk and memory.** An index can be a large fraction of the table's size. Measured below: on 100k invitations the table is 17 MB, and `club_invitations_token_uniq` alone is 7.7 MB.
- **The planner may not use it.** Postgres picks the cheapest plan. On a tiny table, or when a condition matches a large share of the rows, a sequential scan is cheaper and the index is ignored.

The rule: **index the columns your queries actually filter, join, or sort on, and nothing else.**

## Kinds of index used here

| Kind | What it means | Example in our schema |
|---|---|---|
| **Primary key** | Unique + not null. Postgres creates the index automatically. | `users.id`, `clubs.id` |
| **Unique index** | Rejects duplicate values. It is both a rule and a fast lookup. | `users_email_uniq`, `club_invitations_token_uniq` |
| **Plain (non-unique) index** | Lookup speed only, no rule. | `club_members_club_idx`, `clubs_owner_idx` |
| **Composite index** | More than one column, in a specific order. | `club_members` primary key `(user_id, club_id)`, `users_provider_uniq (provider, provider_id)` |
| **Partial index** | Contains only the rows that match a `WHERE` condition. | `club_invitations_pending_uniq … WHERE status = 'pending'` |

A **full** index (the normal case) covers every row in the table. A **partial** index covers only some rows. More on that below.

## Composite indexes: column order matters

A composite index is sorted by its first column, then by the second within each first value, like a phone book (last name, then first name).

It can be used when a query filters on a **leading prefix** of its columns:

| Index `(user_id, club_id)` | Usable? |
|---|---|
| `WHERE user_id = ? AND club_id = ?` | ✅ exact lookup |
| `WHERE user_id = ?` | ✅ leading column |
| `WHERE club_id = ?` | ❌ skips the first column (like finding everyone named "Ali" in a phone book sorted by last name) |

That is exactly why `club_members` has **two** indexes:

- The primary key `(user_id, club_id)` answers "which clubs is this user in?" and "what is this user's role in this club?"
- `club_members_club_idx (club_id)` answers "who is in this club?"

It also means an index on `(a)` is **redundant** when `(a, b)` already exists, because `(a, b)` serves `WHERE a = ?` too. See `videos_club_idx` below.

## Partial indexes

```ts
uniqueIndex('club_invitations_pending_uniq')
  .on(t.clubId, t.email)
  .where(sql`${t.status} = 'pending'`)
```

This index contains **only pending invitations**. That gives us two things:

1. **A rule that applies only while pending.** A club can have just one *pending* invite per email. Once an invite is accepted, rejected, revoked, or expired, it leaves the index, so the same email can be invited again. A plain unique index on `(club_id, email)` would block every re-invite forever.
2. **A smaller, faster index.** Old invites pile up, but pending ones stay few. With 100k invitations of which 20% were pending, this index was **1.9 MB**. The full `club_invitations_email_idx` on the same table was **7.0 MB**.

The catch: the planner can only use a partial index when the query's `WHERE` **implies** the index's condition. A query with `status = 'pending'` can use it. A query with `status = 'accepted'`, or with no status filter, cannot (see plan 5 below).

Other good candidates for partial indexes are a small "hot" subset of a big table: active jobs, unread notifications, non-deleted rows.

## Every index in the schema

All of them live in `backend/src/lib/db/schema.ts`.

| Index | Columns | Kind | Why it exists / which code uses it |
|---|---|---|---|
| `users_pkey` | `id` | PK | `findById`, every join or relation to users |
| `users_email_uniq` | `email` | unique | `findByEmail` (login, register, invite checks). It also guarantees one account per email. |
| `users_provider_uniq` | `provider, provider_id` | unique, composite | `findByProvider` (Google `sub` lookup). It also guarantees one user per Google account. |
| `clubs_pkey` | `id` | PK | `findById`, `updateName` |
| `clubs_owner_idx` | `owner_id` | plain | Foreign-key support (see "Foreign keys" below) |
| `club_members_user_id_club_id_pk` | `user_id, club_id` | PK, composite | `getMemberRole` (runs on **every** club request via `requireClubRole`), `listForUser`, `lockMember`'s member-row lock, `onConflictDoNothing` on accept |
| `club_members_club_idx` | `club_id` | plain | `listForClub`, member counts, and `lockMember`'s lock on all admin rows |
| `club_invitations_pkey` | `id` | PK | `revoke`, `claim` |
| `club_invitations_token_uniq` | `token_hash` | unique | `findByTokenHash` (preview, accept, register, reject) |
| `club_invitations_pending_uniq` | `club_id, email` WHERE pending | unique, partial, composite | One pending invite per club+email; `findPending`, `listPending` |
| `club_invitations_email_idx` | `email` | plain | No query filters on email alone yet. It would back a future "my invitations" screen. |
| `videos_club_idx` | `club_id` | plain | **Redundant**: covered by `videos_club_created_idx` |
| `videos_status_idx` | `status` | plain | For workers looking for videos in a given state (Sprint 5+) |
| `videos_club_created_idx` | `club_id, created_at` | composite | "Videos in this club, newest first" (Sprint 7) |
| `download_logs_video_idx` | `video_id` | plain | Downloads per video (Sprint 7) |
| `download_logs_user_idx` | `user_id` | plain | Downloads per user (Sprint 7) |

## Measured, not guessed: `EXPLAIN ANALYZE`

`EXPLAIN` shows the plan Postgres *would* use. `EXPLAIN ANALYZE` runs the query and shows real timings. These plans were taken from the dev database after inserting 100k users and 100k invitations **inside a transaction that was rolled back**, so nothing was kept:

```sql
begin;
insert into users (...) select ... from generate_series(1, 100000) g;
analyze users;           -- refresh the planner's statistics
explain analyze select ...;
rollback;
```

With only a few dozen real rows, Postgres would pick sequential scans for everything, which is correct for tiny tables and teaches nothing.

**1. `findByEmail`: unique index**
```
Index Scan using users_email_uniq on users  (actual time=0.029..0.030 rows=1)
Execution Time: 0.070 ms
```

**2. The same lookup written as `lower(email) = ?`: index NOT used**
```
Seq Scan on users
  Filter: (lower((email)::text) = 'bulk5000@example.com'::text)
  Rows Removed by Filter: 100020
Execution Time: 80.456 ms                ← ~1000× slower
```
Wrapping the column in a function hides it from a plain index. We avoid this by **lowercasing emails in the Zod validator** (`validators/auth.schema.ts`) before they are stored or searched, so a plain `email = ?` always works. The alternative is an *expression index*: `CREATE INDEX ... ON users (lower(email))`.

**3. `findByTokenHash`: unique index**
```
Index Scan using club_invitations_token_uniq   Execution Time: 0.079 ms
```

**4. `findPending` (`status = 'pending'`): partial index used**
```
Index Scan using club_invitations_pending_uniq
  Index Cond: ((club_id = ...) AND (email = 'inv10@example.com'))
Execution Time: 0.107 ms
```
The status condition doesn't even appear: every row in the index is already pending.

**5. The same query with `status = 'accepted'`: partial index unusable**
```
Index Scan using club_invitations_email_idx
  Index Cond: (email = 'inv11@example.com')
  Filter: ((club_id = ...) AND (status = 'accepted'))
```
Postgres fell back to the plain email index and filtered the rest. This is the one case where `club_invitations_email_idx` helps today.

**6. `listPending` count: bitmap scan on the partial index**
```
Bitmap Index Scan on club_invitations_pending_uniq   (rows=20000)
Bitmap Heap Scan on club_invitations
  Filter: (expires_at > now())
Execution Time: 12.263 ms
```
When many rows match (20k), Postgres builds a **bitmap** of matching pages from the index, then reads those pages in physical order. That is a middle ground between an index scan (few rows) and a sequential scan (most rows).

**7. `LIKE '%suffix'`: no B-tree can help**
```
Seq Scan on users  Filter: (email ~~ '%5000@example.com')   Execution Time: 33.577 ms
```
A B-tree is sorted from the start of the value, so `'abc%'` can use it but `'%abc'` cannot. Searching by substring needs a trigram (`pg_trgm`) GIN index, or full-text search.

### Reading a plan

| You see | Meaning |
|---|---|
| `Index Scan using X` | Walked index X, then fetched each matching row |
| `Index Only Scan` | Every needed column was in the index, so the table was never touched (fastest) |
| `Bitmap Index Scan` + `Bitmap Heap Scan` | Many matches: collect them from the index, then read pages in order |
| `Seq Scan` | Read the whole table. Fine for small tables; a red flag on a big one with a selective filter |
| `Rows Removed by Filter: N` | Rows read and then thrown away. Large N means a missing or unusable index. |
| `cost=a..b` | The planner's estimate (abstract units); `actual time` is the truth |

## Does it actually help? Optimisation notes

**What already helps the most**
- `getMemberRole` runs on every club route (through `requireClubRole`). It is a primary-key lookup on `(user_id, club_id)`, so the permission check stays constant-time as the platform grows.
- Token and email lookups are unique-index lookups: always one row, always about 0.1 ms.
- The partial pending index makes both the "one pending invite" rule and the pending lists cheap, however much invitation history accumulates.

**Foreign keys are not indexed automatically**
Postgres indexes the *referenced* side (the primary key) but **not** the referencing column. Without an index on `clubs.owner_id`, deleting a user would scan all of `clubs` to apply the `ON DELETE CASCADE`. That is why `clubs_owner_idx` exists, and why `club_members_club_idx` is doubly useful.
`club_invitations.invited_by` has no index of its own. Deleting a user would therefore scan invitations. That is acceptable at our scale, since users are rarely deleted, but it is the first index to add if user deletion becomes common.

**Locking also relies on indexes**
`lockMember` runs `SELECT ... FOR UPDATE` on the club's admin rows. Thanks to `club_members_club_idx`, Postgres reads (and locks) only that club's rows instead of scanning the table.

**Known cleanups**
- **`videos_club_idx` is redundant.** `videos_club_created_idx (club_id, created_at)` already serves `WHERE club_id = ?`. Dropping it saves a write per video insert. Do it in Sprint 4 when `videos` is touched.
- **`videos_status_idx` has low selectivity.** Status has only 4 values, and most videos end up `READY`. A plain index on it is rarely used for `READY`, but it helps when looking for the few `PROCESSING` or `ERROR` rows. A better fit is a partial index, e.g. `ON videos (created_at) WHERE status IN ('UPLOADING', 'PROCESSING')`, which keeps only the in-flight videos a worker or cleanup job cares about.
- **`club_invitations_email_idx`** is used only by queries that don't match the partial index. Keep it if a "my invitations" feature is coming. Otherwise it is 7 MB per 100k rows of write cost for little benefit.

**Ordering + pagination**
`listForUser` and `listPending` sort by `created_at DESC, id DESC` with `LIMIT/OFFSET`. With an index matching the sort, Postgres can stop after `limit` rows instead of sorting everything. At our sizes the sort is cheap. If a list gets big:
- add an index whose column order matches `WHERE` + `ORDER BY` (e.g. `(club_id, created_at DESC)`);
- switch from `OFFSET` (which still reads and discards the skipped rows) to **keyset pagination**: `WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`.

**Covering indexes (not used yet)**
`CREATE INDEX ... ON t (a) INCLUDE (b)` stores extra column `b` in the index so a query reading only `a` and `b` gets an **Index Only Scan**. Worth it only for very hot queries.

## Checking indexes on a running database

```sql
-- every index with its size
\di+ public.*

-- how often each index has been used since stats were reset (idx_scan = 0 → candidate to drop)
select relname as table, indexrelname as index, idx_scan
from pg_stat_user_indexes
order by idx_scan;

-- the plan and real timing of a query
explain analyze select ...;
```

Run them inside the container:
`docker exec -it klyro-postgres-1 psql -U <user> -d klyro`

## Adding an index in this project

1. Declare it in the table's callback in `backend/src/lib/db/schema.ts` (`index(...)`, `uniqueIndex(...)`, optional `.where(sql\`...\`)` for a partial one).
2. `npm run db:generate` to write the migration, then review the SQL.
3. `npm run db:migrate`.
4. Confirm with `EXPLAIN ANALYZE` that the query actually uses it.

On a large production table, a plain `CREATE INDEX` blocks writes while it builds. `CREATE INDEX CONCURRENTLY` avoids that, but cannot run inside a transaction, so it needs a hand-written migration.

## Cheat sheet

- An index helps **reads that filter, join, or sort** on its columns, and slows **every write**.
- A unique index is a **rule** and a **lookup**.
- In a composite index, **order matters**: only leading prefixes are usable.
- A partial index **indexes a subset**, and the query must imply its condition.
- A function on the column (`lower(email)`) or a leading wildcard (`LIKE '%x'`) **bypasses a plain index**.
- Foreign-key columns **are not indexed automatically**.
- Small tables get sequential scans, and that is correct.
- Don't guess: **`EXPLAIN ANALYZE`**.
