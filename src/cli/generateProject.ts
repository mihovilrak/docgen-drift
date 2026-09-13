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
  Symbol as DocumentationSymbol,
  SymbolId,
} from "../core/symbol.js";
import {
  LlmClient,
  type GenerationResult,
  type LlmProvider,
  type ProviderUsage,
} from "../llm/client.js";
import { JudgeClient, type JudgeResult } from "../llm/judge.js";
import {
  generationPrompt,
  generationSystemPrompt,
} from "../llm/prompt/index.js";

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

export const generateProject = async (
  handle: TypeScriptProjectHandle,
  targetIds: ReadonlySet<SymbolId>,
  config: DocgenConfig,
  provider: LlmProvider,
  write: boolean,
  judgeEnabled = config.judge.enabled,
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
  let usage = emptyUsage();
  const client = new LlmClient(provider, {
    concurrency: config.generate.concurrency,
  });
  const judge = new JudgeClient(provider, {
    concurrency: config.generate.concurrency,
  });

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
          budgetTokens: config.context.budgetTokens,
          model: config.generate.model,
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
                  doc: result.outcome.doc,
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
  summaries.set(symbol.id, result.outcome.doc.summary);
  generated.push(symbol.id);
  plans.push({
    symbol,
    doc: result.outcome.doc,
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

const emptyUsage = (): ProviderUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
});

const addUsage = (
  left: ProviderUsage,
  right: ProviderUsage,
): ProviderUsage => ({
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  costUsd: left.costUsd + right.costUsd,
});

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;
