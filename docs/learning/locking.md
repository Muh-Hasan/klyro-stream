# Locking and concurrency

How KlyroStream stays correct when two requests touch the same data at the same time. Every section points at real code. See also [transactions.md](transactions.md) (the overview map), [indexes.md](indexes.md) and [uploads.md](uploads.md).

## The problem: check-then-act

Most bugs in this area have the same shape:

```
1. read something        (is there another admin? is the invite still pending?)
2. decide                (yes → allowed)
3. write                 (demote, accept)
```

If two requests run steps 1–3 interleaved, both read the *old* state, both decide "allowed", and both write. Each request on its own was correct; together they break a rule.

Example: a club has two admins, A and B. A demotes B while B demotes A.

```
request 1 (A demotes B)        request 2 (B demotes A)
count admins → 2               count admins → 2
2 > 1, allowed                 2 > 1, allowed
UPDATE B → viewer              UPDATE A → viewer
```

The club now has zero admins, and nobody can ever manage it again. A normal transaction does not prevent this (see isolation below).

## Tools for fixing it

| Tool | Idea | Where in KlyroStream |
|---|---|---|
| **Pessimistic lock** (`SELECT … FOR UPDATE`) | Lock the rows you read so nobody else can change them until you commit | Member role change / removal |
| **Conditional write** (compare-and-set) | Put the check *inside* the `UPDATE … WHERE`, and look at how many rows changed | Accept / reject / revoke / expire invitation |
| **Unique index** | Let the database reject the second insert, then map the error to 409 | Register, Google sign-in, invite, register-from-invite |
| **Atomic SQL expression** | `SET x = x + 1` instead of read-then-write in Node | `token_version` bump |
| **Transaction** | Several writes succeed or fail together | Club creation, invite acceptance, member changes |
| **Atomic Redis command** | One command that checks and writes | Refresh-token reuse (`SET NX`), reset token (`GETDEL`), rate limits |

**Pessimistic** means you assume a conflict will happen and lock first. **Optimistic** means you assume it won't, write conditionally, and detect the conflict afterwards (0 rows updated, or a unique violation). Most of KlyroStream is optimistic; the last-admin rule is the one place that needs a real lock.

## Background: transactions and isolation

Postgres's default isolation level is **READ COMMITTED**, and that is what `db.transaction()` uses here.

- Each *statement* sees data committed before that statement started.
- A transaction does **not** freeze the world. Two transactions can both read "2 admins" and both proceed. A transaction gives you all-or-nothing writes, not protection from other writers.
- Writes take **row locks** automatically. An `UPDATE` or `DELETE` on a row blocks any other `UPDATE`/`DELETE`/`FOR UPDATE` on that same row until the first transaction commits or rolls back.
- When a blocked statement gets the lock, Postgres **re-checks its `WHERE` against the new version of the row** (called EvalPlanQual). If the row no longer matches, it is skipped. This one rule is what makes both `FOR UPDATE` and conditional writes work.

Locks are always released at `COMMIT` or `ROLLBACK`, never earlier. Keep transactions short: no HTTP calls, emails, or password hashing inside them. That's why `hashPassword` runs *before* `acceptForNewUser` opens its transaction, and why mail is sent after the write.

`Tx` in `backend/src/lib/db/client.ts` is the transaction handle type. Repository helpers that must run inside someone else's transaction (`lockMember`, `claim`) take `tx` as their first argument so they use the same connection and the same locks.

## 1. Pessimistic lock: the last-admin rule

**Rule:** a club must always keep at least one admin (`409 LAST_ADMIN`).
**Code:** `lockMember` in `backend/src/repositories/member.repository.ts`, used by `changeRole` and `remove`.

```ts
const lockMember = async (tx: Tx, clubId: string, userId: string) => {
  const admins = await tx
    .select({ userId: clubMembers.userId })
    .from(clubMembers)
    .where(and(eq(clubMembers.clubId, clubId), eq(clubMembers.role, 'admin')))
    .orderBy(asc(clubMembers.userId))
    .for('update');

  const [member] = await tx
    .select({ role: clubMembers.role })
    .from(clubMembers)
    .where(isMember(clubId, userId))
    .for('update');
  if (!member) throw new NotFoundError('Member not found', 'MEMBER_NOT_FOUND');

  return { role: member.role, isLastAdmin: member.role === 'admin' && admins.length === 1 };
};
```

SQL it produces:

```sql
BEGIN;
SELECT user_id FROM club_members
 WHERE club_id = $1 AND role = 'admin'
 ORDER BY user_id
 FOR UPDATE;
SELECT role FROM club_members WHERE club_id = $1 AND user_id = $2 FOR UPDATE;
UPDATE club_members SET role = $3 WHERE club_id = $1 AND user_id = $2;
COMMIT;
```

### Why lock *all* admin rows, not just the target

The decision ("am I the last admin?") depends on the **set** of admins, so the set is what must stay stable. Replaying the race from above:

```
request 1 (A demotes B)                 request 2 (B demotes A)
BEGIN                                   BEGIN
lock admin rows {A, B}  ✔
                                        lock admin rows {A, B}  … waits for request 1
target B is admin, 2 admins → allowed
UPDATE B → viewer
COMMIT  (locks released)
                                        gets the locks; re-checks WHERE role='admin'
                                        B no longer matches → admins = {A}
                                        target A is admin, 1 admin → LAST_ADMIN (409)
                                        ROLLBACK
```

The second request is forced to wait and then sees the truth. Exactly one demotion wins.

### Why `ORDER BY user_id`

Two transactions that lock the same rows in **different orders** can deadlock: 1 holds A and wants B, 2 holds B and wants A. Postgres detects this after `deadlock_timeout` (1 s) and kills one with error `40P01`. Locking in a fixed order (by `user_id`) means everyone queues on the first row, so a cycle can't form.

### Why lock the target member too

If the target is a viewer or club_owner, they aren't in the admin set, so the first query didn't lock them. The second `FOR UPDATE` serialises two requests acting on the same member (e.g. "remove C" and "make C admin"), and gives a clean `MEMBER_NOT_FOUND` if the row was deleted while we waited. If the target is an admin, it's already locked; locking a row you already hold is free.

### Known trade-off: a safe false positive

Under READ COMMITTED a row that *becomes* an admin after our statement started isn't added to our result. So:

```
request 1 (promote C to admin)       request 2 (sole admin A demotes self)
lock admins {A}, lock C
UPDATE C → admin, COMMIT
                                     was waiting on A; gets it; result is still {A}
                                     → LAST_ADMIN (409)
```

Request 2 is rejected even though C is now an admin. That errs on the safe side (no rule is broken), and retrying succeeds. Avoiding it would need `SERIALIZABLE` isolation plus retry logic, which isn't worth it here.

### The club creator check

`assertNotCreator` in `backend/src/services/member.service.ts` reads `clubs.owner_id` without a lock. That's fine today because `owner_id` never changes. When **transfer ownership** (backlog) lands, it must lock the club row (`SELECT … FROM clubs WHERE id = $1 FOR UPDATE`) in the same transaction as the member lock, so a transfer and a removal can't interleave.

## 2. Conditional writes: invitations

**Rule:** an invitation is used at most once (accepted *or* rejected *or* revoked *or* expired).
**Code:** `claim`, `revoke`, `markExpired` in `backend/src/repositories/invitation.repository.ts`.

```ts
const claim = async (tx: Tx, id: string, status: 'accepted' | 'rejected') => {
  const [claimed] = await tx
    .update(clubInvitations)
    .set({ status, respondedAt: new Date() })
    .where(
      and(
        eq(clubInvitations.id, id),
        eq(clubInvitations.status, 'pending'),
        gt(clubInvitations.expiresAt, new Date()),
      ),
    )
    .returning({ clubId: clubInvitations.clubId, role: clubInvitations.role });
  return claimed;
};
```

```sql
UPDATE club_invitations
   SET status = 'accepted', responded_at = now()
 WHERE id = $1 AND status = 'pending' AND expires_at > now()
RETURNING club_id, role;
```

The check (`status = 'pending'`) and the write happen in **one statement**. If two people click "Accept" and "Decline" at the same moment:

```
request 1 (accept)                         request 2 (reject)
UPDATE … WHERE status='pending' → 1 row
                                           UPDATE … same row → waits on row lock
COMMIT
                                           re-checks WHERE: status is 'accepted'
                                           → 0 rows → reject returns false → 400
```

No explicit lock, no read beforehand. "How many rows did I change?" *is* the answer.

The service still calls `findUsable` first. That read is for a **friendly error** (and for the email-mismatch check); it is not the guard. The conditional `UPDATE` is the guard, so a request that passes `findUsable` and then loses the race still fails cleanly.

`revoke` (`WHERE id = $1 AND club_id = $2 AND status = 'pending'`) and `markExpired` (`WHERE id = $1 AND status = 'pending'`) use the same pattern, so "revoke" can't overwrite an invitation that was accepted a millisecond earlier.

### Claim + membership in one transaction

```ts
export const acceptForUser = (id: string, userId: string) =>
  db.transaction(async (tx) => {
    const claimed = await claim(tx, id, 'accepted');
    if (!claimed) return false;
    await tx.insert(clubMembers).values({ ... }).onConflictDoNothing();
    return true;
  });
```

- If the membership insert fails, the claim rolls back and the invitation is still pending. Nothing is half-done.
- `onConflictDoNothing()` covers "already a member" (the `club_members` primary key is `(user_id, club_id)`) without an error.

`acceptForNewUser` does claim → insert user → insert membership in one transaction. If another request registered the same email in between, the user insert hits `users_email_uniq`, the **whole transaction rolls back (including the claim)**, and the service maps it to `ACCOUNT_EXISTS`. The invitation stays usable for logging in and accepting.

## 3. Unique indexes as the final guard

**Code:** `isUniqueViolation` in `backend/src/utils/db-errors.ts` (Postgres error `23505`).

Pattern used in `registerUser`, `signInWithGoogle`, `inviteMember` and `registerFromInvitation`:

```ts
if (await userRepo.findByEmail(email)) throw new ConflictError(...);   // fast path, friendly
try {
  user = await userRepo.create({ ... });
} catch (err) {
  if (isUniqueViolation(err)) throw new ConflictError(...);           // the race
  throw err;
}
```

The pre-check is a nicety, not a guarantee. Two requests can both pass it. The unique index can't be fooled: when two transactions insert the same key, the second **waits** for the first to commit, then fails with `23505` (or succeeds if the first rolled back).

| Index | Protects |
|---|---|
| `users_email_uniq` | One account per email (register, Google, register-from-invite) |
| `users_provider_uniq (provider, provider_id)` | One account per Google identity |
| `club_invitations_pending_uniq (club_id, email) WHERE status='pending'` | At most one *pending* invite per email per club |
| `club_invitations_token_uniq` | Token hashes never collide |
| `club_members` PK `(user_id, club_id)` | A user is a member of a club at most once |

The partial index is the neat one: old accepted/revoked invites don't count, so re-inviting someone later works, but two simultaneous invites to the same person can't both be pending. Details are in [indexes.md](indexes.md#partial-indexes).

`signInWithGoogle` goes one step further: on `23505` it re-reads (`findByProvider`, then `findByEmail`) and, if the winner was the same Google account, returns that user instead of an error. Two tabs finishing the same Google login at once both succeed.

## 4. Atomic SQL expressions

**Code:** `bumpTokenVersion` and `updatePassword` in `backend/src/repositories/user.repository.ts`.

```ts
.set({ tokenVersion: sql`${users.tokenVersion} + 1` })
```

```sql
UPDATE users SET token_version = token_version + 1 WHERE id = $1;
```

Wrong way: read `tokenVersion` into Node, add 1, write it back. Two concurrent "log out everywhere" calls would both read 3 and both write 4: one bump lost. With `token_version + 1` in SQL, the second update waits on the row lock and then adds 1 to the *new* value. This is the right pattern for every counter, and Sprint 9's `download_quotas.used_count` will use it (with a `WHERE used_count < quota_limit` condition, like the invitation claim).

## 5. Transactions for all-or-nothing

`createWithOwner` in `backend/src/repositories/club.repository.ts` inserts the club, the creator's admin membership and the download quota row in one transaction. There's no race to guard against here (the club is brand new), but without the transaction a crash between inserts would leave a club with no admin, which the last-admin rule could then never fix.

## 6. Redis: atomic single commands

Redis runs one command at a time, so a command that checks and writes in one step is race-free. The rule is the same as with SQL: **never GET, decide in Node, then SET**.

### Refresh-token rotation: `SET NX`

**Code:** `backend/src/repositories/token-blacklist.repository.ts`, used by `refreshSession`.

```ts
export const consume = async (jti: string, exp: number) =>
  (await redis.set(key(jti), '1', 'EX', ttlFor(exp), 'NX')) === 'OK';
```

`SET key 1 EX ttl NX` writes only if the key does **not** exist and returns `OK`, otherwise `null`. Each refresh token has a unique `jti`. Two requests using the same refresh token:

```
request 1: SET blacklist:token:abc NX → OK   → new tokens issued
request 2: SET blacklist:token:abc NX → null → TOKEN_REUSED
```

A reused token suggests it was stolen, so the losing request also bumps `token_version`, which invalidates every refresh token for that user (`SESSION_REVOKED` on their next refresh). The TTL equals the token's remaining lifetime, so keys clean themselves up.

### Password reset: `GETDEL`

**Code:** `backend/src/repositories/password-reset.repository.ts`.

```ts
export const consume = async (tokenHash: string) => redis.getdel(key(tokenHash));
```

`GETDEL` returns the value and deletes the key in one step. Two concurrent resets with the same link: only one gets the user id back; the other gets `null` → `INVALID_RESET_TOKEN`. With a separate `GET` then `DEL`, both could read the id before either deleted it.

### Rate limits

**Code:** `backend/src/middleware/rate-limit.middleware.ts` (`rate-limit-redis`, keys `rl:{name}:{ip}`).

The store increments the counter and sets its expiry in a single Lua script, which Redis runs atomically. Because the counter lives in Redis, the limit holds across several API processes, not just one. `passOnStoreError: true` means that if Redis is down, requests are allowed rather than blocked (fail open).

## What is deliberately *not* locked

- **`requireClubRole`** reads the caller's role, then the handler acts. If an admin is demoted while their request is in flight, that one request still completes with admin rights. The window is milliseconds and the next request is checked again. Locking the caller's membership row on every request would serialise all writes in a club for no real gain.
- **Read endpoints** (lists, previews) never lock. Under READ COMMITTED a reader never blocks a writer and a writer never blocks a reader.
- **Club rename** is last-write-wins. Two admins renaming at once: one name wins, nothing is corrupted.

## 7. Video status: conditional write + a lock across an external call

`videoRepo.transition(id, from, to)` (`repositories/video.repository.ts`) is the only way a video's status changes. It rejects arrows that aren't in the `TRANSITIONS` table (a bug, so it throws), then uses the conditional-write pattern:

```sql
UPDATE videos SET status = 'PROCESSING' WHERE id = $1 AND status = 'UPLOADING' RETURNING *;
```

0 rows means the video wasn't in the expected state, and the service turns that into a 409.

That protects the row, but complete and abort each pair the transition with an **S3 call** (`CompleteMultipartUpload` / `AbortMultipartUpload`), and the conditional write can't protect that pair. Without more, this can happen:

```
complete: S3 stitches the object ─────────────┐
abort:                     wins the row → ERROR│
complete:                       transition → 0 rows
result:   an object in the bucket for a video marked ERROR
```

So both run inside `videoRepo.withUploadLock(id, fn)`:

```sql
BEGIN;
SELECT * FROM videos WHERE id = $1 AND status = 'UPLOADING' FOR UPDATE;  -- the other request waits here
-- S3 call
UPDATE videos SET status = … WHERE id = $1 AND status = 'UPLOADING';
COMMIT;
```

The second request waits on the lock, then re-reads the row: it's no longer `UPLOADING`, so it gets 0 rows → 409. Measured: five complete-vs-abort races left 5 `PROCESSING` rows, 5 objects and 0 open sessions.

**Holding a lock during a network call** is normally avoided (it holds a DB connection and blocks anyone else waiting on that row). It's acceptable here because the lock covers one row, only that video's uploader contends for it, and the S3 call is short. If storage hung, the request would hold one pooled connection until it timed out. That's the trade-off.

## Try it yourself: watch a lock wait

Open two `psql` sessions:

```bash
docker exec -it klyro-postgres-1 psql -U klyro -d klyro
```

Session 1:

```sql
BEGIN;
SELECT user_id FROM club_members
 WHERE club_id = '<club-id>' AND role = 'admin'
 ORDER BY user_id FOR UPDATE;
```

Session 2 (hangs, because it wants the same rows):

```sql
BEGIN;
SELECT user_id FROM club_members
 WHERE club_id = '<club-id>' AND role = 'admin'
 ORDER BY user_id FOR UPDATE;
```

Now call `PATCH /clubs/:clubId/members/:userId` from Bruno: it hangs too. Type `COMMIT;` in session 1 and both continue.

See who is waiting on whom (from a third session):

```sql
SELECT pid, state, wait_event_type, left(query, 60) AS query,
       pg_blocking_pids(pid) AS blocked_by
  FROM pg_stat_activity
 WHERE datname = 'klyro' AND pid <> pg_backend_pid();
```

To see a deadlock, lock two different rows in opposite orders in the two sessions (`SELECT … WHERE user_id = 'A' FOR UPDATE`, then `'B'`, and the reverse). After about 1 s one session gets `ERROR: deadlock detected`. That's what `ORDER BY user_id` in `lockMember` prevents.

## Cheat sheet

| Situation | Use |
|---|---|
| Rule depends on a **set** of rows (last admin, quota across rows) | `SELECT … FOR UPDATE` on the set, in a fixed order, inside a transaction |
| Single row moving between states (invite, video status) | `UPDATE … WHERE state = expected RETURNING`; 0 rows = lost the race |
| "Must be unique" | Unique (or partial unique) index + catch `23505` → 409 |
| Counter | `SET n = n + 1` in SQL, never read-add-write in Node |
| Several writes that belong together | `db.transaction`, pass `tx` to helpers |
| One-time token in Redis | `GETDEL`, or `SET NX` |
| Locking several rows | Always the same order, to avoid deadlocks |
| Inside a transaction | No HTTP, email or bcrypt; keep it short |
| Pre-check before insert/update | Fine for a friendly message, never the real guard |
