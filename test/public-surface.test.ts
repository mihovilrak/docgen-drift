import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { configSchema } from "../src/config/schema.js";
import { indexWorkspace } from "../src/cli/workspace.js";

const fixtureRoot = resolve("test/fixtures/public-surface");

describe("entry-point public surface", () => {
  it("includes re-exported declarations and their public members", async () => {
    const [project] = await indexWorkspace(
      fixtureRoot,
      configSchema.parse({
        symbols: {
          publicSurface: "entryPoints",
          entryPoints: ["src/index.ts"],
          minBodyLines: 0,
          visibility: ["public", "private"],
        },
      }),
    );

    expect(project?.eligible.map((symbol) => symbol.id).sort()).toEqual([
      "src/public.ts#Service",
      "src/public.ts#Service.run",
      "src/public.ts#publicApi",
    ]);
  });

  it("retains syntactic-export policy explicitly", async () => {
    const [project] = await indexWorkspace(
      fixtureRoot,
      configSchema.parse({ symbols: { minBodyLines: 0 } }),
    );

    expect(project?.eligible.map((symbol) => symbol.id)).toContain(
      "src/internal.ts#internalHelper",
    );
  });

  it("fails when configured entry points match no source files", async () => {
    await expect(
      indexWorkspace(
        fixtureRoot,
        configSchema.parse({
          symbols: {
            publicSurface: "entryPoints",
            entryPoints: ["src/missing.ts"],
          },
        }),
      ),
    ).rejects.toThrow(/did not match any source files/u);
  });
});
