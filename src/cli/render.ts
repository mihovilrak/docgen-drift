import { formatCost } from "../llm/usage.js";
import type { GenerationEstimate, GenerationRunResult } from "./generate.js";

export const renderGeneration = (
  result: GenerationRunResult,
  dryRun: boolean,
): string => {
  const details = [
    ...result.skipped.map((item) => `${item.id} skipped: ${item.reason}`),
    ...result.rejected.map((item) => `${item.id} rejected: ${item.reason}`),
    ...result.failed.map((item) => `${item.id} failed: ${item.reason}`),
  ];
  if (dryRun && result.diff !== "") details.push(result.diff);
  details.push(
    `${String(result.generated.length)} generated, ${String(result.skipped.length)} skipped, ${String(result.rejected.length)} rejected, ${String(result.failed.length)} failed in ${String(result.changedFiles)} files; ${String(result.usage.inputTokens)} input tokens, ${String(result.usage.outputTokens)} output tokens, ${formatCost(result.usage)}.`,
  );
  return `${details.join("\n")}\n`;
};

export const renderEstimate = (estimate: GenerationEstimate): string => {
  const budget = estimate.contextBudgetReduced
    ? ` Context budget reduced to ${String(estimate.contextBudgetTokens)} tokens to fit the generation model window.`
    : "";
  return `Estimated LLM use for ${String(estimate.symbols)} symbols: ${String(estimate.inputTokens)} input tokens, ${String(estimate.outputTokens)} output tokens, ${estimatedCost(estimate)}${estimate.includesJudge ? ", including the judge" : ""}; retries not included.${budget}\n`;
};

/** Never prints a monetary figure the configured provider cannot support. */
const estimatedCost = (estimate: GenerationEstimate): string => {
  switch (estimate.costBasis) {
    case "usd":
      return `approximately $${(estimate.costUsd ?? 0).toFixed(4)}`;
    case "subscription":
      return "drawn from a subscription allowance, no monetary cost available";
    case "none":
      return "no model calls";
    case "unknown":
      return "cost unavailable for the configured model";
  }
};
