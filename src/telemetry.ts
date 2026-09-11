import type { WeatherError } from './errors';
import type { AttemptRecord, ProcessedOrder, RunMetrics, TaskTimeline, WeatherSnapshot } from './types';

/**
 * Every event carries `at`, milliseconds since the start of the run. The CLI renderer
 * and the browser dashboard are both just subscribers to this stream.
 */
export type RunEvent =
  | { type: 'run:start'; at: number; runId: string; mode: 'live' | 'mock'; orderCount: number; maxConcurrency: number }
  | { type: 'order:dispatch'; at: number; orderId: string; city: string; attempt: number }
  | { type: 'order:attempt'; at: number; orderId: string; attempt: number; ok: boolean; status: number | null; ms: number }
  | { type: 'order:retry'; at: number; orderId: string; attempt: number; delayMs: number; reason: string }
  | { type: 'order:resolved'; at: number; orderId: string; weather: WeatherSnapshot; ms: number }
  | { type: 'order:failed'; at: number; orderId: string; error: WeatherError }
  | { type: 'order:classified'; at: number; orderId: string; status: 'Pending' | 'Delayed'; reason: string | null }
  | { type: 'order:apology'; at: number; orderId: string; text: string; source: 'llm' | 'template' }
  | { type: 'run:end'; at: number; metrics: RunMetrics };

export type EventListener = (event: RunEvent) => void;

export interface EventBus {
  emit(event: RunEvent): void;
  subscribe(listener: EventListener): () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Set<EventListener>();
  return {
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function computeMetrics(
  orders: ProcessedOrder[],
  timeline: TaskTimeline[],
  wallMs: number,
): RunMetrics {
  const attempts = timeline.flatMap((task) => task.attempts);
  const sequentialMs = attempts.reduce((sum, a) => sum + a.ms, 0);
  const firstDispatches = timeline
    .map((task) => task.attempts[0]?.dispatchedAt)
    .filter((at): at is number => at !== undefined);

  return {
    total: orders.length,
    delayed: orders.filter((o) => o.status === 'Delayed').length,
    onTime: orders.filter((o) => o.status === 'Pending' && !o.error).length,
    failed: orders.filter((o) => o.error).length,
    httpRequests: attempts.length,
    wallMs: round(wallMs),
    sequentialMs: round(sequentialMs),
    speedup: wallMs > 0 ? round(sequentialMs / wallMs) : 0,
    maxOverlap: peakOverlap(attempts),
    dispatchSpreadMs:
      firstDispatches.length > 0 ? round(Math.max(...firstDispatches) - Math.min(...firstDispatches)) : 0,
  };
}

/**
 * Sweep the attempt intervals to find how many requests were genuinely in flight at
 * once. This is the number that separates a real fan-out from a loop with `await`
 * inside it, so it is worth measuring rather than asserting.
 */
function peakOverlap(attempts: AttemptRecord[]): number {
  const edges = attempts
    .flatMap((a) => [
      { at: a.dispatchedAt, delta: 1 },
      { at: a.settledAt, delta: -1 },
    ])
    // Close before opening at the same instant, so a handover is not counted as overlap.
    .sort((a, b) => a.at - b.at || a.delta - b.delta);

  let current = 0;
  let peak = 0;
  for (const edge of edges) {
    current += edge.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

const round = (n: number) => Math.round(n * 10) / 10;
