# PostgreSQL claim and crash facts

PostgreSQL 18 documentation, read for this note. A later session is a new backend. It does not inherit locks from the session that died with the Node process.

This note records what each claim mechanism does when that session dies mid-attempt. It does not choose a recovery policy.

## Session death rolls back an open transaction

For either normal or abnormal termination, any open transaction is rolled back, not committed. Abnormal termination includes a core dump or a lost connection. If the frontend disconnects while a non-`SELECT` query is still being processed, the backend will probably finish that query before it notices the disconnect. If that query is outside a `BEGIN` … `COMMIT` block, its results might be committed before the disconnection is recognized.

Source: [54.2.9. Termination](https://www.postgresql.org/docs/18/protocol-flow.html), PostgreSQL 18.

`COMMIT` makes every change from the transaction visible to others and durable if a crash occurs. `ROLLBACK` discards all updates made by the transaction.

Sources: [`COMMIT`](https://www.postgresql.org/docs/18/sql-commit.html), [`ROLLBACK`](https://www.postgresql.org/docs/18/sql-rollback.html), PostgreSQL 18.

## Comparison

| Claim | Released when the session dies mid-attempt? | Can a new session see that the attempt was in flight? | Failure left behind |
| --- | --- | --- | --- |
| `SELECT … FOR UPDATE SKIP LOCKED` held in the open transaction | Yes. The open transaction rolls back, and the row lock ends with the transaction. | No. The lock is gone, and the statement does not leave a committed column. | Invisible in-flight attempt |
| Session advisory lock | Yes. Session-level advisory locks are released at session end, including an ungraceful disconnect. | No. The lock lived in the lock manager, not in the row. | Invisible in-flight attempt |
| Ordinary column update, already committed | No. Commit is durable. Session death does not clear the column. | Yes. The new session reads the committed column. | Stuck claim |
| Ordinary column update, still uncommitted | Yes. Rollback discards it with the open transaction. | No. The discarded update is not visible. | Invisible in-flight attempt |

## `SELECT … FOR UPDATE SKIP LOCKED`

`FOR UPDATE` locks the retrieved rows so other transactions cannot lock, modify, or delete them until the current transaction ends. Row-level locks are released at transaction end or during savepoint rollback. They do not affect data querying; they block only writers and lockers of the same row. `SKIP LOCKED` skips rows that cannot be locked immediately. It applies only to those row locks. It is documented for a queue-like table with multiple consumers, and the docs note that skipping locked rows provides an inconsistent view.

Sources: [13.3.2. Row-Level Locks](https://www.postgresql.org/docs/18/explicit-locking.html), [The Locking Clause](https://www.postgresql.org/docs/18/sql-select.html), PostgreSQL 18.

The lock has to be held inside a transaction that stays open for the attempt. Outside a transaction block, a lock is held only until the statement completes. `SELECT FOR UPDATE` does modify the selected rows to mark them locked, and that can cause a disk write, but that mark belongs to the locking transaction. Rollback discards the transaction's updates, and the lock is released at transaction end. After the dead session's transaction has rolled back, `pg_locks` no longer lists it: that view shows currently outstanding locks.

Sources: [`LOCK`](https://www.postgresql.org/docs/18/sql-lock.html) (lock duration outside a transaction block), [13.3.2](https://www.postgresql.org/docs/18/explicit-locking.html) (the disk write and release at transaction end), [13.3 intro](https://www.postgresql.org/docs/18/explicit-locking.html) (`pg_locks` shows currently outstanding locks), [`ROLLBACK`](https://www.postgresql.org/docs/18/sql-rollback.html).

So the claim is released. A new session running the same `SELECT … FOR UPDATE SKIP LOCKED` can lock the row. Nothing committed tells it that an attempt was already in flight. The failure left behind is an invisible in-flight attempt.

## Session advisory locks

A session-level advisory lock is held until it is explicitly released or the session ends. It does not honor transaction semantics: a lock taken in a transaction that later rolls back is still held, and an unlock stays effective even if the calling transaction later fails. `pg_advisory_unlock_all()` is implicitly invoked at session end, even if the client disconnects ungracefully. The server cleans advisory locks up at the end of the session. While held, they are listed in `pg_locks`. They are stored in a shared-memory lock pool, not as a row update. The database does not enforce them; the application has to cooperate.

Sources: [13.3.5. Advisory Locks](https://www.postgresql.org/docs/18/explicit-locking.html), [9.28.10. Advisory Lock Functions](https://www.postgresql.org/docs/18/functions-admin.html), PostgreSQL 18.

The same section contrasts this with a flag stored in a table, which can mean the same thing to the application but is not cleaned up at session end.

When the session dies, the advisory claim is released. A new session does not see it in `pg_locks` and does not see it on the row. `SKIP LOCKED` will not skip that row because of an advisory lock: `SKIP LOCKED` applies only to row-level locks. The failure left behind is an invisible in-flight attempt.

Transaction-level advisory locks (`pg_advisory_xact_lock`) are a different mechanism. They release at transaction end, like a row lock, and there is no manual unlock. They are not the session advisory lock this comparison is about.

## An ordinary column update

An `UPDATE` changes stored columns. Those changes follow commit and rollback, not the life of the session.

If the claiming `UPDATE` is still in the open transaction when the session dies, rollback discards it. The row lock taken by that `UPDATE` is released at the same time. A new session sees the pre-claim column values. The failure left behind is an invisible in-flight attempt, the same shape as the two locks.

If the claiming `UPDATE` has been committed, the column stays visible and durable. Session death does not undo a commit, and PostgreSQL does not tie that committed column to the backend that wrote it, so nothing in the server clears it when the client disappears. The row lock from the `UPDATE` is already gone: locks end at transaction end, which was the commit. A new session can read the column and see that an attempt was in flight. It cannot take the row back by lock release alone, because there is no lock left to release. The failure left behind is a stuck claim.

The termination caveat sits on the boundary. An autocommit `UPDATE` is outside a `BEGIN` … `COMMIT` block. If the process dies while that statement is still running, the backend may finish it and commit it before noticing the disconnect. The client can die without having observed success, and the column can still be stuck.

Sources: [54.2.9. Termination](https://www.postgresql.org/docs/18/protocol-flow.html), [`COMMIT`](https://www.postgresql.org/docs/18/sql-commit.html), [`ROLLBACK`](https://www.postgresql.org/docs/18/sql-rollback.html), [13.3.2](https://www.postgresql.org/docs/18/explicit-locking.html) (`UPDATE` acquires a row lock that ends with the transaction), [13.3.5](https://www.postgresql.org/docs/18/explicit-locking.html) (a table flag is not cleaned up at session end).

## What these facts do not decide

PostgreSQL will either forget the attempt (row lock, session advisory lock, or an uncommitted column update) or keep a committed column that no dead session will clear. Which of those outcomes the runner should own is a product choice, not a fact from these pages.
