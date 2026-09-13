import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("docgen extract", () => {
  it("dumps the symbol table as JSON", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "extract",
        "test/fixtures/typescript",
        "--json",
      ],
      { cwd: process.cwd() },
    );
    const output: unknown = JSON.parse(stdout);

    expect(stderr).toBe("");
    expect(Array.isArray(output)).toBe(true);
    expect(output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "arrowFunction",
          kind: "variable-function",
        }),
      ]),
    );
  });
});
