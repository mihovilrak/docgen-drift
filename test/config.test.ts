import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config/load.js";

describe("configuration", () => {
  it("applies Phase 2 defaults and rejects unknown policy fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "docgen-config-"));
    await expect(loadConfig(root)).resolves.toMatchObject({
      workspace: { lockfile: "shared", projectConcurrency: 1 },
      symbols: {
        exportedOnly: true,
        ignorePragmas: ["@docgen-ignore", "@internal"],
      },
      check: { reportMissing: false, reportOrphaned: true },
    });

    await writeFile(
      join(root, ".docgenrc.json"),
      JSON.stringify({ check: { reportMissng: true } }),
      "utf8",
    );
    await expect(loadConfig(root)).rejects.toBeInstanceOf(ConfigError);
  });
});
