import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from '../src/http/fetchWithRetry';
import { json, testDeps, weatherBody } from './helpers';

const POLICY = { maxAttempts: 3, timeoutMs: 200, backoffBaseMs: 10, backoffCapMs: 40 };
const URL = 'https://api.example.test/data/2.5/weather?q=London&appid=k';

describe('retry policy', () => {
  it('recovers from a transient upstream failure', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(503, { message: 'unavailable' }))
      .mockResolvedValueOnce(json(200, weatherBody('Rain')));

    const result = await fetchWithRetry(URL, POLICY, testDeps(fetchImpl));

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404, because the city will not appear on the second try', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(404, { message: 'city not found' }));

    const result = await fetchWithRetry(URL, POLICY, testDeps(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('CityNotFound');
  });

  it('does not retry a rejected API key', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(401, { message: 'Invalid API key' }));

    const result = await fetchWithRetry(URL, POLICY, testDeps(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (!result.ok) {
      expect(result.error.kind).toBe('AuthError');
      expect(result.error.fatal).toBe(true);
    }
  });

  it('gives up after maxAttempts and reports how many it made', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(500, { message: 'boom' }));

    const result = await fetchWithRetry(URL, POLICY, testDeps(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    if (!result.ok) expect(result.error.attempts).toBe(3);
  });

  it('waits as long as Retry-After asks rather than guessing', async () => {
    const delays: number[] = [];
    const deps = {
      ...testDeps(
        vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(json(429, { message: 'slow down' }, { 'retry-after': '2' }))
          .mockResolvedValueOnce(json(200, weatherBody('Clear'))),
      ),
      sleep: async (ms: number) => {
        delays.push(ms);
      },
    };

    const result = await fetchWithRetry(URL, POLICY, deps);

    expect(result.ok).toBe(true);
    expect(delays).toEqual([2000]);
  });

  it('keeps backoff under the configured cap', async () => {
    const delays: number[] = [];
    const deps = {
      ...testDeps(vi.fn<typeof fetch>().mockResolvedValue(json(500, { message: 'boom' }))),
      sleep: async (ms: number) => {
        delays.push(ms);
      },
    };

    await fetchWithRetry(URL, { ...POLICY, maxAttempts: 5 }, deps);

    // random() is pinned to 1, so these are the ceilings: 10, 20, 40, capped at 40.
    expect(delays).toEqual([10, 20, 40, 40]);
  });

  it('abandons a request that never answers', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')));
      });

    const result = await fetchWithRetry(URL, { ...POLICY, maxAttempts: 1, timeoutMs: 50 }, testDeps(fetchImpl));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('Timeout');
  });
});
