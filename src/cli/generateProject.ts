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
import { buildGraph } from "../adapters/typescript/graph.js";
import type { TypeScriptProjectHandle } from "../adapters/typescript/loadProject.js";
import type { DocgenConfig } from "../config/schema.js";
import { assembleContext } from "../core/budget.js";
import { findGitSubject } from "../core/git.js";
import { reverseTopologicalLevels } from "../core/graph.js";
import { hashText } from "../core/hash.js";
import type {
  GeneratedDoc,
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
  generationPrompt,
  generationSystemPrompt,
} from "../llm/prompt/index.js";
import { tokenCounter } from "../llm/tokenizer.js";
import { addUsage, EMPTY_USAGE, type ProviderUsage } from "../llm/usage.js";

export interface GenerationProviders {
  readonly generation: LlmProvider;
  /** Defaults to `generation`; a separate judge provider is supported. */
  readonly judge?: LlmProvider;
}

export interface ProjectGenerationProgress {
  readonly stage: "generation" | "judge";
  readonly symbolId: SymbolId;
  readonly provider: string;
  readonly model: string;
  readonly outcome: "OK" | "SKIP" | "ACCEPT" | "REJECT" | "FAILED";
  readonly attempts: number;
  readonly reason?: string;
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
  }[];
  readonly usage: ProviderUsage;
  readonly edits: ApplyEditsResult;
}

/**
 * Generate in dependency order, propagate only accepted callee summaries, and optionally write accepted documentation.
 * @param handle TypeScript project handle supplying the project root and source files to analyze.
 * @param targetIds Stable symbol identifiers restricting generation to the selected symbols.
 * @param config Documentation-generation configuration controlling extraction, context, models, concurrency, tests, and output behavior.
 * @param providers Generation provider configuration, including the optional judge provider.
 * @param write Whether accepted documentation edits should be written to source files.
 * @param judgeEnabled Whether generated documentation should be evaluated by the judge; defaults to config.judge.enabled.
 * @param onProgress Optional callback receiving generation and judging progress events.
 */
export const generateProject = async (
  handle: TypeScriptProjectHandle,
  targetIds: ReadonlySet<SymbolId>,
  config: DocgenConfig,
  providers: GenerationProviders,
  write: boolean,
  judgeEnabled = config.judge.enabled,
  onProgress?: (event: ProjectGenerationProgress) => void,
): Promise<ProjectGenerationResult> => {
  const symbols = extractSymbols(handle, {
    includeNonFunctionVariables: config.symbols.kinds.includes("variable"),
  });
  const targets = symbols.filter((symbol) => targetIds.has(symbol.id));
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
  const failed: { id: SymbolId; reason: string }[] = [];
  const plans: PlannedDocEdit[] = [];
  const fileHashes = await sourceFileHashes(handle, targets);
  let usage = EMPTY_USAGE;
  const client = new LlmClient(providers.generation, {
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
  const levels = reverseTopologicalLevels(index.graph);
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
    const level = levels[levelIndex] ?? [];
    const levelTargets = level
      .flatMap((component) => component.members)
      .filter((id) => targetIdSet.has(id))
      .map((id) => byId.get(id))
      .filter(isDefined);
    if (levelTargets.length === 0) continue;

    const contexts = await Promise.all(
      levelTargets.map(async (symbol) => ({
        symbol,
        context: assembleContext({
          symbol,
          symbols,
          graph: index.graph,
          index: index.context,
          budgetTokens: contextBudget,
          model: config.generate.model,
          countTokens,
          sources: config.context.sources,
          includeSourceNotes: config.docs.leadingComments.includeInContext,
          bodyMaxLines: config.context.bodyMaxLines,
          callSiteMax: config.context.callSites.max,
          callSiteSampling: config.context.callSites.sampling,
          calleeSummaries: summaries,
          ...(await gitSubject(handle, symbol, config)),
        }),
      })),
    );
    const batch = await client.generate(
      contexts.map(({ symbol, context }) => ({
        symbol,
        model: config.generate.model,
        system: generationSystemPrompt,
        prompt: generationPrompt(symbol, context.text),
      })),
    );
    usage = addUsage(usage, batch.usage);
    const judgeById = new Map<SymbolId, JudgeResult>();
    if (judgeEnabled) {
      const contextById = new Map(
        contexts.map(({ symbol, context }) => [symbol.id, context.text]),
      );
      const judged = await judge.judge(
        batch.results.flatMap((result) => {
          const symbol = byId.get(result.symbolId);
          const context = contextById.get(result.symbolId);
          return result.outcome?.verdict === "OK" &&
            symbol !== undefined &&
            context !== undefined
            ? [
                {
                  symbol,
                  doc: docForOutput(result.outcome.doc, config),
                  context,
                  model: config.judge.model,
                  strict: config.judge.strictLeaves && levelIndex === 0,
                },
              ]
            : [];
        }),
      );
      usage = addUsage(usage, judged.usage);
      for (const result of judged.results) {
        judgeById.set(result.symbolId, result);
      }
    }
    for (const result of batch.results) {
      consumeResult(
        result,
        judgeById.get(result.symbolId),
        judgeEnabled,
        byId,
        fileHashes,
        summaries,
        generated,
        skipped,
        rejected,
        failed,
        plans,
        config,
      );
    }
  }

  const edits = await applyEdits(handle, plans, config, write);
  const applied = new Set(edits.applied);
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
  };
};

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
  failed: { id: SymbolId; reason: string }[],
  plans: PlannedDocEdit[],
  config: DocgenConfig,
): void => {
  const symbol = byId.get(result.symbolId);
  if (symbol === undefined) return;
  if (result.outcome?.verdict === "SKIP") {
    skipped.push({ id: symbol.id, reason: result.outcome.reason });
    return;
  }
  if (result.outcome?.verdict !== "OK") {
    failed.push({ id: symbol.id, reason: result.error ?? "Generation failed" });
    return;
  }
  if (judgeEnabled && judgment?.error !== undefined) {
    failed.push({
      id: symbol.id,
      reason: `Judge failed: ${judgment.error}`,
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
  const doc = docForOutput(result.outcome.doc, config);
  summaries.set(symbol.id, doc.summary);
  generated.push(symbol.id);
  plans.push({
    symbol,
    doc,
    expectedFileHash: fileHashes.get(symbol.filePath) ?? "",
    expectedAnchorHash: symbolAnchorHash(symbol),
  });
};

const docForOutput = (
  doc: GeneratedDoc,
  config: DocgenConfig,
): GeneratedDoc => {
  const standard = config.docs.granularity !== "minimal";
  const detailed = config.docs.granularity === "detailed";
  return {
    summary: doc.summary,
    params: standard && config.docs.tags.params ? doc.params : {},
    throws: detailed && config.docs.tags.throws ? doc.throws : [],
    ...(detailed && doc.detail !== undefined ? { detail: doc.detail } : {}),
    ...(standard && config.docs.tags.returns && doc.returns !== undefined
      ? { returns: doc.returns }
      : {}),
  };
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
