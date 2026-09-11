import { adviceFor } from '../errors';
import type { EventBus } from '../telemetry';
import type { RunReport, TaskTimeline } from '../types';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (useColor ? `[${code}m${text}[0m` : text);

const dim = paint('2');
const bold = paint('1');
const cyan = paint('36');
const amber = paint('33');
const rose = paint('31');
const green = paint('32');

const WATERFALL_WIDTH = 44;

/** Streams a line per event while the run is in flight. */
export function attachConsoleReporter(bus: EventBus): void {
  bus.subscribe((event) => {
    switch (event.type) {
      case 'run:start':
        console.log(
          `\n${bold('Delay Radar')} ${dim(`· run ${event.runId} · ${event.mode} · ${event.orderCount} orders · max concurrency ${event.maxConcurrency}`)}\n`,
        );
        break;
      case 'order:dispatch':
        console.log(`  ${dim(stamp(event.at))} → ${event.city}${event.attempt > 1 ? dim(` (attempt ${event.attempt})`) : ''}`);
        break;
      case 'order:retry':
        console.log(
          `  ${dim(stamp(event.at))} ${amber('↻')} ${event.orderId} ${dim(`${event.reason}, retrying in ${event.delayMs}ms`)}`,
        );
        break;
      case 'order:resolved':
        console.log(
          `  ${dim(stamp(event.at))} ${green('✓')} ${event.weather.resolvedCity} ${dim(`${event.weather.condition}, ${event.weather.tempC.toFixed(1)}°C`)}`,
        );
        break;
      case 'order:failed':
        console.log(`  ${dim(stamp(event.at))} ${rose('✗')} ${event.orderId} ${dim(`${event.error.kind}: ${event.error.message}`)}`);
        break;
      default:
        break;
    }
  });
}

/** `outputPath` is null when the run was aborted and nothing was written. */
export function printReport(report: RunReport, outputPath: string | null): void {
  const { metrics } = report;

  console.log(`\n  ${dim('─ Concurrency ' + '─'.repeat(46))}\n`);

  const span = Math.max(...report.timeline.map(lastSettle), 1);
  for (const task of report.timeline) {
    console.log(`  ${label(task.city)} ${bar(task, span)} ${dim(rightPad(`${task.totalMs}ms`, 8))}${statusNote(task)}`);
  }

  console.log(
    `\n  ${dim(`all ${report.timeline.length} dispatched within ${metrics.dispatchSpreadMs}ms · peak overlap ${metrics.maxOverlap} · ${metrics.httpRequests} requests`)}`,
  );
  console.log(
    `  ${dim('sequential')} ${metrics.sequentialMs}ms ${dim('→ wall')} ${bold(`${metrics.wallMs}ms`)} ${cyan(`${metrics.speedup}× faster`)}`,
  );

  console.log(`\n  ${dim('─ Orders ' + '─'.repeat(51))}\n`);

  for (const order of report.orders) {
    const badge = order.error ? rose('FAILED') : order.status === 'Delayed' ? amber('DELAYED') : green('ON TIME');
    const detail = order.weather
      ? dim(`${order.weather.condition}, ${order.weather.description}, ${order.weather.tempC.toFixed(1)}°C`)
      : dim(order.error?.kind ?? '');

    console.log(`  ${dim(order.order_id)}  ${rightPad(order.customer, 16)} ${rightPad(order.city, 16)} ${badge}`);
    console.log(`        ${detail}`);
    if (order.customer_message) console.log(`        ${cyan(`"${order.customer_message}"`)}`);
    if (order.error) {
      const advice = adviceFor(order.error.kind);
      console.log(`        ${dim(order.error.message)}`);
      if (advice) console.log(`        ${dim(advice)}`);
    }
    console.log('');
  }

  console.log(`  ${dim('─ Summary ' + '─'.repeat(50))}\n`);
  console.log(
    `  ${amber(`${metrics.delayed} delayed`)} · ${green(`${metrics.onTime} on time`)} · ${rose(`${metrics.failed} failed`)}`,
  );
  if (report.aborted) console.log(`  ${rose(`run aborted: ${report.aborted.message}`)}`);
  console.log(
    outputPath
      ? `  ${dim('→')} ${outputPath}\n`
      : `  ${dim('→ nothing written; the previous output was left untouched')}\n`,
  );
}

/**
 * Attempts are drawn in place on a shared millisecond axis, so a bar that starts at the
 * left edge really did start at t+0. Backoff gaps show as blank space between segments.
 */
function bar(task: TaskTimeline, span: number): string {
  const cells = Array.from({ length: WATERFALL_WIDTH }, () => ' ');
  const scale = WATERFALL_WIDTH / span;

  for (const attempt of task.attempts) {
    const from = Math.floor(attempt.dispatchedAt * scale);
    const to = Math.max(from + 1, Math.ceil(attempt.settledAt * scale));
    const glyph = attempt.outcome === 'ok' ? '█' : '▓';
    for (let i = from; i < Math.min(to, WATERFALL_WIDTH); i++) cells[i] = glyph;
  }

  const drawn = cells.join('');
  return task.outcome === 'ok' ? cyan(drawn) : rose(drawn);
}

function statusNote(task: TaskTimeline): string {
  const codes = task.attempts.map((a) => a.status ?? a.errorKind ?? '?').join(dim('→'));
  return dim(codes);
}

const lastSettle = (task: TaskTimeline) => task.attempts[task.attempts.length - 1]?.settledAt ?? 0;
const stamp = (at: number) => `+${String(Math.round(at)).padStart(4)}ms`;
const label = (city: string) => rightPad(city.length > 12 ? `${city.slice(0, 11)}…` : city, 12);
const rightPad = (text: string, width: number) => text.padEnd(width);
