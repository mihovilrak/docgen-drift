import { formatCost } from "../llm/usage.js";
import type { GenerationEstimate, GenerationRunResult } from "./generate.js";

/**
 * Format generation results, optional dry-run diffs, per-item issues, file counts, and usage information as CLI output.
 * @param result Generation results to summarize, including generated, skipped, rejected, failed, changed-file, diff, and usage data.
 * @param dryRun Whether to include a non-empty generated diff in the output.
 * @returns A newline-terminated human-readable summary string.
 */
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
    `${String(result.generated.length)} generated, ${String(result.skipped.length)} skipped, ${String(result.rejected.length)} rejected, ${String(result.failed.length)} failed in ${String(result.changedFiles)} ${plural(result.changedFiles, "file")}; ${renderUsage(result.usage)}.`,
  );
  return `${details.join("\n")}\n`;
};

/**
 * Format a human-readable estimate of token usage, cost, judge inclusion, retries, and any reduced context budget.
 * @param estimate Generation estimate containing symbol, token, cost, judge, and context-budget information.
 */
export const renderEstimate = (estimate: GenerationEstimate): string => {
  const budget = estimate.contextBudgetReduced
    ? ` Context budget reduced to ${String(estimate.contextBudgetTokens)} tokens to fit the generation model window.`
    : "";
  return `Estimated LLM use for ${String(estimate.symbols)} ${plural(estimate.symbols, "symbol")}: ${String(estimate.inputTokens)} input tokens, ${String(estimate.outputTokens)} output tokens, ${estimatedCost(estimate)}${estimate.includesJudge ? ", including the judge" : ""}; retries not included.${budget}${estimate.selfJudged ? " The judge uses the generation model; a different judge model catches more." : ""}\n`;
};

const renderUsage = (usage: GenerationRunResult["usage"]): string =>
  usage.tokenCountsAvailable === false
    ? `token counts unavailable, ${formatCost(usage)}`
    : `${String(usage.inputTokens)} input tokens, ${String(usage.outputTokens)} output tokens, ${formatCost(usage)}`;

const plural = (count: number, noun: string): string =>
  count === 1 ? noun : `${noun}s`;

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
