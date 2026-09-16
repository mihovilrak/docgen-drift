import { formatCost } from "../llm/usage.js";
import type { GenerationEstimate, GenerationRunResult } from "./generate.js";

/**
 * Format generation outcomes, optional dry-run changes, counts, and usage into a CLI report.
 * @param result Generation results containing per-symbol statuses, changed-file counts, usage data, and an optional diff.
 * @param dryRun Whether to include a non-empty generated diff in the report.
 * @returns A newline-terminated human-readable generation report.
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
 * Report estimated generation usage, cost basis, judge inclusion, retry scope, and any reduced context budget.
 * @param estimate Generation estimate containing symbol counts, token totals, pricing information, judge inclusion, and context-budget status.
 * @returns A newline-terminated human-readable estimate report.
 */
export const renderEstimate = (estimate: GenerationEstimate): string => {
  const budget = estimate.contextBudgetReduced
    ? ` Context budget reduced to ${String(estimate.contextBudgetTokens)} tokens to fit the generation model window.`
    : "";
  return `Estimated LLM use for ${String(estimate.symbols)} ${plural(estimate.symbols, "symbol")}: ${String(estimate.inputTokens)} input tokens, ${String(estimate.outputTokens)} output tokens, ${estimatedCost(estimate)}${estimate.includesJudge ? ", including the judge" : ""}; retries not included.${budget}\n`;
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
