import { relative, resolve } from "node:path";

import { loadWorkspace } from "../adapters/typescript/loadWorkspace.js";
import { ConfigError } from "../config/load.js";
import { judgeProviderConfig, type DocgenConfig } from "../config/schema.js";
import { unifiedDiff } from "../core/diff.js";
import { isWorkingTreeDirty } from "../core/git.js";
import type { SymbolId } from "../core/symbol.js";
import {
  contextBudgetFor,
  costFromPrice,
  type ModelCapabilities,
} from "../llm/capabilities.js";
import type { LlmProvider } from "../llm/client.js";
import {
  createProvider,
  providerCapabilities,
} from "../llm/providers/index.js";
import {
  addUsage,
  EMPTY_USAGE,
  usdUsage,
  type CostBasis,
  type ProviderUsage,
} from "../llm/usage.js";
import { refreshLocks, runCheck } from "./run.js";
import { type ProjectIndex } from "./workspace.js";
import {
  generateProject,
  generationRuntime,
  type GenerationProviders,
  type ProjectGenerationProgress,
  type ProjectGenerationResult,
} from "./generateProject.js";
import {
  addGenerationStages,
  addJudgeStages,
  elapsedMilliseconds,
  EMPTY_GENERATION_STAGE,
  EMPTY_JUDGE_STAGE,
  type GenerationRunMetrics,
} from "./generationMetrics.js";
import type { GenerationEvaluationRecord } from "./evaluation.js";

export type FixMode = "drifted" | "missing";

export interface GenerationOptions {
  readonly mode: FixMode;
  readonly path?: string;
  readonly dryRun?: boolean;
  readonly allowDirty?: boolean;
  readonly noJudge?: boolean;
  readonly captureEvaluation?: boolean;
  readonly onEstimate?: (estimate: GenerationEstimate) => void;
  readonly onProgress?: (event: GenerationProgressEvent) => void;
}

export type GenerationProgressEvent = ProjectGenerationProgress;

export interface GenerationEstimate {
  readonly symbols: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd?: number;
  readonly costBasis: CostBasis;
  readonly includesJudge: boolean;
  /** The judge runs the generation model, so it shares that model's blind spots. */
  readonly selfJudged: boolean;
  readonly contextBudgetTokens: number;
  readonly contextBudgetReduced: boolean;
}

export interface GenerationRunResult {
  readonly requested: number;
  readonly generated: readonly SymbolId[];
  readonly skipped: readonly {
    readonly id: SymbolId;
    readonly reason: string;
  }[];
  readonly rejected: readonly {
    readonly id: SymbolId;
    readonly reason: string;
  }[];
  readonly failed: readonly {
    readonly id: SymbolId;
    readonly reason: string;
    readonly diagnostic?: string;
  }[];
  readonly changedFiles: number;
  readonly usage: ProviderUsage;
  readonly diff: string;
  readonly metrics: GenerationRunMetrics;
  readonly evaluation?: readonly GenerationEvaluationRecord[];
}

/**
 * Generate documentation for selected workspace symbols, optionally judging results, previewing changes, and refreshing locks.
 * @param root Repository root in which to inspect the workspace and apply or preview generated documentation.
 * @param config Generation, workspace, inclusion, exclusion, and judging configuration.
 * @param options Controls the generation mode, optional path filter, dry-run and dirty-tree behavior, judging, evaluation capture, and progress callbacks.
 * @param injectedProvider Optional language-model provider used for generation instead of resolving the configured provider.
 */
export const runGeneration = async (
  root: string,
  config: DocgenConfig,
  options: GenerationOptions,
  injectedProvider?: LlmProvider,
): Promise<GenerationRunResult> => {
  const runStarted = performance.now();
  validateGenerationOptions(config, options);
  if (options.dryRun !== true && options.allowDirty !== true) {
    if (await isWorkingTreeDirty(root)) {
      throw new ConfigError(
        "Refusing to modify a dirty working tree; commit changes or pass --allow-dirty",
      );
    }
  }

  const check = await runCheck(root, config);
  const { path } = options;
  if (
    path !== undefined &&
    !check.results.some((result) => withinPath(result.filePath, path))
  ) {
    throw new ConfigError(
      `No checked symbols under ${path}; --path narrows include and never extends it`,
    );
  }
  const targetIds = new Set(
    check.results
      .filter(
        (result) =>
          result.status === options.mode &&
          (options.path === undefined ||
            withinPath(result.filePath, options.path)),
      )
      .map((result) => result.id),
  );
  if (targetIds.size > config.generate.maxSymbolsPerRun) {
    throw new ConfigError(
      `Generation selected ${String(targetIds.size)} symbols, exceeding generate.maxSymbolsPerRun (${String(config.generate.maxSymbolsPerRun)})`,
    );
  }
  const judgeEnabled = config.judge.enabled && options.noJudge !== true;
  options.onEstimate?.(
    estimateGeneration(config, targetIds.size, judgeEnabled),
  );
  if (targetIds.size === 0) {
    return emptyResult(
      elapsedMilliseconds(runStarted),
      options.captureEvaluation === true,
    );
  }

  const providers = {
    ...resolveProviders(config, judgeEnabled, injectedProvider),
    runtime: generationRuntime(config.generate.concurrency),
  };
  const projectResults = await loadWorkspace(
    {
      root,
      projects: config.workspace.projects,
      projectConcurrency: config.workspace.projectConcurrency,
      include: [...config.include, ...config.tests],
      exclude: config.exclude,
      ...(config.projectSelection === undefined
        ? {}
        : { selection: config.projectSelection }),
      targetProjects: new Set(
        check.projects
          .filter((project) =>
            project.symbolIds.some((id) => targetIds.has(id)),
          )
          .map((project) => resolve(root, project.path)),
      ),
    },
    async (
      project,
    ): Promise<{
      readonly workspacePath: string;
      readonly index: ProjectIndex;
      readonly result: ProjectGenerationResult;
    }> => {
      const projectIndex: ProjectIndex = {
        projectPath: relative(root, project.tsconfigPath).replaceAll("\\", "/"),
        root: project.root,
        workspacePath: workspacePath(root, project.root),
        symbols: [],
        eligible: [],
      };
      const localTargets = new Set(
        [...targetIds].map((id) => localId(projectIndex, id)).filter(isDefined),
      );
      return {
        index: projectIndex,
        workspacePath: projectIndex.workspacePath,
        result: await generateProject(
          project,
          localTargets,
          config,
          providers,
          options.dryRun !== true,
          judgeEnabled,
          options.onProgress === undefined
            ? undefined
            : (event) =>
                options.onProgress?.({
                  ...event,
                  symbolId: canonicalResultId(
                    projectIndex.workspacePath,
                    event.symbolId,
                  ),
                }),
          options.captureEvaluation === true,
        ),
      };
    },
  );

  const generated = projectResults.flatMap((project) =>
    project.result.generated.map((id) =>
      canonicalResultId(project.workspacePath, id),
    ),
  );
  const skipped = projectResults.flatMap((project) =>
    project.result.skipped.map((item) => ({
      ...item,
      id: canonicalResultId(project.workspacePath, item.id),
    })),
  );
  const failed = projectResults.flatMap((project) =>
    project.result.failed.map((item) => ({
      ...item,
      id: canonicalResultId(project.workspacePath, item.id),
    })),
  );
  const rejected = projectResults.flatMap((project) =>
    project.result.rejected.map((item) => ({
      ...item,
      id: canonicalResultId(project.workspacePath, item.id),
    })),
  );
  const files = projectResults.flatMap((project) => project.result.edits.files);
  const evaluation = projectResults.flatMap((project) =>
    project.result.evaluation.map((record) =>
      canonicalEvaluationRecord(project.workspacePath, record),
    ),
  );
  if (options.dryRun !== true && generated.length > 0) {
    await refreshLocks(
      root,
      config,
      new Set(generated),
      projectResults.map(({ index, result }) => ({
        ...index,
        symbols: result.edits.updatedSymbols,
        eligible: result.edits.updatedSymbols,
      })),
    );
  }
  return {
    requested: targetIds.size,
    generated,
    skipped,
    rejected,
    failed,
    changedFiles: files.length,
    usage: projectResults.reduce(
      (usage, project) => addUsage(usage, project.result.usage),
      EMPTY_USAGE,
    ),
    diff: files
      .map((file) =>
        unifiedDiff(
          relative(root, file.filePath).replaceAll("\\", "/"),
          file.before,
          file.after,
        ),
      )
      .filter(Boolean)
      .join("\n"),
    metrics: {
      durationMs: elapsedMilliseconds(runStarted),
      generation: addGenerationStages(
        projectResults.map((project) => project.result.metrics.generation),
      ),
      judge: addJudgeStages(
        projectResults.map((project) => project.result.metrics.judge),
      ),
    },
    ...(options.captureEvaluation === true ? { evaluation } : {}),
  };
};

/**
 * Estimate generation and optional judge usage after constraining the context budget to both models' windows.
 * @param config Generation, judge, context-budget, and provider pricing configuration.
 * @param symbols Number of symbols to include in the estimate.
 * @param judgeEnabled Whether to include judge usage.
 * @returns Estimated token usage, cost basis, judge inclusion, and effective context budget.
 */
export const estimateGeneration = (
  config: DocgenConfig,
  symbols: number,
  judgeEnabled: boolean,
): GenerationEstimate => {
  const generationCapabilities = providerCapabilities(
    config.generate.provider,
    config.generate.model,
  );
  const generationBudget = configuredContextBudget(
    config.context.budgetTokens,
    generationCapabilities,
  );
  const judgeCapabilities = judgeEnabled
    ? providerCapabilities(judgeProviderConfig(config), config.judge.model)
    : undefined;
  const judgeBudget =
    judgeCapabilities === undefined
      ? generationBudget
      : configuredContextBudget(generationBudget.effective, judgeCapabilities);
  const contextBudget = {
    effective: judgeBudget.effective,
    reduced: judgeBudget.effective < config.context.budgetTokens,
  };
  const generationUsage = estimatedUsage(
    generationCapabilities,
    symbols * (contextBudget.effective + 300),
    symbols * 300,
  );
  const judgeUsage =
    judgeCapabilities === undefined
      ? EMPTY_USAGE
      : estimatedUsage(
          judgeCapabilities,
          symbols * (contextBudget.effective + 800),
          symbols * 80,
        );
  const total = addUsage(generationUsage, judgeUsage);
  return {
    symbols,
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
    ...(total.costUsd === undefined ? {} : { costUsd: total.costUsd }),
    costBasis: total.costBasis,
    includesJudge: judgeEnabled,
    selfJudged: judgeEnabled && config.judge.model === config.generate.model,
    contextBudgetTokens: contextBudget.effective,
    contextBudgetReduced: contextBudget.reduced,
  };
};

/** Uncached list prices; a provider without a price yields no monetary total. */
const estimatedUsage = (
  capabilities: ModelCapabilities,
  inputTokens: number,
  outputTokens: number,
): ProviderUsage => {
  const cost = costFromPrice(capabilities.price, inputTokens, outputTokens);
  return cost === undefined
    ? {
        inputTokens,
        outputTokens,
        costBasis:
          capabilities.costBasis === "usd" ? "unknown" : capabilities.costBasis,
      }
    : usdUsage(inputTokens, outputTokens, cost);
};

const configuredContextBudget = (
  requested: number,
  capabilities: ModelCapabilities,
) => {
  try {
    return contextBudgetFor(requested, capabilities);
  } catch (error) {
    throw new ConfigError(
      error instanceof Error ? error.message : "Invalid model context window",
    );
  }
};

/** The judge provider is only constructed when judging runs, so a disabled
 * judge never demands a second set of credentials. */
const resolveProviders = (
  config: DocgenConfig,
  judgeEnabled: boolean,
  injected: LlmProvider | undefined,
): GenerationProviders => {
  if (injected !== undefined) return { generation: injected };
  const generation = createProvider(config.generate.provider);
  if (!judgeEnabled || config.judge.provider === undefined) {
    return { generation };
  }
  return { generation, judge: createProvider(config.judge.provider) };
};

const validateGenerationOptions = (
  config: DocgenConfig,
  options: GenerationOptions,
): void => {
  if (options.mode === "missing" && options.path === undefined) {
    throw new ConfigError("Missing-doc backfill requires --path <path>");
  }
  if (config.docs.leadingComments.onGenerate === "replace") {
    if (!config.judge.enabled || options.noJudge === true) {
      throw new ConfigError(
        "docs.leadingComments.onGenerate=replace requires the judge and cannot be combined with --no-judge",
      );
    }
  }
};

const localId = (project: ProjectIndex, id: SymbolId): SymbolId | undefined => {
  const prefix =
    project.workspacePath === "." ? "" : `${project.workspacePath}/`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : undefined;
};

const canonicalResultId = (projectPath: string, id: SymbolId): SymbolId =>
  projectPath === "." ? id : `${projectPath}/${id}`;

const workspacePath = (root: string, projectRoot: string): string => {
  const path = relative(resolve(root), resolve(projectRoot));
  return path === "" ? "." : path.replaceAll("\\", "/");
};

const withinPath = (filePath: string, scope: string): boolean => {
  const normalizedFile = filePath.replaceAll("\\", "/");
  const normalizedScope = scope
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/$/u, "");
  return (
    normalizedScope === "." ||
    normalizedFile === normalizedScope ||
    normalizedFile.startsWith(`${normalizedScope}/`)
  );
};

const emptyResult = (
  durationMs: number,
  captureEvaluation: boolean,
): GenerationRunResult => ({
  requested: 0,
  generated: [],
  skipped: [],
  rejected: [],
  failed: [],
  changedFiles: 0,
  usage: EMPTY_USAGE,
  diff: "",
  metrics: {
    durationMs,
    generation: EMPTY_GENERATION_STAGE,
    judge: EMPTY_JUDGE_STAGE,
  },
  ...(captureEvaluation ? { evaluation: [] } : {}),
});

const canonicalEvaluationRecord = (
  projectPath: string,
  record: GenerationEvaluationRecord,
): GenerationEvaluationRecord => ({
  ...record,
  symbol: {
    ...record.symbol,
    id: canonicalResultId(projectPath, record.symbol.id),
    filePath:
      projectPath === "."
        ? record.symbol.filePath
        : `${projectPath}/${record.symbol.filePath}`,
  },
});

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;
