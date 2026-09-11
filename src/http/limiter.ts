/**
 * Bounded concurrency. With four orders and a limit of eight this never blocks and
 * every task dispatches on the same tick; the same code path handles an order book of
 * ten thousand without opening ten thousand sockets.
 */
export function createSemaphore(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function withPermit<T>(fn: () => Promise<T>): Promise<T> {
    // The permit is handed straight from the finishing task to the next waiter rather
    // than being dropped and re-taken. Releasing first would leave a microtask-sized
    // window in which a fresh caller sees a free slot that is already spoken for, and
    // the limit would be exceeded by however many callers arrived in that window.
    if (active >= limit) await new Promise<void>((release) => waiting.push(release));
    else active += 1;

    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

/**
 * Two orders shipping to the same city are one HTTP request, not two. The sample data
 * has four distinct cities so this never fires there, but it is the difference between
 * a linear and a constant number of calls on a real order book.
 */
export function createDeduper<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return function dedupe(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const pending = fn().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  };
}
