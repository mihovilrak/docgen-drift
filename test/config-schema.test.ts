import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CONFIG_SCHEMA_URL } from "../src/cli/init.js";

describe("published config schema", () => {
  it("ships a strict JSON Schema with config defaults", async () => {
    const schema = JSON.parse(
      await readFile(resolve("schema/docgen.schema.json"), "utf8"),
    ) as {
      readonly $id: string;
      readonly additionalProperties: boolean;
      readonly properties: Readonly<Record<string, unknown>>;
    };

    expect(schema.$id).toBe(CONFIG_SCHEMA_URL);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).toHaveProperty("workspace");
    expect(schema.properties).toHaveProperty("generate");
    expect(schema.properties).toHaveProperty("judge");
  });

  it("includes the schema artifact in the npm package", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    ) as { readonly files: readonly string[] };

    expect(packageJson.files).toContain("schema");
  });
});
