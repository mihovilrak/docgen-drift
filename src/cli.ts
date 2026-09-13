#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { cac } from "cac";

import { VERSION } from "./index.js";

const cli = cac("docgen");

interface ExtractCommandOptions {
  readonly json?: boolean;
  readonly config?: string;
  readonly includeVariables?: boolean;
}

interface DocgenConfig {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly tests?: readonly string[];
  readonly workspace?: {
    readonly projects?: readonly string[];
    readonly projectConcurrency?: number;
  };
  readonly symbols?: {
    readonly kinds?: readonly string[];
  };
}

const loadConfig = async (
  root: string,
  configuredPath: string | undefined,
): Promise<DocgenConfig> => {
  const configPath = resolve(root, configuredPath ?? ".docgenrc.json");
  if (configuredPath === undefined) {
    try {
      await access(configPath);
    } catch {
      return {};
    }
  }

  const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${configPath} must contain a JSON object`);
  }
  return parsed;
};

cli
  .command("extract [root]", "Dump the TypeScript symbol index")
  .option("--json", "Print machine-readable JSON")
  .option("--config <path>", "Path to .docgenrc.json")
  .option(
    "--include-variables",
    "Include exported non-function variable declarations",
  )
  .action(async (root: unknown, options: ExtractCommandOptions) => {
    const workspaceRoot = resolve(typeof root === "string" ? root : ".");
    const config = await loadConfig(workspaceRoot, options.config);
    const includeNonFunctionVariables =
      options.includeVariables === true ||
      config.symbols?.kinds?.includes("variable") === true;
    const includes = [...(config.include ?? []), ...(config.tests ?? [])];
    const [{ extractSymbols }, { loadProject }, { loadWorkspace }] =
      await Promise.all([
        import("./adapters/typescript/extract/index.js"),
        import("./adapters/typescript/loadProject.js"),
        import("./adapters/typescript/loadWorkspace.js"),
      ]);

    const projectPatterns = config.workspace?.projects;
    const symbols =
      projectPatterns === undefined
        ? extractSymbols(
            await loadProject({
              tsconfigPath: workspaceRoot,
              ...(includes.length === 0 ? {} : { include: includes }),
              ...(config.exclude === undefined
                ? {}
                : { exclude: config.exclude }),
            }),
            { includeNonFunctionVariables },
          )
        : (
            await loadWorkspace(
              {
                root: workspaceRoot,
                projects: projectPatterns,
                ...(includes.length === 0 ? {} : { include: includes }),
                ...(config.exclude === undefined
                  ? {}
                  : { exclude: config.exclude }),
                ...(config.workspace?.projectConcurrency === undefined
                  ? {}
                  : {
                      projectConcurrency: config.workspace.projectConcurrency,
                    }),
              },
              (project) =>
                extractSymbols(project, { includeNonFunctionVariables }),
            )
          ).flat();

    if (options.json === true) {
      process.stdout.write(`${JSON.stringify(symbols, null, 2)}\n`);
      return;
    }

    process.stdout.write(`Extracted ${String(symbols.length)} symbols.\n`);
  });

cli.help();
cli.version(VERSION);

try {
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Unknown internal error"}\n`,
  );
  process.exitCode = 2;
}
