import type { Config } from '../config';
import { weatherError, type WeatherError } from '../errors';
import { defaultHttpDeps, fetchWithRetry, type HttpDeps, type RetryHooks } from '../http/fetchWithRetry';
import { err, ok, type Result } from '../result';
import type { WeatherSnapshot } from '../types';

export interface WeatherClient {
  readonly mode: 'live' | 'mock';
  fetchCity(
    city: string,
    hooks: RetryHooks,
    signal?: AbortSignal,
  ): Promise<Result<WeatherSnapshot, WeatherError>>;
}

export function createOpenWeatherClient(config: Config, deps: HttpDeps = defaultHttpDeps): WeatherClient {
  const policy = {
    maxAttempts: config.maxAttempts,
    timeoutMs: config.requestTimeoutMs,
    backoffBaseMs: config.backoffBaseMs,
    backoffCapMs: config.backoffCapMs,
  };

  return {
    mode: 'live',
    async fetchCity(city, hooks, signal) {
      const url = `${config.baseUrl}/weather?q=${encodeURIComponent(city)}&units=metric&appid=${config.apiKey}`;
      const response = await fetchWithRetry(url, policy, deps, hooks, signal);
      if (!response.ok) return response;
      return parseSnapshot(response.value.body);
    },
  };
}

/**
 * OpenWeatherMap answers 200 with a shape we depend on, so a missing weather[0].main
 * is a real failure rather than something to paper over with a default.
 */
export function parseSnapshot(body: unknown): Result<WeatherSnapshot, WeatherError> {
  const raw = body as OpenWeatherResponse | null;
  const entry = raw?.weather?.[0];

  if (!entry?.main || !raw?.main) {
    return err(weatherError('MalformedResponse', 'response did not contain weather[0].main'));
  }

  return ok({
    resolvedCity: raw.name ?? '',
    country: raw.sys?.country ?? '',
    condition: entry.main,
    description: entry.description ?? entry.main.toLowerCase(),
    tempC: raw.main.temp,
    feelsLikeC: raw.main.feels_like ?? raw.main.temp,
    humidity: raw.main.humidity ?? 0,
    windMs: raw.wind?.speed ?? 0,
    icon: entry.icon ?? '01d',
    lat: raw.coord?.lat ?? 0,
    lon: raw.coord?.lon ?? 0,
    observedAt: new Date((raw.dt ?? Date.now() / 1000) * 1000).toISOString(),
  });
}

interface OpenWeatherResponse {
  weather?: Array<{ main?: string; description?: string; icon?: string }>;
  main?: { temp: number; feels_like?: number; humidity?: number };
  wind?: { speed?: number };
  coord?: { lat?: number; lon?: number };
  sys?: { country?: string };
  name?: string;
  dt?: number;
}
