import { describe, expect, it } from 'vitest';
import { createSemaphore } from '../src/http/limiter';

describe('the semaphore', () => {
  /**
   * Callers arriving at staggered microtask depths land some of them inside the window
   * between a finishing task releasing its permit and the woken waiter taking it. An
   * implementation that decrements and then lets the waiter re-increment runs at twice
   * the limit here; handing the permit over directly holds the line.
   */
  it.each([1, 2, 3])('never exceeds a limit of %i under interleaved arrivals', async (limit) => {
    const withPermit = createSemaphore(limit);
    let active = 0;
    let peak = 0;

    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
    };

    const calls = Array.from({ length: 40 }, () => withPermit(task));

    for (let depth = 0; depth < 40; depth++) {
      let queued = Promise.resolve();
      for (let step = 0; step < depth; step++) queued = queued.then(() => {});
      calls.push(queued.then(() => withPermit(task)));
    }

    await Promise.all(calls);

    expect(peak).toBe(limit);
    expect(active).toBe(0);
  });

  it('releases the permit when the task throws', async () => {
    const withPermit = createSemaphore(1);

    await expect(withPermit(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    // A leaked permit would deadlock this second call rather than fail it.
    await expect(withPermit(async () => 'ok')).resolves.toBe('ok');
  });

  it('runs everything when the limit exceeds the number of callers', async () => {
    const withPermit = createSemaphore(8);
    const results = await Promise.all([1, 2, 3].map((n) => withPermit(async () => n * 2)));
    expect(results).toEqual([2, 4, 6]);
  });
});
