import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config';

export interface ApologyInput {
  customer: string;
  city: string;
  condition: string;
  description: string;
  tempC: number;
}

export interface Apology {
  text: string;
  source: 'llm' | 'template';
}

export interface ApologyWriter {
  write(input: ApologyInput): Promise<Apology>;
}

const MODEL = 'claude-opus-5';
const LLM_TIMEOUT_MS = 6000;

const SYSTEM_PROMPT = [
  'You write a single-sentence delay notice for a delivery company.',
  'Address the customer by first name, name the city, and describe the weather in plain language.',
  'Warm and direct. No compensation offers, no delivery estimates, no emoji, no preamble.',
  'Return only the sentence.',
].join(' ');

/**
 * Two tiers. The template is the default and always the fallback, which keeps runs
 * deterministic and offline-safe; the model only ever adds polish on top of a path
 * that already works.
 */
export function createApologyWriter(config: Config): ApologyWriter {
  if (!config.anthropicApiKey) {
    return { write: async (input) => ({ text: templateApology(input), source: 'template' }) };
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  return {
    async write(input) {
      try {
        const response = await client.messages.create(
          {
            model: MODEL,
            max_tokens: 1024,
            output_config: { effort: 'low' },
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: JSON.stringify(input) }],
          },
          { timeout: LLM_TIMEOUT_MS },
        );

        // A refusal on copy this benign would be surprising, but the template is a
        // better answer than a second model call, so it doubles as the fallback.
        if (response.stop_reason === 'refusal') {
          return { text: templateApology(input), source: 'template' };
        }

        const text = response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(' ')
          .trim();

        if (!text) return { text: templateApology(input), source: 'template' };
        return { text, source: 'llm' };
      } catch {
        return { text: templateApology(input), source: 'template' };
      }
    },
  };
}

export function templateApology(input: ApologyInput): string {
  const firstName = input.customer.split(' ')[0] || input.customer;
  return `Hi ${firstName}, your order to ${input.city} is delayed due to ${plainWeather(input)}. We appreciate your patience!`;
}

/**
 * OpenWeatherMap writes "heavy intensity rain" and "light intensity shower rain".
 * Dropping the word "intensity" is the whole difference between copy that reads like
 * an API field and copy that reads like a person wrote it.
 */
function plainWeather(input: ApologyInput): string {
  const description = input.description.replace(/\s*intensity\s*/gi, ' ').replace(/\s+/g, ' ').trim();
  return description || input.condition.toLowerCase();
}
