import 'dotenv/config';
import { resolve } from 'node:path';

export interface Config {
  mode: 'live' | 'mock';
  apiKey: string;
  baseUrl: string;
  maxConcurrency: number;
  requestTimeoutMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  delayConditions: string[];
  extremeAliases: boolean;
  anthropicApiKey: string | null;
  ordersPath: string;
  outputPath: string;
}

export class ConfigError extends Error {}

export interface ConfigOverrides {
  mode?: 'live' | 'mock';
  ordersPath?: string;
  outputPath?: string;
  maxConcurrency?: number;
}

export function loadConfig(overrides: ConfigOverrides = {}): Config {
  const mode = overrides.mode ?? 'live';
  const apiKey = (process.env.OWM_API_KEY ?? '').trim();

  if (mode === 'live' && !apiKey) {
    throw new ConfigError(
      'OWM_API_KEY is not set. Copy .env.example to .env and add your OpenWeatherMap key, or run with --mock to use the offline fixtures.',
    );
  }

  return {
    mode,
    apiKey,
    baseUrl: process.env.OWM_BASE_URL ?? 'https://api.openweathermap.org/data/2.5',
    maxConcurrency: overrides.maxConcurrency ?? int('MAX_CONCURRENCY', 8),
    requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 8000),
    maxAttempts: int('MAX_ATTEMPTS', 3),
    backoffBaseMs: int('BACKOFF_BASE_MS', 250),
    backoffCapMs: int('BACKOFF_CAP_MS', 4000),
    delayConditions: list('DELAY_CONDITIONS', ['Rain', 'Snow', 'Extreme']),
    extremeAliases: bool('EXTREME_ALIASES', false),
    anthropicApiKey: (process.env.ANTHROPIC_API_KEY ?? '').trim() || null,
    ordersPath: resolve(overrides.ordersPath ?? 'data/orders.json'),
    outputPath: resolve(overrides.outputPath ?? 'data/orders.processed.json'),
  };
}

/**
 * The key travels in the query string, so it ends up in anything that echoes a URL.
 * Everything user-visible — logs, the CLI report, SSE frames to the browser — goes
 * through here first.
 */
export function redact(text: string): string {
  return text.replace(/(appid=)[^&\s]+/gi, '$1***');
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) {
    throw new ConfigError(`${name} was set but parsed to an empty list`);
  }
  return items;
}
