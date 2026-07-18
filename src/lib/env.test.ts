import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('accepts a fully populated environment', () => {
    const env = parseEnv({ OPENAI_API_KEY: 'sk-test', MASTRA_TELEMETRY_DISABLED: '1' });

    expect(env.OPENAI_API_KEY).toBe('sk-test');
    expect(env.MASTRA_TELEMETRY_DISABLED).toBe('1');
  });

  it('treats MASTRA_TELEMETRY_DISABLED as optional', () => {
    expect(parseEnv({ OPENAI_API_KEY: 'sk-test' }).MASTRA_TELEMETRY_DISABLED).toBeUndefined();
  });

  it('names the offending variable when one is missing', () => {
    expect(() => parseEnv({})).toThrow(/OPENAI_API_KEY/);
  });

  it('rejects an empty key rather than passing it through', () => {
    expect(() => parseEnv({ OPENAI_API_KEY: '' })).toThrow(/OPENAI_API_KEY/);
  });
});
