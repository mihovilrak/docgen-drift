import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { cac, type CAC } from "cac";

import { ConfigError, loadConfig } from "../config/load.js";
import { filterByChanges, readChangedFiles } from "./since.js";
import { runBaseline, runCheck } from "./run.js";
import { checkExitCode } from "./errors.js";
import {
  assertCompatibleLoggingOptions,
  CONFIG,
  FIX,
  GENERATION,
  INCLUDE_VARIABLES,
  JSON_OUTPUT,
  MISSING,
  PATH,
  PROJECT,
  SARIF,
  SINCE,
  withOptions,
} from "./options.js";
import { applyGenerationOverrides } from "./overrides.js";
import { scopeProjects } from "./projectScope.js";
import { renderEstimate, renderGeneration } from "./render.js";
import { createGenerationProgressReporter } from "./progress.js";
import type {
  GenerationEstimate,
  GenerationProgressEvent,
  GenerationRunResult,
} from "./generate.js";
import { VERSION } from "../index.js";
import {
  renderHuman,
  renderJson,
  renderSarif,
  reportableResults,
} from "../report/index.js";

interface CommonOptions {
  readonly config?: string;
}

interface JsonOptions extends CommonOptions {
  readonly json?: boolean;
}

interface ExtractCommandOptions extends JsonOptions {
  readonly includeVariables?: boolean;
}

/** cac names a negated flag after the positive form: `--no-judge` sets `judge` to false. */
interface GenerationCommandOptions extends JsonOptions {
  readonly project?: string;
  readonly dryRun?: boolean;
  readonly allowDirty?: boolean;
  readonly judge?: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly verbose?: boolean;
  readonly quiet?: boolean;
}

interface CheckCommandOptions extends GenerationCommandOptions {
  readonly sarif?: boolean;
  readonly since?: string;
  readonly fix?: boolean;
}

interface FixCommandOptions extends GenerationCommandOptions {
  readonly missing?: boolean;
  readonly path?: string;
}

const commandRoot = (root: unknown): string =>
  resolve(typeof root === "string" ? root : ".");

const generationOptions = (
  options: GenerationCommandOptions,
): {
  readonly dryRun?: boolean;
  readonly allowDirty?: boolean;
  readonly noJudge?: boolean;
} => ({
  ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
  ...(options.allowDirty === undefined
    ? {}
    : { allowDirty: options.allowDirty }),
  ...(options.judge === false ? { noJudge: true } : {}),
});

const overrides = (
  options: GenerationCommandOptions,
): { readonly provider?: string; readonly model?: string } => ({
  ...(options.provider === undefined ? {} : { provider: options.provider }),
  ...(options.model === undefined ? {} : { model: options.model }),
});

const requireFix = (options: CheckCommandOptions): void => {
  if (
    options.dryRun === true ||
    options.allowDirty === true ||
    options.judge === false ||
    options.verbose === true ||
    options.quiet === true
  ) {
    throw new ConfigError(
      "--dry-run, --allow-dirty, --no-judge, --verbose, and --quiet require --fix",
    );
  }
  if (options.provider !== undefined || options.model !== undefined) {
    throw new ConfigError("--provider and --model require --fix");
  }
};

const runFix = async (
  root: unknown,
  options: FixCommandOptions | CheckCommandOptions,
  mode: "drifted" | "missing",
  path: string | undefined,
): Promise<void> => {
  assertCompatibleLoggingOptions(options);
  const workspaceRoot = commandRoot(root);
  const loaded = await loadConfig(workspaceRoot, options.config);
  const config = scopeProjects(loaded, options.project);
  const { runGeneration } = await import("./generate.js");
  let reporter: ReturnType<typeof createGenerationProgressReporter> | undefined;
  const onEstimate = (estimate: GenerationEstimate): void => {
    process.stderr.write(renderEstimate(estimate));
    reporter = createGenerationProgressReporter(
      estimate.symbols,
      options.verbose === true,
    );
  };
  const onProgress = (event: GenerationProgressEvent): void => {
    reporter?.update(event);
  };
  let result: GenerationRunResult;
  try {
    result = await runGeneration(
      workspaceRoot,
      applyGenerationOverrides(config, overrides(options)),
      {
        mode,
        ...(path === undefined ? {} : { path }),
        ...generationOptions(options),
        ...(options.quiet === true ? {} : { onEstimate, onProgress }),
      },
    );
  } finally {
    reporter?.finish();
  }
  process.stdout.write(
    options.json === true
      ? `${JSON.stringify(result, null, 2)}\n`
      : renderGeneration(result, options.dryRun === true),
  );
  process.exitCode = result.failed.length === 0 ? 0 : 1;
};

/**
 * Assemble the docgen command-line interface with its commands and options.
 * @returns The configured CAC command-line program.
 */
export const createProgram = (): CAC => {
  const cli = cac("docgen");

  cli
    .command("init [root]", "Create an interactive .docgenrc.json")
    .action(async (root: unknown) => {
      const workspaceRoot = commandRoot(root);
      const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        const { runInit } = await import("./init.js");
        const result = await runInit(workspaceRoot, {
          ask: (question) => readline.question(question),
        });
        process.stdout.write(
          `Created ${result.path} for ${String(result.projects.length)} project${result.projects.length === 1 ? "" : "s"}.\n`,
        );
      } finally {
        readline.close();
      }
    });

  withOptions(
    cli.command("extract [root]", "Dump the TypeScript symbol index"),
    JSON_OUTPUT,
    CONFIG,
    INCLUDE_VARIABLES,
  ).action(async (root: unknown, options: ExtractCommandOptions) => {
    const workspaceRoot = commandRoot(root);
    const config = await loadConfig(workspaceRoot, options.config);
    const [{ extractSymbols }, { loadWorkspace }] = await Promise.all([
      import("../adapters/typescript/extract/index.js"),
      import("../adapters/typescript/loadWorkspace.js"),
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

  withOptions(
    cli.command(
      "explain <symbol> [root]",
      "Print assembled context for one symbol",
    ),
    CONFIG,
    JSON_OUTPUT,
  ).action(async (symbol: string, root: unknown, options: JsonOptions) => {
    const workspaceRoot = commandRoot(root);
    const config = await loadConfig(workspaceRoot, options.config);
    const { runExplain } = await import("./explain.js");
    const result = await runExplain(workspaceRoot, symbol, config);
    process.stdout.write(
      options.json === true
        ? `${JSON.stringify(result, null, 2)}\n`
        : `${result.text}\n`,
    );
  });

  withOptions(
    cli.command(
      "providers [root]",
      "Show configured providers, models and limits",
    ),
    CONFIG,
    JSON_OUTPUT,
  ).action(async (root: unknown, options: JsonOptions) => {
    const workspaceRoot = commandRoot(root);
    const config = await loadConfig(workspaceRoot, options.config);
    const { inspectProviders, renderProviders } = await import("./inspect.js");
    const inspections = inspectProviders(config);
    process.stdout.write(
      options.json === true
        ? `${JSON.stringify(inspections, null, 2)}\n`
        : renderProviders(inspections),
    );
  });

  withOptions(
    cli.command(
      "auth [root]",
      "Check provider credentials without calling a model",
    ),
    CONFIG,
    JSON_OUTPUT,
  ).action(async (root: unknown, options: JsonOptions) => {
    const workspaceRoot = commandRoot(root);
    const config = await loadConfig(workspaceRoot, options.config);
    const { inspectProviders, preflightProviders, renderPreflight } =
      await import("./inspect.js");
    const results = await preflightProviders(inspectProviders(config));
    process.stdout.write(
      options.json === true
        ? `${JSON.stringify(results, null, 2)}\n`
        : renderPreflight(results),
    );
    process.exitCode = results.every((result) => result.ok) ? 0 : 2;
  });

  withOptions(
    cli.command("baseline [root]", "Record the current documentation state"),
    CONFIG,
  ).action(async (root: unknown, options: CommonOptions) => {
    const workspaceRoot = commandRoot(root);
    const config = await loadConfig(workspaceRoot, options.config);
    const result = await runBaseline(workspaceRoot, config);
    process.stdout.write(
      `Baselined ${String(result.symbols)} symbols in ${String(result.lockfiles.length)} lockfile${result.lockfiles.length === 1 ? "" : "s"}.\n`,
    );
  });

  withOptions(
    cli.command("check [root]", "Check documented symbols for drift"),
    CONFIG,
    JSON_OUTPUT,
    SARIF,
    SINCE,
    PROJECT,
    FIX,
    ...GENERATION,
  ).action(async (root: unknown, options: CheckCommandOptions) => {
    if (options.json === true && options.sarif === true) {
      throw new ConfigError("--json and --sarif cannot be used together");
    }
    if (options.fix === true) {
      if (options.sarif === true) {
        throw new ConfigError("--sarif cannot be combined with --fix");
      }
      if (options.since !== undefined) {
        throw new ConfigError("--since cannot be combined with --fix");
      }
      await runFix(root, options, "drifted", undefined);
      return;
    }
    requireFix(options);
    const workspaceRoot = commandRoot(root);
    const loaded = await loadConfig(workspaceRoot, options.config);
    const config = scopeProjects(loaded, options.project);
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

  withOptions(
    cli.command(
      "fix [root]",
      "Generate missing documentation in a bounded path",
    ),
    MISSING,
    PATH,
    PROJECT,
    ...GENERATION,
    JSON_OUTPUT,
    CONFIG,
  ).action(async (root: unknown, options: FixCommandOptions) => {
    if (options.missing !== true) {
      throw new ConfigError("fix currently requires --missing");
    }
    await runFix(root, options, "missing", options.path);
  });

  cli.help();
  cli.version(VERSION);
  return cli;
};
