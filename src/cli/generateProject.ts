import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { glob } from "tinyglobby";

import {
  applyEdits,
  symbolAnchorHash,
  type ApplyEditsResult,
  type PlannedDocEdit,
} from "../adapters/typescript/applyEdits.js";
import { extractSymbols } from "../adapters/typescript/extract/index.js";
import { enrichReturns } from "../adapters/typescript/extract/enrich.js";
import { createTaskLimiter } from "../core/concurrency.js";
import { mapConcurrent, type ProviderFailureState } from "../llm/call.js";
import { buildGraph } from "../adapters/typescript/graph.js";
import type { TypeScriptProjectHandle } from "../adapters/typescript/loadProject.js";
import type { DocgenConfig } from "../config/schema.js";
import { assembleContext, type TokenCount } from "../core/budget.js";
import { assembleFileContext, type FileContext } from "../core/fileContext.js";
import { findGitSubject } from "../core/git.js";
import { reverseTopologicalLevels } from "../core/graph.js";
import { hashText } from "../core/hash.js";
import type {
  Symbol as DocumentationSymbol,
  SymbolId,
} from "../core/symbol.js";
import {
  LlmClient,
  type GenerationResult,
  type LlmProvider,
} from "../llm/client.js";
import { JudgeClient, type JudgeResult } from "../llm/judge.js";
import { contextBudgetFor } from "../llm/capabilities.js";
import {
  generationOutputPolicy,
  projectGeneratedDoc,
  type GenerationOutputPolicy,
} from "../llm/outputPolicy.js";
import {
  generationPrompt,
  generationSystemPrompt,
} from "../llm/prompt/index.js";
import { tokenCounter } from "../llm/tokenizer.js";
import { addUsage, EMPTY_USAGE, type ProviderUsage } from "../llm/usage.js";
import {
  elapsedMilliseconds,
  EMPTY_GENERATION_STAGE,
  EMPTY_JUDGE_STAGE,
  type GenerationRunMetrics,
} from "./generationMetrics.js";
import {
  evaluationRecord,
  type GenerationEvaluationRecord,
} from "./evaluation.js";

export interface GenerationProviders {
  readonly runtime?: GenerationRuntime;
  readonly generation: LlmProvider;
  /** Defaults to `generation`; a separate judge provider is supported. */
  readonly judge?: LlmProvider;
}

export interface GenerationRuntime {
  readonly failureState: ProviderFailureState;
  readonly contextTask: ReturnType<typeof createTaskLimiter>;
}

export const generationRuntime = (concurrency: number): GenerationRuntime => ({
  failureState: {},
  contextTask: createTaskLimiter(concurrency),
});

export interface ProjectGenerationProgress {
  readonly stage: "generation" | "judge";
  readonly symbolId: SymbolId;
  readonly provider: string;
  readonly model: string;
  readonly outcome: "OK" | "SKIP" | "ACCEPT" | "REJECT" | "FAILED";
  readonly attempts: number;
  readonly reason?: string;
  readonly diagnostic?: string;
}

export interface ProjectGenerationResult {
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
  readonly usage: ProviderUsage;
  readonly edits: ApplyEditsResult;
  readonly metrics: Omit<GenerationRunMetrics, "durationMs">;
  readonly evaluation: readonly GenerationEvaluationRecord[];
}

/**
 * Generate documentation for the selected project symbols in dependency order, optionally judging results and reporting progress.
 * @param handle Provide the TypeScript project handle to analyze.
 * @param targetIds Provide the symbol IDs to document.
 * @param config Provide the documentation-generation configuration.
 * @param providers Provide the generation and optional judging providers.
 * @param write Set whether planned documentation edits should be written.
 * @param judgeEnabled Set whether generated documentation should be evaluated; defaults to the configured judge setting.
 * @param onProgress Optionally receive generation and judging progress events.
 * @param captureEvaluation Set whether generation and judgment inputs should be included in the result.
 */
export const generateProject = async (
  handle: TypeScriptProjectHandle,
  targetIds: ReadonlySet<SymbolId>,
  config: DocgenConfig,
  providers: GenerationProviders,
  write: boolean,
  judgeEnabled = config.judge.enabled,
  onProgress?: (event: ProjectGenerationProgress) => void,
  captureEvaluation = false,
): Promise<ProjectGenerationResult> => {
  if (targetIds.size === 0) return emptyProjectResult();
  const runtime =
    providers.runtime ?? generationRuntime(config.generate.concurrency);
  const symbols = enrichReturns(
    handle,
    extractSymbols(handle, {
      includeNonFunctionVariables: config.symbols.kinds.includes("variable"),
    }),
    targetIds,
  );
  const targets = symbols.filter(
    (symbol) =>
      targetIds.has(symbol.id) && symbol.editBlockedReason === undefined,
  );
  const blocked = symbols
    .filter(
      (symbol) =>
        targetIds.has(symbol.id) && symbol.editBlockedReason !== undefined,
    )
    .map((symbol) => ({
      id: symbol.id,
      reason: symbol.editBlockedReason ?? "Ambiguous documentation owner",
    }));
  if (targets.length === 0) return { ...emptyProjectResult(), failed: blocked };
  const testFilePaths = new Set(
    (
      await glob(config.tests, {
        absolute: true,
        cwd: handle.root,
        ignore: config.exclude,
      })
    ).map((path) => resolve(path)),
  );
  const index = buildGraph(handle, symbols, {
    testFilePaths,
    callSiteLines: config.context.callSites.lines,
    referencedTypeSymbolIds: new Set(targets.map((symbol) => symbol.id)),
  });
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const targetIdSet = new Set(targets.map((symbol) => symbol.id));
  const summaries = new Map<SymbolId, string>();
  const generated: SymbolId[] = [];
  const skipped: { id: SymbolId; reason: string }[] = [];
  const rejected: { id: SymbolId; reason: string }[] = [];
  const failed: { id: SymbolId; reason: string; diagnostic?: string }[] = [
    ...blocked,
  ];
  const plans: PlannedDocEdit[] = [];
  const evaluationInputs: {
    readonly symbol: DocumentationSymbol;
    readonly generation: GenerationResult;
    readonly judgment?: JudgeResult;
  }[] = [];
  const fileHashes = await sourceFileHashes(handle, targets);
  let usage = EMPTY_USAGE;
  let generationMetrics = EMPTY_GENERATION_STAGE;
  let judgeMetrics = EMPTY_JUDGE_STAGE;
  const client = new LlmClient(providers.generation, {
    failureState: runtime.failureState,
    concurrency: config.generate.concurrency,
    ...(onProgress === undefined
      ? {}
      : {
          onResult: (result: GenerationResult) => {
            onProgress(generationProgress(result, providers, config));
          },
        }),
  });
  const judge = new JudgeClient(providers.judge ?? providers.generation, {
    failureState: runtime.failureState,
    concurrency: config.generate.concurrency,
    ...(onProgress === undefined
      ? {}
      : {
          onResult: (result: JudgeResult) => {
            onProgress(judgeProgress(result, providers, config));
          },
        }),
  });

  const countTokens = tokenCounter(providers.generation, config.generate.model);
  const contextBudget = effectiveContextBudget(config, providers, judgeEnabled);
  const fileContexts = sharedFileContexts(
    config,
    targets,
    symbols,
    countTokens,
    contextBudget,
  );
  const levels = reverseTopologicalLevels(index.graph);
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
    const level = levels[levelIndex] ?? [];
    const levelTargets = level
      .flatMap((component) => component.members)
      .filter((id) => targetIdSet.has(id))
      .map((id) => byId.get(id))
      .filter(isDefined);
    if (levelTargets.length === 0) continue;
    if (runtime.failureState.reason !== undefined) {
      for (const symbol of levelTargets) {
        const reason = `Not sent after an earlier provider error: ${runtime.failureState.reason}`;
        failed.push({ id: symbol.id, reason });
        onProgress?.({
          stage: "generation",
          symbolId: symbol.id,
          provider: providers.generation.id,
          model: config.generate.model,
          outcome: "FAILED",
          attempts: 0,
          reason,
        });
      }
      continue;
    }

    const contexts = await mapConcurrent(
      levelTargets,
      config.generate.concurrency,
      async (symbol) => {
        const shared = fileContexts.get(symbol.filePath);
        return {
          symbol,
          ...(shared === undefined ? {} : { prefix: shared.text }),
          context: assembleContext({
            symbol,
            symbols,
            graph: index.graph,
            index: index.context,
            // The shared outline is charged against the same budget, so a
            // module prefix displaces per-symbol context instead of adding to
            // the request.
            budgetTokens:
              shared === undefined
                ? contextBudget
                : Math.max(
                    contextBudget - shared.tokenCount,
                    MIN_SYMBOL_BUDGET,
                  ),
            model: config.generate.model,
            countTokens,
            sources: config.context.sources,
            includeSourceNotes: config.docs.leadingComments.includeInContext,
            bodyMaxLines: config.context.bodyMaxLines,
            callSiteMax: config.context.callSites.max,
            callSiteSampling: config.context.callSites.sampling,
            calleeSummaries: summaries,
            ...(shared === undefined
              ? {}
              : { sharedDeclaredNames: shared.declaredNames }),
            ...(await runtime.contextTask(() =>
              gitSubject(handle, symbol, config),
            )),
          }),
        };
      },
    );
    const generationStarted = performance.now();
    const generationResults: GenerationResult[] = [];
    for (const wave of requestWaves(
      contexts.map(({ symbol, context, prefix }) => {
        const outputPolicy = generationOutputPolicy(config, symbol);
        return {
          symbol,
          model: config.generate.model,
          system: generationSystemPrompt,
          ...(prefix === undefined ? {} : { prefix }),
          prompt: generationPrompt(symbol, context.text, outputPolicy),
          outputPolicy,
        };
      }),
    )) {
      const batch = await client.generate(wave);
      generationResults.push(...batch.results);
      usage = addUsage(usage, batch.usage);
    }
    generationMetrics = addGenerationBatchMetrics(
      generationMetrics,
      generationResults,
      elapsedMilliseconds(generationStarted),
    );
    const judgeById = new Map<SymbolId, JudgeResult>();
    if (judgeEnabled) {
      const contextById = new Map(
        contexts.map(({ symbol, context }) => [symbol.id, context.text]),
      );
      const judgeStarted = performance.now();
      const judgeResults: JudgeResult[] = [];
      for (const wave of requestWaves(
        generationResults.flatMap((result) => {
          const symbol = byId.get(result.symbolId);
          const context = contextById.get(result.symbolId);
          if (
            result.outcome?.verdict !== "OK" ||
            symbol === undefined ||
            context === undefined
          ) {
            return [];
          }
          const prefix = fileContexts.get(symbol.filePath)?.text;
          return [
            {
              symbol,
              doc: projectGeneratedDoc(
                result.outcome.doc,
                generationOutputPolicy(config, symbol),
              ),
              context,
              ...(prefix === undefined ? {} : { prefix }),
              model: config.judge.model,
              strict: config.judge.strictLeaves && levelIndex === 0,
              output: generationOutputPolicy(config, symbol),
            },
          ];
        }),
      )) {
        const judged = await judge.judge(wave);
        judgeResults.push(...judged.results);
        usage = addUsage(usage, judged.usage);
      }
      judgeMetrics = addJudgeBatchMetrics(
        judgeMetrics,
        judgeResults,
        elapsedMilliseconds(judgeStarted),
      );
      for (const result of judgeResults) {
        judgeById.set(result.symbolId, result);
      }
    }
    for (const result of generationResults) {
      const symbol = byId.get(result.symbolId);
      const judgment = judgeById.get(result.symbolId);
      if (captureEvaluation && symbol !== undefined) {
        evaluationInputs.push({
          symbol,
          generation: result,
          ...(judgment === undefined ? {} : { judgment }),
        });
      }
      consumeResult(
        result,
        judgment,
        judgeEnabled,
        byId,
        fileHashes,
        summaries,
        generated,
        skipped,
        rejected,
        failed,
        plans,
        generationOutputPolicy(config, symbol),
      );
    }
  }

  const edits = await applyEdits(handle, plans, config, write);
  const applied = new Set(edits.applied);
  const planned = new Set(plans.map((plan) => plan.symbol.id));
  for (const editFailure of edits.failed) {
    failed.push({ id: editFailure.symbolId, reason: editFailure.reason });
  }
  return {
    generated: generated.filter((id) => applied.has(id)),
    skipped,
    rejected,
    failed,
    usage,
    edits,
    metrics: { generation: generationMetrics, judge: judgeMetrics },
    evaluation: evaluationInputs.map((input) =>
      evaluationRecord({
        ...input,
        generationProvider: providers.generation.id,
        generationModel: config.generate.model,
        judgeProvider: (providers.judge ?? providers.generation).id,
        judgeModel: config.judge.model,
        outputPolicy: generationOutputPolicy(config, input.symbol),
        config,
        planned: planned.has(input.symbol.id),
        applied: applied.has(input.symbol.id),
        write,
      }),
    ),
  };
};

const emptyProjectResult = (): ProjectGenerationResult => ({
  generated: [],
  skipped: [],
  rejected: [],
  failed: [],
  usage: EMPTY_USAGE,
  edits: { applied: [], failed: [], files: [], updatedSymbols: [] },
  metrics: { generation: EMPTY_GENERATION_STAGE, judge: EMPTY_JUDGE_STAGE },
  evaluation: [],
});

const addGenerationBatchMetrics = (
  current: typeof EMPTY_GENERATION_STAGE,
  results: readonly GenerationResult[],
  durationMs: number,
): typeof EMPTY_GENERATION_STAGE => ({
  requests: current.requests + results.length,
  attempts:
    current.attempts +
    results.reduce((sum, result) => sum + result.attempts, 0),
  candidates:
    current.candidates +
    results.filter((result) => result.outcome?.verdict === "OK").length,
  skipped:
    current.skipped +
    results.filter((result) => result.outcome?.verdict === "SKIP").length,
  failed:
    current.failed +
    results.filter((result) => result.outcome === undefined).length,
  durationMs: current.durationMs + durationMs,
});

const addJudgeBatchMetrics = (
  current: typeof EMPTY_JUDGE_STAGE,
  results: readonly JudgeResult[],
  durationMs: number,
): typeof EMPTY_JUDGE_STAGE => ({
  requests: current.requests + results.length,
  attempts:
    current.attempts +
    results.reduce((sum, result) => sum + result.attempts, 0),
  accepted:
    current.accepted +
    results.filter((result) => result.error === undefined && result.accepted)
      .length,
  rejected:
    current.rejected +
    results.filter((result) => result.error === undefined && !result.accepted)
      .length,
  failed:
    current.failed +
    results.filter((result) => result.error !== undefined).length,
  durationMs: current.durationMs + durationMs,
});

const generationProgress = (
  result: GenerationResult,
  providers: GenerationProviders,
  config: DocgenConfig,
): ProjectGenerationProgress => ({
  stage: "generation",
  symbolId: result.symbolId,
  provider: providers.generation.id,
  model: config.generate.model,
  outcome:
    result.outcome?.verdict === "OK"
      ? "OK"
      : result.outcome?.verdict === "SKIP"
        ? "SKIP"
        : "FAILED",
  attempts: result.attempts,
  ...(result.outcome?.verdict === "SKIP"
    ? { reason: result.outcome.reason }
    : result.error === undefined
      ? {}
      : { reason: result.error }),
  ...(result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic }),
});

const judgeProgress = (
  result: JudgeResult,
  providers: GenerationProviders,
  config: DocgenConfig,
): ProjectGenerationProgress => ({
  stage: "judge",
  symbolId: result.symbolId,
  provider: (providers.judge ?? providers.generation).id,
  model: config.judge.model,
  outcome:
    result.error !== undefined
      ? "FAILED"
      : result.accepted
        ? "ACCEPT"
        : "REJECT",
  attempts: result.attempts,
  ...(result.error !== undefined
    ? { reason: result.error }
    : result.reason === ""
      ? {}
      : { reason: result.reason }),
  ...(result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic }),
});

const consumeResult = (
  result: GenerationResult,
  judgment: JudgeResult | undefined,
  judgeEnabled: boolean,
  byId: ReadonlyMap<SymbolId, DocumentationSymbol>,
  fileHashes: ReadonlyMap<string, string>,
  summaries: Map<SymbolId, string>,
  generated: SymbolId[],
  skipped: { id: SymbolId; reason: string }[],
  rejected: { id: SymbolId; reason: string }[],
  failed: { id: SymbolId; reason: string; diagnostic?: string }[],
  plans: PlannedDocEdit[],
  outputPolicy: GenerationOutputPolicy,
): void => {
  const symbol = byId.get(result.symbolId);
  if (symbol === undefined) return;
  if (result.outcome?.verdict === "SKIP") {
    skipped.push({ id: symbol.id, reason: result.outcome.reason });
    return;
  }
  if (result.outcome?.verdict !== "OK") {
    failed.push({
      id: symbol.id,
      reason: result.error ?? "Generation failed",
      ...(result.diagnostic === undefined
        ? {}
        : { diagnostic: result.diagnostic }),
    });
    return;
  }
  if (judgeEnabled && judgment?.error !== undefined) {
    failed.push({
      id: symbol.id,
      reason: `Judge failed: ${judgment.error}`,
      ...(judgment.diagnostic === undefined
        ? {}
        : { diagnostic: judgment.diagnostic }),
    });
    return;
  }
  if (judgeEnabled && judgment?.accepted !== true) {
    rejected.push({
      id: symbol.id,
      reason: judgment?.reason ?? "Judge returned no decision",
    });
    return;
  }
  const doc = projectGeneratedDoc(result.outcome.doc, outputPolicy);
  summaries.set(symbol.id, doc.summary);
  generated.push(symbol.id);
  plans.push({
    symbol,
    doc,
    expectedFileHash: fileHashes.get(symbol.filePath) ?? "",
    expectedAnchorHash: symbolAnchorHash(symbol),
  });
};

const sourceFileHashes = async (
  handle: TypeScriptProjectHandle,
  symbols: readonly DocumentationSymbol[],
): Promise<ReadonlyMap<string, string>> => {
  const paths = new Set(symbols.map((symbol) => symbol.filePath));
  const entries = await Promise.all(
    [...paths].map(
      async (path) =>
        [
          path,
          hashText(await readFile(resolve(handle.root, path), "utf8")),
        ] as const,
    ),
  );
  return new Map(entries);
};

const gitSubject = async (
  handle: TypeScriptProjectHandle,
  symbol: DocumentationSymbol,
  config: DocgenConfig,
): Promise<{ readonly gitSubject?: string }> => {
  if (!config.context.sources.gitSubject) return {};
  const subject = await findGitSubject({
    root: handle.root,
    filePath: symbol.filePath,
    startLine: symbol.declaration.startLine,
    endLine: symbol.declaration.endLine,
    timeoutMs: config.context.git.timeoutMs,
  });
  return subject === undefined ? {} : { gitSubject: subject };
};

/** Floor for per-symbol context once a shared module outline is charged against the budget. */
const MIN_SYMBOL_BUDGET = 400;

/**
 * Build one cacheable module outline per file that has enough targets to amortize it.
 * @param config Read the shared-context toggle, token budget, and minimum target count from the configuration.
 * @param targets Count documentation targets per file to decide which files get an outline.
 * @param symbols Provide every extracted symbol so an outline can list siblings that are not themselves targets.
 * @param countTokens Measure outline size with the provider tokenizer.
 * @param contextBudget Cap the outline so per-symbol context keeps at least `MIN_SYMBOL_BUDGET` tokens.
 */
const sharedFileContexts = (
  config: DocgenConfig,
  targets: readonly DocumentationSymbol[],
  symbols: readonly DocumentationSymbol[],
  countTokens: TokenCount,
  contextBudget: number,
): ReadonlyMap<string, FileContext> => {
  const result = new Map<string, FileContext>();
  const budgetTokens = Math.min(
    config.context.shared.budgetTokens,
    contextBudget - MIN_SYMBOL_BUDGET,
  );
  if (!config.context.shared.enabled || budgetTokens <= 0) return result;
  const counts = new Map<string, number>();
  for (const target of targets) {
    counts.set(target.filePath, (counts.get(target.filePath) ?? 0) + 1);
  }
  for (const [filePath, count] of counts) {
    if (count < config.context.shared.minSymbols) continue;
    const context = assembleFileContext({
      filePath,
      symbols,
      budgetTokens,
      model: config.generate.model,
      countTokens,
    });
    if (context.text !== "") result.set(filePath, context);
  }
  return result;
};

/**
 * Order a batch so each distinct prefix is written to the provider cache once
 * before the requests that read it are issued. Without this, the concurrent
 * requests of one file would all miss and each pay the cache-write premium.
 * @param requests Requests to order; those without a prefix stay in the first wave.
 * @returns One wave when nothing would repeat a prefix, otherwise a lead wave and a follower wave.
 */
const requestWaves = <T extends { readonly prefix?: string }>(
  requests: readonly T[],
): readonly (readonly T[])[] => {
  if (!requests.some((request) => request.prefix !== undefined)) {
    return [requests];
  }
  const written = new Set<string>();
  const lead: T[] = [];
  const followers: T[] = [];
  for (const request of requests) {
    if (request.prefix === undefined || !written.has(request.prefix)) {
      if (request.prefix !== undefined) written.add(request.prefix);
      lead.push(request);
      continue;
    }
    followers.push(request);
  }
  return followers.length === 0 ? [lead] : [lead, followers];
};

const effectiveContextBudget = (
  config: DocgenConfig,
  providers: GenerationProviders,
  judgeEnabled: boolean,
): number => {
  const limits = [
    providers.generation.describe?.(config.generate.model),
    ...(judgeEnabled
      ? [
          (providers.judge ?? providers.generation).describe?.(
            config.judge.model,
          ),
        ]
      : []),
  ].filter(isDefined);
  return limits.reduce(
    (budget, capabilities) => contextBudgetFor(budget, capabilities).effective,
    config.context.budgetTokens,
  );
};

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;
