# 07: Record a load of succeeded runs

**What to build:** An operator runs a load command, separate from the automated suite. It starts many `order` **Runs** with no **Failure injection**. Every run must reach **Succeeded**. The command records how many started, how many succeeded, and how long the run took.

**Blocked by:** 01 Succeed an order run

**Status:** ready-for-agent

- [ ] The load command is not part of the ordinary automated suite.
- [ ] It starts many `order` runs with no failure injection. The implementation chooses how many and how much concurrency.
- [ ] The command fails if any run ends in a state other than **Succeeded**.
- [ ] It records the started count, the succeeded count, and the wall-clock duration.
- [ ] It sets no latency or throughput target.
