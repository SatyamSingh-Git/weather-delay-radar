import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline/run';
import { readOrders, writeOrders } from '../src/report/writeJson';
import { createEventBus } from '../src/telemetry';
import type { ProcessedOrder } from '../src/types';
import { createOpenWeatherClient } from '../src/weather/client';
import { createMockFetch } from '../src/weather/mock';
import { testConfig, testDeps } from './helpers';

describe('the whole pipeline, on the assignment data', () => {
  it('produces the expected orders.json', async () => {
    const orders = await readOrders('data/orders.json');
    const config = testConfig();
    const client = createOpenWeatherClient(config, testDeps(createMockFetch()));

    const report = await runPipeline({ config, orders, client, bus: createEventBus() });

    expect(summarise(report.orders)).toEqual([
      { order_id: '1001', city: 'New York', status: 'Delayed', condition: 'Rain', error: null },
      { order_id: '1002', city: 'Mumbai', status: 'Pending', condition: 'Clear', error: null },
      { order_id: '1003', city: 'London', status: 'Delayed', condition: 'Snow', error: null },
      { order_id: '1004', city: 'InvalidCity123', status: 'Pending', condition: null, error: 'CityNotFound' },
    ]);
  });

  it('writes a file that reads back as the same orders', async () => {
    const orders = await readOrders('data/orders.json');
    const config = testConfig();
    const client = createOpenWeatherClient(config, testDeps(createMockFetch()));
    const report = await runPipeline({ config, orders, client, bus: createEventBus() });

    const dir = await mkdtemp(join(tmpdir(), 'delay-radar-'));
    const path = join(dir, 'orders.processed.json');
    await writeOrders(path, report.orders);

    const written = JSON.parse(await readFile(path, 'utf8'));
    expect(written).toEqual(report.orders);
    expect(written[0].customer_message).toContain('Hi Alice');
  });

  it('leaves the four original fields untouched on every order', async () => {
    const orders = await readOrders('data/orders.json');
    const config = testConfig();
    const client = createOpenWeatherClient(config, testDeps(createMockFetch()));
    const report = await runPipeline({ config, orders, client, bus: createEventBus() });

    for (const [index, order] of report.orders.entries()) {
      expect(order.order_id).toBe(orders[index]?.order_id);
      expect(order.customer).toBe(orders[index]?.customer);
      expect(order.city).toBe(orders[index]?.city);
    }
  });

  it('only writes a customer message for orders it actually delayed', async () => {
    const orders = await readOrders('data/orders.json');
    const config = testConfig();
    const client = createOpenWeatherClient(config, testDeps(createMockFetch()));
    const report = await runPipeline({ config, orders, client, bus: createEventBus() });

    for (const order of report.orders) {
      expect(Boolean(order.customer_message)).toBe(order.status === 'Delayed');
    }
  });
});

const summarise = (orders: ProcessedOrder[]) =>
  orders.map((order) => ({
    order_id: order.order_id,
    city: order.city,
    status: order.status,
    condition: order.weather?.condition ?? null,
    error: order.error?.kind ?? null,
  }));
