import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline/run';
import { createEventBus, type RunEvent } from '../src/telemetry';
import { createOpenWeatherClient } from '../src/weather/client';
import { createMockFetch } from '../src/weather/mock';
import { ORDERS, cityOf, json, testConfig, testDeps, weatherBody } from './helpers';

describe('one bad city does not take the run down', () => {
  it('processes the other three and reports the failure', async () => {
    const config = testConfig();
    const client = createOpenWeatherClient(config, testDeps(createMockFetch()));

    const report = await runPipeline({ config, orders: ORDERS, client, bus: createEventBus() });

    expect(report.orders).toHaveLength(4);
    expect(report.metrics.failed).toBe(1);
    expect(report.metrics.delayed).toBe(2);
    expect(report.metrics.onTime).toBe(1);

    const invalid = report.orders.find((order) => order.order_id === '1004');
    expect(invalid?.error?.kind).toBe('CityNotFound');
    expect(invalid?.status).toBe('Pending');
    expect(invalid?.needs_review).toBe(true);

    // Nothing fatal happened, so the run is a success that contains a failure.
    expect(report.aborted).toBeUndefined();
  });

  it('emits a failure event rather than throwing', async () => {
    const config = testConfig();
    const bus = createEventBus();
    const events: RunEvent[] = [];
    bus.subscribe((event) => events.push(event));

    const client = createOpenWeatherClient(config, testDeps(createMockFetch()));
    await runPipeline({ config, orders: ORDERS, client, bus });

    expect(events.filter((e) => e.type === 'order:failed')).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('run:end');
  });

  it('reports a malformed 200 instead of trusting it', async () => {
    const config = testConfig();
    const client = createOpenWeatherClient(config, testDeps(async () => json(200, { unexpected: true })));

    const report = await runPipeline({ config, orders: [ORDERS[0]!], client, bus: createEventBus() });

    expect(report.orders[0]?.error?.kind).toBe('MalformedResponse');
  });
});

describe('a rejected API key', () => {
  it('stops the run and explains itself instead of retrying four times', async () => {
    const config = testConfig();
    const client = createOpenWeatherClient(
      config,
      testDeps(async (input) =>
        cityOf(input) === 'New York'
          ? json(401, { message: 'Invalid API key' })
          : json(200, weatherBody('Clear')),
      ),
    );

    const report = await runPipeline({ config, orders: ORDERS, client, bus: createEventBus() });

    expect(report.aborted?.kind).toBe('AuthError');
    expect(report.aborted?.message).toMatch(/OWM_API_KEY/);
  });

  it('produces no usable orders, so callers know not to persist it', async () => {
    const config = testConfig();
    const client = createOpenWeatherClient(config, testDeps(async () => json(401, { message: 'Invalid API key' })));

    const report = await runPipeline({ config, orders: ORDERS, client, bus: createEventBus() });

    // The CLI and the server both skip the write when `aborted` is set. An aborted run
    // learned nothing, and writing it would destroy the last good result.
    expect(report.aborted).toBeDefined();
    expect(report.orders.every((order) => order.error)).toBe(true);
    expect(report.orders.some((order) => order.weather)).toBe(false);
  });

  it('actually cancels the requests still in flight', async () => {
    const config = testConfig();
    const client = createOpenWeatherClient(
      config,
      // The bad key answers immediately; everything else is still on the wire. If the
      // abort were decided after Promise.all it would arrive too late to cancel anything.
      testDeps(async (input, init) => {
        if (cityOf(input) === 'New York') return json(401, { message: 'Invalid API key' });
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(json(200, weatherBody('Clear'))), 3000);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }),
    );

    const started = performance.now();
    const report = await runPipeline({ config, orders: ORDERS, client, bus: createEventBus() });
    const elapsed = performance.now() - started;

    expect(report.aborted?.kind).toBe('AuthError');
    expect(elapsed).toBeLessThan(1000);
    expect(report.orders.filter((order) => order.error?.kind === 'Aborted')).toHaveLength(3);
  });
});
