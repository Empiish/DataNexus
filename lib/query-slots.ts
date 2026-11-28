// Per-app concurrency gate for POST /api/v1/query (2026-11-28).
//
// The query role's CONNECTION LIMIT (lib/query-roles.ts) is the hard cap that
// Postgres enforces, so one key cannot take the cluster's connections. Without
// a gate, a burst larger than the cap failed at once: Postgres refused the
// extra logins (53300) and the route answered 429. CourtLibrary sends bursts
// of 45-70 queries, so about half of them failed (2026-11-23 to 11-28).
//
// The gate lets at most `limit` requests per app hold a connection and queues
// the rest in arrival order for up to `waitMs`. DataNexus runs as one process
// (systemd), so an in-process gate is enough; the role limit stays the
// backstop if more processes ever run. The queue is bounded (`maxQueue`) so a
// single key cannot pile up unbounded waiting requests.

export class QuerySlotTimeoutError extends Error {}
export class QuerySlotQueueFullError extends Error {}

type Waiter = { grant: () => void; timer: ReturnType<typeof setTimeout> };
type Gate = { active: number; waiters: Waiter[] };

const gates = new Map<string, Gate>();

/**
 * Wait for one of `limit` slots for `key` (the app schema). Resolves with a
 * release function; call it exactly once when the connection is closed (extra
 * calls are ignored). Rejects with QuerySlotQueueFullError when `maxQueue`
 * requests are already waiting, or QuerySlotTimeoutError after `waitMs`.
 */
export function acquireQuerySlot(key: string, limit: number, waitMs: number, maxQueue: number): Promise<() => void> {
  let gate = gates.get(key);
  if (!gate) {
    gate = { active: 0, waiters: [] };
    gates.set(key, gate);
  }
  const g = gate;

  const makeRelease = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = g.waiters.shift();
      if (next) {
        // Hand this slot straight to the next waiter: `active` stays the same.
        clearTimeout(next.timer);
        next.grant();
        return;
      }
      g.active -= 1;
      if (g.active <= 0 && g.waiters.length === 0) gates.delete(key);
    };
  };

  if (g.active < limit) {
    g.active += 1;
    return Promise.resolve(makeRelease());
  }
  if (g.waiters.length >= maxQueue) {
    return Promise.reject(new QuerySlotQueueFullError(`${maxQueue} queries already waiting for ${key}`));
  }
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      grant: () => resolve(makeRelease()),
      timer: setTimeout(() => {
        const i = g.waiters.indexOf(waiter);
        if (i >= 0) g.waiters.splice(i, 1);
        reject(new QuerySlotTimeoutError(`no free query slot for ${key} within ${waitMs} ms`));
      }, waitMs),
    };
    g.waiters.push(waiter);
  });
}

/** Current state of one gate (tests and diagnostics; no tenant data). */
export function querySlotState(key: string): { active: number; waiting: number } {
  const g = gates.get(key);
  return { active: g?.active ?? 0, waiting: g?.waiters.length ?? 0 };
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** How long a query may wait for a free slot (DATANEXUS_QUERY_QUEUE_WAIT_MS, default 15 s). */
export function querySlotWaitMs(): number {
  return intEnv('DATANEXUS_QUERY_QUEUE_WAIT_MS', 15_000, 1_000, 60_000);
}

/** How many queries per app may wait at once (DATANEXUS_QUERY_QUEUE_MAX, default 500). */
export function querySlotMaxQueue(): number {
  return intEnv('DATANEXUS_QUERY_QUEUE_MAX', 500, 1, 5_000);
}
