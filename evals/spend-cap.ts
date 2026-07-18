import { z } from 'zod';

// Per-million-token rates are an estimate, not a quoted price list, and they exist so
// the cap can be expressed in dollars rather than tokens. Override them with
// EVAL_INPUT_USD_PER_MTOK / EVAL_OUTPUT_USD_PER_MTOK if the real rates differ; the cap
// itself is enforced on whatever numbers are configured, so a wrong rate makes the cap
// wrong, never absent.
const DEFAULT_INPUT_USD_PER_MILLION_TOKENS = 0.25;
const DEFAULT_OUTPUT_USD_PER_MILLION_TOKENS = 2.0;
const DEFAULT_SPEND_CAP_USD = 0.5;
const TOKENS_PER_MILLION = 1_000_000;

const usageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
});

export class SpendCapExceededError extends Error {
  public constructor(spentUsd: number, capUsd: number) {
    super(
      `Eval spend cap reached before this call could run (spent: $${spentUsd.toFixed(4)}, cap: $${capUsd.toFixed(4)}). Raise EVAL_SPEND_CAP_USD to continue.`,
    );
    this.name = 'SpendCapExceededError';
  }
}

export class SpendCap {
  private readonly capUsd: number;
  private readonly inputUsdPerMillionTokens: number;
  private readonly outputUsdPerMillionTokens: number;
  private inputTokens = 0;
  private outputTokens = 0;
  private calls = 0;

  public constructor(source: Record<string, string | undefined>) {
    this.capUsd = readPositiveNumber(
      source.EVAL_SPEND_CAP_USD,
      DEFAULT_SPEND_CAP_USD,
      'EVAL_SPEND_CAP_USD',
    );
    this.inputUsdPerMillionTokens = readPositiveNumber(
      source.EVAL_INPUT_USD_PER_MTOK,
      DEFAULT_INPUT_USD_PER_MILLION_TOKENS,
      'EVAL_INPUT_USD_PER_MTOK',
    );
    this.outputUsdPerMillionTokens = readPositiveNumber(
      source.EVAL_OUTPUT_USD_PER_MTOK,
      DEFAULT_OUTPUT_USD_PER_MILLION_TOKENS,
      'EVAL_OUTPUT_USD_PER_MTOK',
    );
  }

  public assertBudgetRemains(): void {
    if (this.spentUsd() >= this.capUsd) {
      throw new SpendCapExceededError(this.spentUsd(), this.capUsd);
    }
  }

  public record(usage: unknown): void {
    const parsed = usageSchema.safeParse(usage);
    this.calls += 1;
    if (!parsed.success) {
      return;
    }

    this.inputTokens += parsed.data.inputTokens ?? 0;
    this.outputTokens += parsed.data.outputTokens ?? 0;
  }

  public spentUsd(): number {
    const inputCost = (this.inputTokens / TOKENS_PER_MILLION) * this.inputUsdPerMillionTokens;
    const outputCost = (this.outputTokens / TOKENS_PER_MILLION) * this.outputUsdPerMillionTokens;

    return inputCost + outputCost;
  }

  public summary(): string {
    return [
      `model calls: ${this.calls}`,
      `tokens: ${this.inputTokens} in / ${this.outputTokens} out`,
      `estimated spend: $${this.spentUsd().toFixed(4)} of a $${this.capUsd.toFixed(2)} cap`,
    ].join(' · ');
  }
}

function readPositiveNumber(
  rawValue: string | undefined,
  fallback: number,
  variableName: string,
): number {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive number (received: ${rawValue})`);
  }

  return parsed;
}
