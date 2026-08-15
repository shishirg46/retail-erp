// Process-local async mutex (P4).
//
// The last-active-OWNER invariant (D7) cannot be enforced with Postgres row
// locks alone: the guard reads the active-OWNER count and then triggers a write
// that Better Auth performs in its own transaction (setRole/ban/removeUser),
// which we cannot join. Two concurrent demotions could both observe N=2 and
// both proceed, leaving zero active OWNERs.
//
// A process-local mutex serializes the guard-and-mutate critical section:
// whichever operation runs first commits its change, and the second re-checks
// the count against the committed state. This is correct for the project's
// single-process deployment (one Next.js server). A multi-process deployment
// would need a distributed lock (e.g. Redis) — a documented limitation.

export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
