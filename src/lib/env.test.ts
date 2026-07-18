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

  it('defaults the model to gpt-5.4-mini', () => {
    expect(parseEnv({ OPENAI_API_KEY: 'sk-test' }).OPENAI_MODEL).toBe('gpt-5.4-mini');
  });

  it('accepts gpt-5.4-nano as the permitted alternative', () => {
    const env = parseEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-5.4-nano' });

    expect(env.OPENAI_MODEL).toBe('gpt-5.4-nano');
  });

  it('rejects gpt-4o-mini, which the original design doc wrongly named', () => {
    expect(() => parseEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-4o-mini' })).toThrow(
      /OPENAI_MODEL/,
    );
  });
});
