import { describe, expect, it } from "vitest";

import type { CheckResult } from "../src/core/plan.js";
import {
  renderHuman,
  renderJson,
  renderSarif,
  reportableResults,
} from "../src/report/index.js";

const result = (status: CheckResult["status"]): CheckResult => ({
  id: `src/api.ts#${status}`,
  status,
  filePath: "src/api.ts",
  startLine: 4,
});

const results: readonly CheckResult[] = [
  result("unchanged"),
  result("drifted"),
  result("missing"),
  result("orphaned"),
];

describe("check reporters", () => {
  it("renders terse human and structured JSON output", () => {
    const issues = reportableResults(results, {
      reportMissing: false,
      reportOrphaned: true,
    });
    expect(issues.map(({ status }) => status)).toEqual(["drifted", "orphaned"]);
    expect(renderHuman(results, issues)).toContain(
      "1 drifted, 1 missing, 1 orphaned, 1 unchanged.",
    );
    expect(JSON.parse(renderJson(results, issues))).toMatchObject({
      summary: { drifted: 1, missing: 1, orphaned: 1, unchanged: 1 },
      issues: [{ status: "drifted" }, { status: "orphaned" }],
    });
  });

  it("emits SARIF 2.1.0 locations", () => {
    expect(JSON.parse(renderSarif([result("drifted")]))).toMatchObject({
      version: "2.1.0",
      runs: [
        {
          results: [
            {
              ruleId: "drifted",
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/api.ts" },
                    region: { startLine: 4 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });
});
