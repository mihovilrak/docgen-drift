/**
 * Cost basis for a batch of provider usage.
 *
 * `none` is the merge identity: an empty accumulator never downgrades a real
 * basis. Mixing different bases collapses to `unknown` rather than inventing a
 * number.
 */
export type CostBasis = "none" | "usd" | "subscription" | "unknown";

export interface ProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** False when a transport reports allowance use but exposes no token counts. */
  readonly tokenCountsAvailable?: boolean;
  readonly costUsd?: number;
  readonly costBasis: CostBasis;
}

export const EMPTY_USAGE: ProviderUsage = {
  inputTokens: 0,
  outputTokens: 0,
  costBasis: "none",
};

const mergeBasis = (left: CostBasis, right: CostBasis): CostBasis => {
  if (left === "none") return right;
  if (right === "none") return left;
  return left === right ? left : "unknown";
};

/**
 * Combine two usage records by summing token counts and compatible USD costs while preserving availability and cost-basis metadata.
 * @param left The first provider usage record to combine.
 * @param right The second provider usage record to combine.
 */
export const addUsage = (
  left: ProviderUsage,
  right: ProviderUsage,
): ProviderUsage => {
  const costBasis = mergeBasis(left.costBasis, right.costBasis);
  const costUsd =
    costBasis === "usd"
      ? (left.costUsd ?? 0) + (right.costUsd ?? 0)
      : undefined;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    ...((left.tokenCountsAvailable ?? true) &&
    (right.tokenCountsAvailable ?? true)
      ? {}
      : { tokenCountsAvailable: false }),
    ...(costUsd === undefined ? {} : { costUsd }),
    costBasis,
  };
};

/**
 * Represent token consumption and its monetary charge as USD-based provider usage.
 * @param inputTokens Number of tokens sent to the provider.
 * @param outputTokens Number of tokens produced by the provider.
 * @param costUsd Usage cost in US dollars.
 * @returns A provider usage record with the supplied token counts, USD cost, and USD cost basis.
 */
export const usdUsage = (
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
): ProviderUsage => ({
  inputTokens,
  outputTokens,
  costUsd,
  costBasis: "usd",
});

export const formatCost = (usage: ProviderUsage): string => {
  switch (usage.costBasis) {
    case "none":
      return "no model calls";
    case "usd":
      return `$${(usage.costUsd ?? 0).toFixed(6)}`;
    case "subscription":
      return "subscription allowance (no monetary cost available)";
    case "unknown":
      return "cost unavailable";
  }
};
