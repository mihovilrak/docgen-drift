import type { CheckResult, CheckStatus } from "../core/plan.js";

export interface ReportSummary {
  readonly unchanged: number;
  readonly drifted: number;
  readonly missing: number;
  readonly orphaned: number;
}

/**
 * Tally check results into per-status counts for unchanged, drifted, missing,
 * and orphaned entries.
 * @param results All check results to count, before any filtering of reportable issues.
 */
export const summarize = (results: readonly CheckResult[]): ReportSummary => ({
  unchanged: count(results, "unchanged"),
  drifted: count(results, "drifted"),
  missing: count(results, "missing"),
  orphaned: count(results, "orphaned"),
});

/**
 * Select drifted results and optionally include missing or orphaned results according to reporting settings.
 * @param results Provide the check results to filter.
 * @param options Specify whether missing and orphaned results should be reported.
 * @returns Return the results eligible for reporting.
 */
export const reportableResults = (
  results: readonly CheckResult[],
  options: {
    readonly reportMissing: boolean;
    readonly reportOrphaned: boolean;
  },
): readonly CheckResult[] =>
  results.filter(
    (result) =>
      result.status === "drifted" ||
      (result.status === "missing" && options.reportMissing) ||
      (result.status === "orphaned" && options.reportOrphaned),
  );

/**
 * Format check outcomes as a terse human-readable report with issue lines and status counts.
 * @param results All check results used to calculate drifted, missing, orphaned, and unchanged totals.
 * @param issues Check results to list with file path, line number, status, and symbol identifier.
 * @returns A newline-terminated human-readable report containing one line per issue followed by aggregate status counts.
 */
export const renderHuman = (
  results: readonly CheckResult[],
  issues: readonly CheckResult[],
): string => {
  const lines = issues.map(
    (result) =>
      `${result.filePath}:${String(result.startLine)} ${result.status} ${result.id}`,
  );
  const summary = summarize(results);
  lines.push(
    `${String(summary.drifted)} drifted, ${String(summary.missing)} missing, ${String(summary.orphaned)} orphaned, ${String(summary.unchanged)} unchanged.`,
  );
  return `${lines.join("\n")}\n`;
};

/**
 * Serialize the check report into structured, human-readable JSON.
 * @param results Check results to include in the report's results array and summary.
 * @param issues Check results to include in the report's issues array.
 * @returns A formatted JSON string containing the summary, issues, and results.
 */
export const renderJson = (
  results: readonly CheckResult[],
  issues: readonly CheckResult[],
): string =>
  `${JSON.stringify(
    {
      summary: summarize(results),
      issues: issues.map(serializableResult),
      results: results.map(serializableResult),
    },
    null,
    2,
  )}\n`;

/**
 * Serialize the check results as an indented, newline-terminated SARIF 2.1.0 report for CLI output.
 * @param issues Provide the check results to represent as SARIF results with rule statuses, messages, source file locations, and starting lines.
 * @returns Return the formatted SARIF 2.1.0 report as a JSON string.
 */
export const renderSarif = (issues: readonly CheckResult[]): string =>
  `${JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: {
            driver: {
              name: "docgen",
              rules: ["drifted", "missing", "orphaned"].map((id) => ({
                id,
                shortDescription: { text: `Documentation ${id}` },
              })),
            },
          },
          results: issues.map((result) => ({
            ruleId: result.status,
            level: result.status === "drifted" ? "error" : "warning",
            message: { text: `${result.id} is ${result.status}` },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: result.filePath },
                  region: { startLine: result.startLine },
                },
              },
            ],
          })),
        },
      ],
    },
    null,
    2,
  )}\n`;

const serializableResult = (result: CheckResult) => ({
  id: result.id,
  status: result.status,
  filePath: result.filePath,
  startLine: result.startLine,
});

const count = (results: readonly CheckResult[], status: CheckStatus): number =>
  results.filter((result) => result.status === status).length;
