import type { WeatherSnapshot } from '../types';

export interface DelayPolicy {
  conditions: string[];
  extremeAliases: boolean;
}

/**
 * OpenWeatherMap no longer returns "Extreme" as a weather[0].main value — it was a
 * grouping in the older API and these three are what survived of it. The assignment
 * names Extreme, so the alias is available, but it stays off by default so the shipped
 * policy is exactly the specified set and nothing more.
 */
const EXTREME_ALIASES = ['Tornado', 'Squall', 'Ash'];

export interface Classification {
  status: 'Pending' | 'Delayed';
  reason: string | null;
}

export function classify(weather: WeatherSnapshot, policy: DelayPolicy): Classification {
  const condition = weather.condition.toLowerCase();
  const triggers = policy.conditions.map((c) => c.toLowerCase());

  const matched =
    triggers.includes(condition) ||
    (policy.extremeAliases &&
      triggers.includes('extreme') &&
      EXTREME_ALIASES.some((alias) => alias.toLowerCase() === condition));

  if (!matched) return { status: 'Pending', reason: null };
  return { status: 'Delayed', reason: `${weather.condition} — ${weather.description}` };
}
