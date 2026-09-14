import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { format } from "prettier";
import { z } from "zod";

import { CONFIG_SCHEMA_URL } from "../src/cli/init.js";
import { configSchema } from "../src/config/schema.js";

const outputDirectory = resolve("schema");
const outputPath = resolve(outputDirectory, "docgen.schema.json");
const generated = z.toJSONSchema(configSchema, {
  target: "draft-2020-12",
});
const schema = {
  ...generated,
  $id: CONFIG_SCHEMA_URL,
  title: "docgen configuration",
  description:
    "Configuration for symbol-level TypeScript and JavaScript documentation drift detection.",
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  outputPath,
  await format(JSON.stringify(schema), { parser: "json" }),
  "utf8",
);
