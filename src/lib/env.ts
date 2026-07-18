import { z } from 'zod';

// The assignment restricts model access to these two. gpt-4o-mini appears in the
// original design doc but is not permitted, so the schema rejects it outright.
export const ALLOWED_MODELS = ['gpt-5.4-mini', 'gpt-5.4-nano'] as const;

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.enum(ALLOWED_MODELS).default('gpt-5.4-mini'),
  MASTRA_TELEMETRY_DISABLED: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration (${issues.join('; ')})`);
  }
  return result.data;
}

export function getEnv(): Env {
  return parseEnv(process.env);
}
