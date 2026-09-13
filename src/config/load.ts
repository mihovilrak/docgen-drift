import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { configSchema, type DocgenConfig } from "./schema.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const loadConfig = async (
  root: string,
  configuredPath?: string,
): Promise<DocgenConfig> => {
  const path = resolve(root, configuredPath ?? ".docgenrc.json");
  if (configuredPath === undefined) {
    try {
      await access(path);
    } catch {
      return configSchema.parse({});
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new ConfigError(
      `Cannot read ${path}: ${error instanceof Error ? error.message : "invalid JSON"}`,
    );
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(
      `Invalid configuration in ${path}: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
};
