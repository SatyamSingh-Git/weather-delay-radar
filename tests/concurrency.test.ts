import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline/run';
import { createEventBus } from '../src/telemetry';
import { createOpenWeatherClient } from '../src/weather/client';
import { ORDERS, cityOf, json, testConfig, testDeps, wait, weatherBody } from './helpers';

const LATENCY_MS = 200;

/** Every city takes the same time, so any serialisation shows up as a multiple of it. */
function slowFetch(): typeof fetch {
  return async (input) => {
    await wait(LATENCY_MS);
    return json(200, weatherBody('Clear', 'clear sky'));
  };
}

async function run(maxConcurrency: number) {
  const config = testConfig({ maxConcurrency });
  const bus = createEventBus();
  const client = createOpenWeatherClient(config, testDeps(slowFetch()));
  return runPipeline({ config, orders: ORDERS, client, bus });
}

describe('the fan-out is genuinely parallel', () => {
  it('dispatches every request on effectively the same tick', async () => {
    const { metrics } = await run(8);
    expect(metrics.dispatchSpreadMs).toBeLessThan(20);
  });

  it('keeps all four requests in flight at once', async () => {
    const { metrics } = await run(8);
    expect(metrics.maxOverlap).toBe(4);
  });

  it('finishes in about one request time, not four', async () => {
    const { metrics } = await run(8);
    expect(metrics.wallMs).toBeLessThan(LATENCY_MS * 2);
    expect(metrics.sequentialMs).toBeGreaterThan(LATENCY_MS * 3);
    expect(metrics.speedup).toBeGreaterThan(2.5);
  });

  it('collapses to serial when the semaphore is turned down to one', async () => {
    const { metrics } = await run(1);
    expect(metrics.maxOverlap).toBe(1);
    expect(metrics.wallMs).toBeGreaterThan(LATENCY_MS * 3);
    expect(metrics.speedup).toBeLessThan(1.5);
  });

  it('caps in-flight requests at the configured limit', async () => {
    const { metrics } = await run(2);
    expect(metrics.maxOverlap).toBe(2);
  });
});

describe('duplicate cities', () => {
  it('collapse into a single upstream request', async () => {
    const seen: string[] = [];
    const config = testConfig();
    const client = createOpenWeatherClient(
      config,
      testDeps(async (input) => {
        seen.push(cityOf(input));
        await wait(50);
        return json(200, weatherBody('Clear'));
      }),
    );

    const orders = [
      { order_id: '1', customer: 'A', city: 'London', status: 'Pending' as const },
      { order_id: '2', customer: 'B', city: 'London', status: 'Pending' as const },
      { order_id: '3', customer: 'C', city: 'london', status: 'Pending' as const },
    ];

    const report = await runPipeline({ config, orders, client, bus: createEventBus() });

    expect(seen).toHaveLength(1);
    expect(report.orders.every((order) => order.weather)).toBe(true);
  });
});
