import type { Config } from '../src/config';
import { defaultHttpDeps, type HttpDeps } from '../src/http/fetchWithRetry';
import type { Order } from '../src/types';

export const ORDERS: Order[] = [
  { order_id: '1001', customer: 'Alice Smith', city: 'New York', status: 'Pending' },
  { order_id: '1002', customer: 'Bob Jones', city: 'Mumbai', status: 'Pending' },
  { order_id: '1003', customer: 'Charlie Green', city: 'London', status: 'Pending' },
  { order_id: '1004', customer: 'InvalidCity123', city: 'InvalidCity123', status: 'Pending' },
];

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    mode: 'mock',
    apiKey: 'test-key',
    baseUrl: 'https://api.example.test/data/2.5',
    maxConcurrency: 8,
    requestTimeoutMs: 1000,
    maxAttempts: 3,
    backoffBaseMs: 10,
    backoffCapMs: 40,
    delayConditions: ['Rain', 'Snow', 'Extreme'],
    extremeAliases: false,
    anthropicApiKey: null,
    ordersPath: 'data/orders.json',
    outputPath: 'data/orders.processed.json',
    ...overrides,
  };
}

/** Deterministic jitter, so backoff assertions are exact rather than approximate. */
export function testDeps(fetchImpl: typeof fetch): HttpDeps {
  return { ...defaultHttpDeps, fetchImpl, random: () => 1 };
}

export function weatherBody(main: string, description = main.toLowerCase(), temp = 12) {
  return {
    weather: [{ main, description, icon: '10d' }],
    main: { temp, feels_like: temp - 1, humidity: 70 },
    wind: { speed: 4 },
    coord: { lat: 0, lon: 0 },
    sys: { country: 'XX' },
    name: 'Testville',
    dt: 1757400000,
  };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export const cityOf = (input: Parameters<typeof fetch>[0]) =>
  new URL(typeof input === 'string' ? input : String(input)).searchParams.get('q') ?? '';

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
