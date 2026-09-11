import type { ErrorKind } from './errors';

export type OrderStatus = 'Pending' | 'Delayed';

/** An order exactly as it appears in data/orders.json. */
export interface Order {
  order_id: string;
  customer: string;
  city: string;
  status: OrderStatus;
}

export interface WeatherSnapshot {
  /** Name the API resolved the query to, which is not always what we asked for. */
  resolvedCity: string;
  country: string;
  condition: string;
  description: string;
  tempC: number;
  feelsLikeC: number;
  humidity: number;
  windMs: number;
  icon: string;
  lat: number;
  lon: number;
  observedAt: string;
}

/**
 * An order after processing. The four original fields are preserved verbatim so the
 * output is a drop-in replacement for the input; everything else is added detail.
 */
export interface ProcessedOrder extends Order {
  weather?: WeatherSnapshot;
  delay_reason?: string;
  customer_message?: string;
  message_source?: 'llm' | 'template';
  needs_review?: true;
  error?: {
    kind: ErrorKind;
    message: string;
    attempts: number;
  };
}

/** One HTTP attempt. Times are milliseconds since the start of the run. */
export interface AttemptRecord {
  attempt: number;
  dispatchedAt: number;
  settledAt: number;
  ms: number;
  status: number | null;
  outcome: 'ok' | 'retried' | 'failed';
  errorKind?: ErrorKind;
}

export interface TaskTimeline {
  order_id: string;
  city: string;
  attempts: AttemptRecord[];
  /** First dispatch to final settle, including time spent in backoff. */
  totalMs: number;
  outcome: 'ok' | 'failed';
}

export interface RunMetrics {
  total: number;
  delayed: number;
  onTime: number;
  failed: number;
  httpRequests: number;
  /** Real elapsed time for the whole fan-out. */
  wallMs: number;
  /** Sum of every attempt's latency: what one-by-one would have cost. */
  sequentialMs: number;
  speedup: number;
  /** Peak number of requests in flight at once. */
  maxOverlap: number;
  /** Gap between the first and last first-attempt dispatch. */
  dispatchSpreadMs: number;
}

export interface RunReport {
  runId: string;
  mode: 'live' | 'mock';
  startedAt: string;
  orders: ProcessedOrder[];
  timeline: TaskTimeline[];
  metrics: RunMetrics;
  /** Set when the run was cut short, e.g. a bad API key. */
  aborted?: { kind: ErrorKind; message: string };
}
