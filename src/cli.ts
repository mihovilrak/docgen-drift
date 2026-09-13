#!/usr/bin/env node

import { resolve } from "node:path";

import { cac } from "cac";

import { ConfigError, loadConfig } from "./config/load.js";
import { checkExitCode, errorExitCode } from "./cli/errors.js";
import { filterByChanges, readChangedFiles } from "./cli/since.js";
import { runBaseline, runCheck } from "./cli/run.js";
import { VERSION } from "./index.js";
import {
  renderHuman,
  renderJson,
  renderSarif,
  reportableResults,
} from "./report/index.js";

interface CommonOptions {
  readonly config?: string;
}

interface ExtractCommandOptions extends CommonOptions {
  readonly json?: boolean;
  readonly includeVariables?: boolean;
}

interface CheckCommandOptions extends CommonOptions {
  readonly json?: boolean;
  readonly sarif?: boolean;
  readonly since?: string;
}

interface ExplainCommandOptions extends CommonOptions {
  readonly json?: boolean;
}

const commandRoot = (root: unknown): string =>
  resolve(typeof root === "string" ? root : ".");

const cli = cac("docgen");

cli
  .command("extract [root]", "Dump the TypeScript symbol index")
  .option("--json", "Print machine-readable JSON")
  .option("--config <path>", "Path to .docgenrc.json")
  .option("--include-variables", "Include exported non-function variables")
  .action(async (root: unknown, options: ExtractCommandOptions) => {
    const workspaceRoot = commandRoot(root);
    const config = await loadConfig(workspaceRoot, options.config);
    const [{ extractSymbols }, { loadWorkspace }] = await Promise.all([
      import("./adapters/typescript/extract/index.js"),
      import("./adapters/typescript/loadWorkspace.js"),
    ]);
    const symbols = (
      await loadWorkspace(
        {
          root: workspaceRoot,
          projects: config.workspace.projects,
          projectConcurrency: config.workspace.projectConcurrency,
          include: [...config.include, ...config.tests],
          exclude: config.exclude,
        },
        (project) =>
          extractSymbols(project, {
            includeNonFunctionVariables:
              options.includeVariables === true ||
              config.symbols.kinds.includes("variable"),
          }),
      )
    ).flat();

    process.stdout.write(
      options.json === true
        ? `${JSON.stringify(symbols, null, 2)}\n`
        : `Extracted ${String(symbols.length)} symbols.\n`,
    );
  });

cli
  .command("explain <symbol> [root]", "Print assembled context for one symbol")
  .option("--config <path>", "Path to .docgenrc.json")
  .option("--json", "Print context metadata as JSON")
  .action(
    async (symbol: string, root: unknown, options: ExplainCommandOptions) => {
      const workspaceRoot = commandRoot(root);
      const config = await loadConfig(workspaceRoot, options.config);
      const { runExplain } = await import("./cli/explain.js");
      const result = await runExplain(workspaceRoot, symbol, config);
      process.stdout.write(
        options.json === true
          ? `${JSON.stringify(result, null, 2)}\n`
          : `${result.text}\n`,
      );
    },
  );

cli
  .command("baseline [root]", "Record the current documentation state")
  .option("--config <path>", "Path to .docgenrc.json")
  .action(async (root: unknown, options: CommonOptions) => {
    const workspaceRoot = commandRoot(root);
    const config = await loadConfig(workspaceRoot, options.config);
    const result = await runBaseline(workspaceRoot, config);
    process.stdout.write(
      `Baselined ${String(result.symbols)} symbols in ${String(result.lockfiles.length)} lockfile${result.lockfiles.length === 1 ? "" : "s"}.\n`,
    );
  });

cli
  .command("check [root]", "Check documented symbols for drift")
  .option("--config <path>", "Path to .docgenrc.json")
  .option("--json", "Print machine-readable JSON")
  .option("--sarif", "Print SARIF 2.1.0")
  .option("--since <ref>", "Restrict to symbols touched since a Git ref")
  .action(async (root: unknown, options: CheckCommandOptions) => {
    if (options.json === true && options.sarif === true) {
      throw new ConfigError("--json and --sarif cannot be used together");
    }
    const workspaceRoot = commandRoot(root);
    const config = await loadConfig(workspaceRoot, options.config);
    let { results } = await runCheck(workspaceRoot, config);
    if (options.since !== undefined) {
      results = filterByChanges(
        results,
        await readChangedFiles(workspaceRoot, options.since),
      );
    }
    const issues = reportableResults(results, config.check);
    process.stdout.write(
      options.sarif === true
        ? renderSarif(issues)
        : options.json === true
          ? renderJson(results, issues)
          : renderHuman(results, issues),
    );
    process.exitCode = checkExitCode(issues.length);
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
  process.exitCode = errorExitCode(error);
}
