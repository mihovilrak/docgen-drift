import type { CostBasis } from "./usage.js";

export interface ModelPrice {
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
}

export interface ModelCapabilities {
  readonly model: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly structuredOutput: boolean;
  readonly costBasis: CostBasis;
  readonly price?: ModelPrice;
}

/**
 * Conservative defaults used when a provider cannot describe a model: the
 * smallest context window still common among hosted and local servers, and an
 * honest "unknown" cost basis rather than a fabricated zero.
 */
export const FALLBACK_CONTEXT_WINDOW_TOKENS = 8192;
export const DEFAULT_MAX_OUTPUT_TOKENS = 1200;
export const PROMPT_OVERHEAD_TOKENS = 512;

export interface ContextBudget {
  readonly requested: number;
  readonly effective: number;
  readonly reduced: boolean;
}

export const contextBudgetFor = (
  requested: number,
  capabilities: ModelCapabilities,
): ContextBudget => {
  const available =
    capabilities.contextWindowTokens -
    capabilities.maxOutputTokens -
    PROMPT_OVERHEAD_TOKENS;
  if (available <= 0) {
    throw new Error(
      `Model ${capabilities.model} has no usable input window after reserving ${String(capabilities.maxOutputTokens)} output tokens and ${String(PROMPT_OVERHEAD_TOKENS)} prompt-overhead tokens`,
    );
  }
  const effective = Math.min(requested, available);
  return { requested, effective, reduced: effective < requested };
};

export const costFromPrice = (
  price: ModelPrice | undefined,
  inputTokens: number,
  outputTokens: number,
): number | undefined =>
  price === undefined
    ? undefined
    : (inputTokens * price.inputUsdPerMillion +
        outputTokens * price.outputUsdPerMillion) /
      1_000_000;

/** Capabilities whose cost basis follows from whether a price is known. */
export const pricedCapabilities = (
  model: string,
  contextWindowTokens: number,
  maxOutputTokens: number,
  price: ModelPrice | undefined,
): ModelCapabilities => ({
  model,
  contextWindowTokens,
  maxOutputTokens,
  structuredOutput: true,
  costBasis: price === undefined ? "unknown" : "usd",
  ...(price === undefined ? {} : { price }),
});
