import type { CostBasis } from "./usage.js";

export interface ModelPrice {
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
}

/**
 * Describe a model's token limits, structured-output support, and optional
 * pricing used to budget context and estimate cost.
 */
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

/**
 * Clamp the requested input-token budget to the model's usable context window while recording whether it was reduced.
 * @param requested The desired number of input tokens.
 * @param capabilities The model limits used to calculate the usable input window, including context capacity and reserved output tokens.
 * @returns A budget containing the requested amount, the effective usable amount, and whether clamping occurred.
 */
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

/**
 * Estimate the USD cost of processing the specified input and output token counts, preserving an unknown result when pricing is unavailable.
 * @param price Model pricing, or undefined when the cost cannot be estimated.
 * @param inputTokens Number of input tokens to price.
 * @param outputTokens Number of output tokens to price.
 * @returns The estimated cost in USD, or undefined when price is unavailable.
 */
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
