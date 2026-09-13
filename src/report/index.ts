import type { CheckResult, CheckStatus } from "../core/plan.js";

export interface ReportSummary {
  readonly unchanged: number;
  readonly drifted: number;
  readonly missing: number;
  readonly orphaned: number;
}

export const summarize = (results: readonly CheckResult[]): ReportSummary => ({
  unchanged: count(results, "unchanged"),
  drifted: count(results, "drifted"),
  missing: count(results, "missing"),
  orphaned: count(results, "orphaned"),
});

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
