#!/usr/bin/env node

import { resolve } from "node:path";

import { cac } from "cac";

import { ConfigError, loadConfig } from "./config/load.js";
import { checkExitCode, errorExitCode } from "./cli/errors.js";
import { filterByChanges, readChangedFiles } from "./cli/since.js";
import { runBaseline, runCheck } from "./cli/run.js";
import { scopeProjects } from "./cli/projectScope.js";
import type { GenerationRunResult } from "./cli/generate.js";
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
  readonly fix?: boolean;
  readonly project?: string;
  readonly dryRun?: boolean;
  readonly allowDirty?: boolean;
}

interface ExplainCommandOptions extends CommonOptions {
  readonly json?: boolean;
}

interface FixCommandOptions extends CommonOptions {
  readonly missing?: boolean;
  readonly path?: string;
  readonly project?: string;
  readonly dryRun?: boolean;
  readonly allowDirty?: boolean;
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
  .option("--project <path-or-glob>", "Restrict to matching tsconfig projects")
  .option("--fix", "Regenerate drifted documentation")
  .option("--dry-run", "Print the source diff without writing")
  .option("--allow-dirty", "Allow source writes with uncommitted changes")
  .action(async (root: unknown, options: CheckCommandOptions) => {
    if (options.json === true && options.sarif === true) {
      throw new ConfigError("--json and --sarif cannot be used together");
    }
    const workspaceRoot = commandRoot(root);
    const loaded = await loadConfig(workspaceRoot, options.config);
    const config = scopeProjects(loaded, options.project);
    if (options.fix === true) {
      if (options.sarif === true) {
        throw new ConfigError("--sarif cannot be combined with --fix");
      }
      if (options.since !== undefined) {
        throw new ConfigError("--since cannot be combined with --fix");
      }
      const { runGeneration } = await import("./cli/generate.js");
      const result = await runGeneration(workspaceRoot, config, {
        mode: "drifted",
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
        ...(options.allowDirty === undefined
          ? {}
          : { allowDirty: options.allowDirty }),
      });
      process.stdout.write(
        options.json === true
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderGeneration(result, options.dryRun === true),
      );
      process.exitCode = result.failed.length === 0 ? 0 : 1;
      return;
    }
    if (options.dryRun === true || options.allowDirty === true) {
      throw new ConfigError("--dry-run and --allow-dirty require --fix");
    }
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

cli
  .command("fix [root]", "Generate missing documentation in a bounded path")
  .option("--missing", "Generate documentation for missing symbols")
  .option("--path <path>", "Restrict backfill to this path")
  .option("--project <path-or-glob>", "Restrict to matching tsconfig projects")
  .option("--dry-run", "Print the source diff without writing")
  .option("--allow-dirty", "Allow source writes with uncommitted changes")
  .option("--json", "Print machine-readable JSON")
  .option("--config <path>", "Path to .docgenrc.json")
  .action(async (root: unknown, options: FixCommandOptions) => {
    if (options.missing !== true) {
      throw new ConfigError("fix currently requires --missing");
    }
    const workspaceRoot = commandRoot(root);
    const loaded = await loadConfig(workspaceRoot, options.config);
    const config = scopeProjects(loaded, options.project);
    const { runGeneration } = await import("./cli/generate.js");
    const result = await runGeneration(workspaceRoot, config, {
      mode: "missing",
      ...(options.path === undefined ? {} : { path: options.path }),
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      ...(options.allowDirty === undefined
        ? {}
        : { allowDirty: options.allowDirty }),
    });
    process.stdout.write(
      options.json === true
        ? `${JSON.stringify(result, null, 2)}\n`
        : renderGeneration(result, options.dryRun === true),
    );
    process.exitCode = result.failed.length === 0 ? 0 : 1;
  });

const renderGeneration = (
  result: GenerationRunResult,
  dryRun: boolean,
): string => {
  const details = [
    ...result.skipped.map((item) => `${item.id} skipped: ${item.reason}`),
    ...result.failed.map((item) => `${item.id} failed: ${item.reason}`),
  ];
  if (dryRun && result.diff !== "") details.push(result.diff);
  details.push(
    `${String(result.generated.length)} generated, ${String(result.skipped.length)} skipped, ${String(result.failed.length)} failed in ${String(result.changedFiles)} files; ${String(result.usage.inputTokens)} input tokens, ${String(result.usage.outputTokens)} output tokens, $${result.usage.costUsd.toFixed(6)}.`,
  );
  return `${details.join("\n")}\n`;
};

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
