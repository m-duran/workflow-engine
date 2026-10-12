# PostgreSQL claim and crash facts

Type: research
Status: resolved
Blocked by:

## Question

A single Node process uses PostgreSQL as both the store for a **Run** and the queue of due work. There is no second queue.

What does PostgreSQL actually guarantee if that process claims a due row and then dies mid-**Attempt**? Compare the documented behavior of `SELECT … FOR UPDATE SKIP LOCKED`, session advisory locks, and a claim that is only an ordinary column update. For each one: when the session dies, is the claim released, and can a new session of the same process see that the attempt was in flight?

Report the facts and the failure each mechanism leaves behind (lost claim, stuck claim, invisible in-flight attempt). Do not choose the recovery policy. That choice stays in the map's Not yet specified section until these facts exist.

Primary sources only: PostgreSQL documentation for the version you cite.

## Answer

PostgreSQL 18 releases a `SELECT … FOR UPDATE SKIP LOCKED` row lock and a session advisory lock when the claiming session dies. A new session cannot see that the attempt was in flight: both leave an invisible in-flight attempt. A committed ordinary column update is not released and stays visible, which leaves a stuck claim. An uncommitted column update is rolled back with the open transaction and leaves the same invisible attempt as the locks. The recovery policy is not chosen here; that choice is [Crash recovery behavior](09-crash-recovery-behavior.md).

Findings: `research/postgresql-claim-and-crash-facts` (`.scratch/workflow-runner/research/postgresql-claim-and-crash-facts.md`). Not merged.

## Comments
