import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { indexWorkspace } from "../src/cli/workspace.js";
import { configSchema } from "../src/config/schema.js";

describe("symbol opt-outs", () => {
  it(
    "honors ignore pragmas, @internal, and configured path excludes",
    { timeout: 15_000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "docgen-policy-"));
      await mkdir(join(root, "src/generated"), { recursive: true });
      await writeFile(
        join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { strict: true },
          include: ["src/**/*.ts"],
        }),
        "utf8",
      );
      await writeFile(
        join(root, "src/index.ts"),
        [
          "/** Kept. */",
          "export function kept(): void { console.log('kept'); }",
          "// @docgen-ignore",
          "export function ignored(): void { console.log('ignored'); }",
          "/** @internal */",
          "export function internal(): void { console.log('internal'); }",
          "/** @internal */",
          "export class InternalService {",
          "  run(): void { console.log('internal method'); }",
          "}",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        join(root, "src/generated/output.ts"),
        "/** Generated. */\nexport function generated(): void {}\n",
        "utf8",
      );
      const config = configSchema.parse({
        exclude: ["src/generated/**"],
        symbols: { minBodyLines: 0 },
      });

      const projects = await indexWorkspace(root, config);
      expect(
        projects.flatMap(({ eligible }) => eligible.map(({ name }) => name)),
      ).toEqual(["kept"]);
      expect(
        projects.flatMap(({ symbols }) => symbols.map(({ name }) => name)),
      ).not.toContain("generated");
    },
  );
});
