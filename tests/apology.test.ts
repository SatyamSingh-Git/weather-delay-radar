import { describe, expect, it } from 'vitest';
import { createApologyWriter, templateApology } from '../src/pipeline/apology';
import { testConfig } from './helpers';

const ALICE = {
  customer: 'Alice Smith',
  city: 'New York',
  condition: 'Rain',
  description: 'heavy intensity rain',
  tempC: 14.2,
};

describe('the template writer', () => {
  it('produces the message the assignment asks for', () => {
    expect(templateApology(ALICE)).toBe(
      'Hi Alice, your order to New York is delayed due to heavy rain. We appreciate your patience!',
    );
  });

  it('uses the first name only', () => {
    expect(templateApology({ ...ALICE, customer: 'Charlie Green' })).toContain('Hi Charlie,');
  });

  it('varies with the actual weather rather than the bucket', () => {
    const light = templateApology({ ...ALICE, description: 'light rain' });
    const heavy = templateApology({ ...ALICE, description: 'very heavy rain' });
    expect(light).toContain('light rain');
    expect(heavy).toContain('very heavy rain');
    expect(light).not.toBe(heavy);
  });

  it('falls back to the condition when the API sends no description', () => {
    expect(templateApology({ ...ALICE, description: '' })).toContain('due to rain.');
  });

  it('survives a single-word customer name', () => {
    expect(templateApology({ ...ALICE, customer: 'Prince' })).toContain('Hi Prince,');
  });
});

describe('the writer chosen at startup', () => {
  it('uses the template when no Anthropic key is configured', async () => {
    const writer = createApologyWriter(testConfig({ anthropicApiKey: null }));
    const apology = await writer.write(ALICE);

    expect(apology.source).toBe('template');
    expect(apology.text).toBe(templateApology(ALICE));
  });

  it('falls back to the template when the model call fails', async () => {
    const writer = createApologyWriter(
      testConfig({ anthropicApiKey: 'sk-ant-not-a-real-key', baseUrl: 'https://127.0.0.1:1' }),
    );
    const apology = await writer.write(ALICE);

    expect(apology.source).toBe('template');
    expect(apology.text).toBe(templateApology(ALICE));
  }, 20000);
});
