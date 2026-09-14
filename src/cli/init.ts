import { constants } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ConfigError } from "../config/load.js";
import { configSchema } from "../config/schema.js";

export const CONFIG_SCHEMA_URL =
  "https://unpkg.com/docgen-drift@1/schema/docgen.schema.json";

export interface InitPrompt {
  ask(question: string): Promise<string>;
}

export interface InitResult {
  readonly path: string;
  readonly projects: readonly string[];
}

export const runInit = async (
  root: string,
  prompt: InitPrompt,
): Promise<InitResult> => {
  const path = resolve(root, ".docgenrc.json");
  if (await exists(path)) {
    throw new ConfigError(`${path} already exists`);
  }

  const projects = parseProjects(
    await prompt.ask("TypeScript projects, comma-separated [tsconfig.json]: "),
  );
  const lockfile = parseLockfile(
    await prompt.ask("Lockfile mode, shared or perProject [shared]: "),
  );
  const projectConcurrency = parseConcurrency(
    await prompt.ask("Project concurrency [1]: "),
  );
  const config = {
    $schema: CONFIG_SCHEMA_URL,
    workspace: { projects, lockfile, projectConcurrency },
  };
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }

  try {
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    throw new ConfigError(
      `Cannot write ${path}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  return { path, projects };
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const parseProjects = (answer: string): string[] => {
  const projects = (answer.trim() === "" ? "tsconfig.json" : answer)
    .split(",")
    .map((project) => project.trim())
    .filter(Boolean);
  if (projects.length === 0) {
    throw new ConfigError("At least one TypeScript project is required");
  }
  return projects;
};

const parseLockfile = (answer: string): "shared" | "perProject" => {
  const lockfile = answer.trim() === "" ? "shared" : answer.trim();
  if (lockfile !== "shared" && lockfile !== "perProject") {
    throw new ConfigError("Lockfile mode must be shared or perProject");
  }
  return lockfile;
};

const parseConcurrency = (answer: string): number => {
  const value = answer.trim() === "" ? 1 : Number(answer);
  if (!Number.isInteger(value) || value < 1) {
    throw new ConfigError("Project concurrency must be a positive integer");
  }
  return value;
};
