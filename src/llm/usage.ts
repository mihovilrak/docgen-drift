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
