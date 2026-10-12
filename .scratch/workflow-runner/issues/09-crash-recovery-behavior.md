# Crash recovery behavior

Type: grilling
Status: open
Blocked by:

## Question

Which crash-recovery behavior should the spec adopt for a step whose process dies mid-attempt?

PostgreSQL 18, documented in [PostgreSQL claim and crash facts](../research/postgresql-claim-and-crash-facts.md), leaves a different failure for each claim mechanism. A new session does not inherit the dead session's locks.

- `SELECT … FOR UPDATE SKIP LOCKED`, held in the open transaction: session death rolls the transaction back and releases the row lock. The new session can lock the row again and cannot see that an attempt was in flight. Failure left behind: an invisible in-flight attempt.
- A session advisory lock: released at session end, including an ungraceful disconnect, even if it survived earlier commits. It is not a column on the row, and `SKIP LOCKED` does not observe it. The new session cannot see that an attempt was in flight. Failure left behind: an invisible in-flight attempt.
- An ordinary column update that has already committed: the column stays visible and PostgreSQL does not clear it when the session dies. The new session can see that an attempt was in flight. Failure left behind: a stuck claim. An ordinary column update that is still uncommitted is discarded with the open transaction and leaves an invisible in-flight attempt instead. An autocommit `UPDATE` can still commit if the backend finishes the statement before it notices the disconnect.

The spec has to pick which failure it owns: reclaim the row with no record that an attempt was in flight, or persist a committed in-flight mark and define how a later session recognizes and releases that stuck claim.

## Comments
