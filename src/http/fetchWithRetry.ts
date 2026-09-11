import { kindForStatus, kindForThrown, weatherError, type WeatherError } from '../errors';
import { err, ok, type Result } from '../result';

export interface RetryPolicy {
  maxAttempts: number;
  timeoutMs: number;
  backoffBaseMs: number;
  backoffCapMs: number;
}

/** Injected so tests can drive time and randomness instead of waiting on them. */
export interface HttpDeps {
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
}

export const defaultHttpDeps: HttpDeps = {
  fetchImpl: fetch,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => performance.now(),
  random: Math.random,
};

export interface AttemptOutcome {
  attempt: number;
  dispatchedAt: number;
  settledAt: number;
  status: number | null;
  ok: boolean;
  errorKind?: WeatherError['kind'];
}

export interface RetryHooks {
  onDispatch?: (attempt: number, at: number) => void;
  onSettled?: (outcome: AttemptOutcome) => void;
  onRetry?: (attempt: number, delayMs: number, reason: WeatherError) => void;
}

export interface HttpSuccess {
  status: number;
  body: unknown;
}

/**
 * One request, retried only when retrying could plausibly change the answer.
 * Never throws: the caller gets a Result either way.
 */
export async function fetchWithRetry(
  url: string,
  policy: RetryPolicy,
  deps: HttpDeps,
  hooks: RetryHooks = {},
  signal?: AbortSignal,
): Promise<Result<HttpSuccess, WeatherError>> {
  let lastError: WeatherError = weatherError('NetworkError', 'request was never attempted');

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    if (signal?.aborted) {
      return err(weatherError('Aborted', 'run was aborted before this attempt', null, attempt - 1));
    }

    const dispatchedAt = deps.now();
    hooks.onDispatch?.(attempt, dispatchedAt);

    const outcome = await attemptOnce(url, policy.timeoutMs, deps, signal);
    const settledAt = deps.now();

    hooks.onSettled?.({
      attempt,
      dispatchedAt,
      settledAt,
      status: outcome.ok ? outcome.value.status : outcome.error.status,
      ok: outcome.ok,
      ...(outcome.ok ? {} : { errorKind: outcome.error.kind }),
    });

    if (outcome.ok) return outcome;

    lastError = { ...outcome.error, attempts: attempt };
    if (!lastError.retryable || attempt === policy.maxAttempts) return err(lastError);

    const delayMs = backoffDelay(attempt, policy, deps.random, lastError);
    hooks.onRetry?.(attempt, delayMs, lastError);
    await deps.sleep(delayMs);
  }

  return err(lastError);
}

async function attemptOnce(
  url: string,
  timeoutMs: number,
  deps: HttpDeps,
  signal?: AbortSignal,
): Promise<Result<HttpSuccess, WeatherError>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), timeoutMs);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);

  try {
    const response = await deps.fetchImpl(url, { signal: controller.signal });
    const body = await safeJson(response);

    if (response.ok) return ok({ status: response.status, body });

    const kind = kindForStatus(response.status);
    const detail = messageFromBody(body) ?? response.statusText;
    const error = weatherError(kind, `HTTP ${response.status}: ${detail}`, response.status);
    return err(retryAfterHint(error, response));
  } catch (thrown) {
    if (signal?.aborted) {
      return err(weatherError('Aborted', 'run was aborted mid-request'));
    }
    const kind = kindForThrown(thrown);
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    return err(
      weatherError(kind, kind === 'Timeout' ? `no response within ${timeoutMs}ms` : detail),
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** Full jitter, so a batch of retries does not re-collide on the next tick. */
function backoffDelay(
  attempt: number,
  policy: RetryPolicy,
  random: () => number,
  reason: WeatherError,
): number {
  if (reason.retryAfterMs !== undefined) return reason.retryAfterMs;
  const ceiling = Math.min(policy.backoffCapMs, policy.backoffBaseMs * 2 ** (attempt - 1));
  return Math.round(random() * ceiling);
}

function retryAfterHint(error: WeatherError, response: Response): WeatherError {
  const header = response.headers.get('retry-after');
  const seconds = header === null ? NaN : Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return error;
  return { ...error, retryAfterMs: seconds * 1000 };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageFromBody(body: unknown): string | null {
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : null;
}
