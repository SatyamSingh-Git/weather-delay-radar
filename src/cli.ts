import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config';
import { defaultHttpDeps } from './http/fetchWithRetry';
import { runPipeline } from './pipeline/run';
import { attachConsoleReporter, printReport } from './report/console';
import { readOrders, writeOrders } from './report/writeJson';
import { createEventBus } from './telemetry';
import { createOpenWeatherClient } from './weather/client';
import { createMockFetch } from './weather/mock';

const { values } = parseArgs({
  options: {
    mock: { type: 'boolean', default: false },
    orders: { type: 'string' },
    out: { type: 'string' },
    concurrency: { type: 'string' },
    report: { type: 'string' },
  },
});

try {
  const config = loadConfig({
    mode: values.mock ? 'mock' : 'live',
    ...(values.orders ? { ordersPath: values.orders } : {}),
    ...(values.out ? { outputPath: values.out } : {}),
    ...(values.concurrency ? { maxConcurrency: Number(values.concurrency) } : {}),
  });

  const orders = await readOrders(config.ordersPath);
  const bus = createEventBus();
  attachConsoleReporter(bus);

  const client = createOpenWeatherClient(
    config,
    values.mock ? { ...defaultHttpDeps, fetchImpl: createMockFetch() } : defaultHttpDeps,
  );

  const report = await runPipeline({ config, orders, client, bus });

  await writeOrders(config.outputPath, report.orders);
  if (values.report) await writeFile(values.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  printReport(report, config.outputPath);

  // A city that does not exist is a reported outcome, not a failed run. Only a fatal
  // condition — a rejected API key, say — is worth a non-zero exit.
  process.exitCode = report.aborted ? 1 : 0;
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`\n  Configuration problem\n  ${error.message}\n`);
  } else {
    console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
}
