import { describe, expect, it } from 'vitest';
import { classify } from '../src/pipeline/classify';
import type { WeatherSnapshot } from '../src/types';

const SPEC_POLICY = { conditions: ['Rain', 'Snow', 'Extreme'], extremeAliases: false };

const snapshot = (condition: string, description = condition.toLowerCase()): WeatherSnapshot => ({
  resolvedCity: 'Testville',
  country: 'XX',
  condition,
  description,
  tempC: 10,
  feelsLikeC: 9,
  humidity: 70,
  windMs: 4,
  icon: '10d',
  lat: 0,
  lon: 0,
  observedAt: '2026-09-09T00:00:00.000Z',
});

describe('delay policy', () => {
  it.each(['Rain', 'Snow', 'Extreme'])('marks %s as delayed', (condition) => {
    expect(classify(snapshot(condition), SPEC_POLICY).status).toBe('Delayed');
  });

  it.each(['Clear', 'Clouds', 'Mist', 'Drizzle', 'Thunderstorm'])('leaves %s pending', (condition) => {
    expect(classify(snapshot(condition), SPEC_POLICY).status).toBe('Pending');
  });

  it('matches the API casing rather than assuming it', () => {
    expect(classify(snapshot('rain'), SPEC_POLICY).status).toBe('Delayed');
  });

  it('explains the delay with the condition and the description', () => {
    const { reason } = classify(snapshot('Rain', 'heavy intensity rain'), SPEC_POLICY);
    expect(reason).toBe('Rain — heavy intensity rain');
  });

  it('gives no reason when the order is on time', () => {
    expect(classify(snapshot('Clear'), SPEC_POLICY).reason).toBeNull();
  });

  it('honours an overridden condition list', () => {
    const policy = { conditions: ['Thunderstorm'], extremeAliases: false };
    expect(classify(snapshot('Thunderstorm'), policy).status).toBe('Delayed');
    expect(classify(snapshot('Rain'), policy).status).toBe('Pending');
  });

  it('ignores the legacy Extreme aliases unless they are switched on', () => {
    expect(classify(snapshot('Tornado'), SPEC_POLICY).status).toBe('Pending');
    expect(classify(snapshot('Tornado'), { ...SPEC_POLICY, extremeAliases: true }).status).toBe('Delayed');
  });
});
