import { randomUUID } from 'node:crypto';
import type { Config } from '../config';
import { adviceFor, type WeatherError } from '../errors';
import { createDeduper, createSemaphore } from '../http/limiter';
import type { Result } from '../result';
import { computeMetrics, type EventBus } from '../telemetry';
import type { AttemptRecord, Order, ProcessedOrder, RunReport, TaskTimeline, WeatherSnapshot } from '../types';
import type { WeatherClient } from '../weather/client';
import { createApologyWriter, type ApologyWriter } from './apology';
import { classify } from './classify';

export interface RunOptions {
  config: Config;
  orders: Order[];
  client: WeatherClient;
  bus: EventBus;
  apologyWriter?: ApologyWriter;
}

export async function runPipeline({
  config,
  orders,
  client,
  bus,
  apologyWriter = createApologyWriter(config),
}: RunOptions): Promise<RunReport> {
  const runId = randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const at = () => round(performance.now() - t0);

  const withPermit = createSemaphore(config.maxConcurrency);
  const dedupe = createDeduper<Result<WeatherSnapshot, WeatherError>>();
  const timelines = new Map<string, TaskTimeline>();

  /** Tripped by a fatal error such as a rejected API key; stops work already queued. */
  const abort = new AbortController();
  let fatal: WeatherError | null = null;

  bus.emit({
    type: 'run:start',
    at: at(),
    runId,
    mode: config.mode,
    orderCount: orders.length,
    maxConcurrency: config.maxConcurrency,
  });

  const fetchOne = (order: Order): Promise<Result<WeatherSnapshot, WeatherError>> => {
    const attempts: AttemptRecord[] = [];
    timelines.set(order.order_id, {
      order_id: order.order_id,
      city: order.city,
      attempts,
      totalMs: 0,
      outcome: 'failed',
    });

    return withPermit(() =>
      dedupe(order.city.toLowerCase(), () =>
        client.fetchCity(
          order.city,
          {
            onDispatch: (attempt) => {
              bus.emit({ type: 'order:dispatch', at: at(), orderId: order.order_id, city: order.city, attempt });
            },
            onSettled: (outcome) => {
              attempts.push({
                attempt: outcome.attempt,
                dispatchedAt: round(outcome.dispatchedAt - t0),
                settledAt: round(outcome.settledAt - t0),
                ms: round(outcome.settledAt - outcome.dispatchedAt),
                status: outcome.status,
                outcome: outcome.ok ? 'ok' : 'failed',
                ...(outcome.errorKind ? { errorKind: outcome.errorKind } : {}),
              });
              bus.emit({
                type: 'order:attempt',
                at: at(),
                orderId: order.order_id,
                attempt: outcome.attempt,
                ok: outcome.ok,
                status: outcome.status,
                ms: round(outcome.settledAt - outcome.dispatchedAt),
              });
            },
            onRetry: (attempt, delayMs, reason) => {
              const record = attempts[attempt - 1];
              if (record) record.outcome = 'retried';
              bus.emit({
                type: 'order:retry',
                at: at(),
                orderId: order.order_id,
                attempt,
                delayMs: round(delayMs),
                reason: reason.kind,
              });
            },
          },
          abort.signal,
        ),
      ),
    ).then((result) => {
      // Has to happen inside the fan-out. Deciding this after Promise.all resolves
      // would be too late to cancel anything — every request would already have
      // settled, and the signal would abort nothing.
      if (!result.ok && result.error.fatal && !abort.signal.aborted) abort.abort();
      return result;
    });
  };

  // The fan-out. Every task resolves to a Result rather than rejecting, so Promise.all
  // cannot short-circuit on InvalidCity123 — and unlike allSettled we keep the typed
  // error and the per-attempt history instead of an opaque `reason`.
  const results = await Promise.all(orders.map(fetchOne));
  const wallMs = performance.now() - t0;

  const processed: ProcessedOrder[] = [];
  const delayed: ProcessedOrder[] = [];

  for (const [index, order] of orders.entries()) {
    const result = results[index];
    const timeline = timelines.get(order.order_id);
    if (!result || !timeline) continue;

    const last = timeline.attempts[timeline.attempts.length - 1];
    timeline.totalMs = last ? round(last.settledAt - (timeline.attempts[0]?.dispatchedAt ?? 0)) : 0;
    timeline.outcome = result.ok ? 'ok' : 'failed';

    if (!result.ok) {
      if (result.error.fatal) fatal ??= result.error;

      bus.emit({ type: 'order:failed', at: at(), orderId: order.order_id, error: result.error });
      processed.push({
        ...order,
        needs_review: true,
        error: {
          kind: result.error.kind,
          message: result.error.message,
          attempts: result.error.attempts,
        },
      });
      continue;
    }

    const weather = result.value;
    bus.emit({ type: 'order:resolved', at: at(), orderId: order.order_id, weather, ms: timeline.totalMs });

    const verdict = classify(weather, {
      conditions: config.delayConditions,
      extremeAliases: config.extremeAliases,
    });
    bus.emit({
      type: 'order:classified',
      at: at(),
      orderId: order.order_id,
      status: verdict.status,
      reason: verdict.reason,
    });

    const enriched: ProcessedOrder = { ...order, status: verdict.status, weather };
    if (verdict.status === 'Delayed' && verdict.reason) {
      enriched.delay_reason = verdict.reason;
      delayed.push(enriched);
    }

    processed.push(enriched);
  }

  // Same reasoning as the fetches: if the LLM tier is switched on these are network
  // calls, and there is no reason to make Bob wait for Alice's sentence.
  await Promise.all(
    delayed.map(async (order) => {
      const weather = order.weather;
      if (!weather) return;

      const apology = await apologyWriter.write({
        customer: order.customer,
        city: order.city,
        condition: weather.condition,
        description: weather.description,
        tempC: weather.tempC,
      });

      order.customer_message = apology.text;
      order.message_source = apology.source;
      bus.emit({
        type: 'order:apology',
        at: at(),
        orderId: order.order_id,
        text: apology.text,
        source: apology.source,
      });
    }),
  );

  const timeline = orders
    .map((order) => timelines.get(order.order_id))
    .filter((entry): entry is TaskTimeline => entry !== undefined);
  const metrics = computeMetrics(processed, timeline, wallMs);

  bus.emit({ type: 'run:end', at: at(), metrics });

  return {
    runId,
    mode: config.mode,
    startedAt,
    orders: processed,
    timeline,
    metrics,
    ...(fatal ? { aborted: { kind: fatal.kind, message: adviceFor(fatal.kind) ?? fatal.message } } : {}),
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
