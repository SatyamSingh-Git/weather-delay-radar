/**
 * The whole point of the resilience requirement is that these are not the same thing.
 * A 404 for "InvalidCity123" is permanent: retrying it three times with backoff burns
 * five seconds to re-learn a fixed fact. A 503 is transient and worth another go.
 */
export type ErrorKind =
  | 'CityNotFound'
  | 'AuthError'
  | 'RateLimited'
  | 'UpstreamError'
  | 'NetworkError'
  | 'Timeout'
  | 'MalformedResponse'
  | 'Aborted';

export interface WeatherError {
  kind: ErrorKind;
  message: string;
  status: number | null;
  /** Worth another attempt. */
  retryable: boolean;
  /** Not worth attempting anything else either: stop the whole run. */
  fatal: boolean;
  attempts: number;
  /** Set when the server told us exactly how long to wait, via Retry-After. */
  retryAfterMs?: number;
}

const RETRYABLE = new Set<ErrorKind>(['RateLimited', 'UpstreamError', 'NetworkError', 'Timeout']);
const FATAL = new Set<ErrorKind>(['AuthError']);

export function weatherError(
  kind: ErrorKind,
  message: string,
  status: number | null = null,
  attempts = 1,
): WeatherError {
  return {
    kind,
    message,
    status,
    retryable: RETRYABLE.has(kind),
    fatal: FATAL.has(kind),
    attempts,
  };
}

export function kindForStatus(status: number): ErrorKind {
  if (status === 404) return 'CityNotFound';
  if (status === 401 || status === 403) return 'AuthError';
  if (status === 429) return 'RateLimited';
  return 'UpstreamError';
}

/** Turns whatever fetch threw into something with a name we can act on. */
export function kindForThrown(thrown: unknown): ErrorKind {
  const name = (thrown as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError' ? 'Timeout' : 'NetworkError';
}

const ADVICE: Partial<Record<ErrorKind, string>> = {
  CityNotFound: 'City is not in the OpenWeatherMap gazetteer. Left Pending for manual review.',
  AuthError:
    'OWM_API_KEY is missing, wrong, or not activated yet. New free-tier keys take ~10 minutes to a couple of hours to go live.',
  RateLimited: 'Free tier allows 60 calls/minute. Lower MAX_CONCURRENCY or wait.',
  Timeout: 'No response within REQUEST_TIMEOUT_MS.',
};

export function adviceFor(kind: ErrorKind): string | null {
  return ADVICE[kind] ?? null;
}
