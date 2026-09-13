import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("docgen explain", () => {
  it("prints the exact assembled context for one symbol", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "explain",
        "orchestrate",
        "test/fixtures/graph",
        "--json",
      ],
      { cwd: process.cwd() },
    );
    const output = JSON.parse(stdout) as {
      readonly text: string;
      readonly tokenCount: number;
      readonly tokenBudget: number;
    };

    expect(stderr).toBe("");
    expect(output.text).toContain("SIGNATURE: function orchestrate");
    expect(output.text).toContain("TEST: payment conversion");
    expect(output.text).toContain("REFERENCED TYPE (fields only)");
    expect(output.tokenCount).toBeLessThanOrEqual(output.tokenBudget);
  });
});
