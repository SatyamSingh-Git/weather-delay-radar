/**
 * Offline mode swaps in a fake `fetch`, not a fake client. Everything above it — retry,
 * backoff, status classification, response parsing — is the same code the live path runs,
 * so `npm run demo` proves the real pipeline rather than a stand-in for it.
 */

interface Fixture {
  latencyMs: number;
  status: number;
  body: unknown;
  /** Fail the first attempt with this status, then serve normally. */
  transientFailure?: number;
}

const FIXTURES: Record<string, Fixture> = {
  'new york': {
    latencyMs: 412,
    status: 200,
    body: owm('New York', 'US', 'Rain', 'heavy intensity rain', '10d', 14.2, 12.8, 87, 6.7, 40.7143, -74.006),
  },
  mumbai: {
    latencyMs: 587,
    status: 200,
    body: owm('Mumbai', 'IN', 'Clear', 'clear sky', '01d', 31.4, 35.1, 62, 3.6, 19.0144, 72.8479),
  },
  london: {
    latencyMs: 298,
    status: 200,
    transientFailure: 503,
    body: owm('London', 'GB', 'Snow', 'light snow', '13d', -1.3, -5.8, 91, 4.1, 51.5085, -0.1257),
  },
  invalidcity123: {
    latencyMs: 96,
    status: 404,
    body: { cod: '404', message: 'city not found' },
  },
};

export function createMockFetch(): typeof fetch {
  const attemptsByCity = new Map<string, number>();

  return async function mockFetch(input, init) {
    const url = new URL(typeof input === 'string' ? input : String(input));
    const city = (url.searchParams.get('q') ?? '').toLowerCase();
    const fixture = FIXTURES[city];

    if (!fixture) {
      return jsonResponse(404, { cod: '404', message: 'city not found' });
    }

    const attempt = (attemptsByCity.get(city) ?? 0) + 1;
    attemptsByCity.set(city, attempt);

    await delay(fixture.latencyMs, init?.signal ?? undefined);

    if (fixture.transientFailure && attempt === 1) {
      return jsonResponse(fixture.transientFailure, {
        cod: String(fixture.transientFailure),
        message: 'upstream temporarily unavailable',
      });
    }

    return jsonResponse(fixture.status, fixture.body);
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function owm(
  name: string,
  country: string,
  main: string,
  description: string,
  icon: string,
  temp: number,
  feels: number,
  humidity: number,
  wind: number,
  lat: number,
  lon: number,
) {
  return {
    weather: [{ main, description, icon }],
    main: { temp, feels_like: feels, humidity },
    wind: { speed: wind },
    coord: { lat, lon },
    sys: { country },
    name,
    dt: 1757400000,
  };
}
