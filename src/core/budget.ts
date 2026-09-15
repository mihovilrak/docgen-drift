import type {
  ContextIndex,
  Graph,
  Symbol as DocumentationSymbol,
  SymbolId,
} from "./symbol.js";
import { contextCandidates } from "./contextCandidates.js";

export { sampleCallSites } from "./contextCandidates.js";

export type ContextSource =
  | "sourceNote"
  | "testName"
  | "ownBody"
  | "callSite"
  | "calleeSummary"
  | "referencedType"
  | "gitSubject"
  | "calleeBody";

export interface ContextCandidate {
  readonly source: ContextSource;
  readonly text: string;
  readonly truncatable?: boolean;
}

export interface ContextSources {
  readonly testNames: boolean;
  readonly ownBody: boolean;
  readonly callSites: boolean;
  readonly calleeSummaries: boolean;
  readonly referencedTypes: boolean;
  readonly gitSubject: boolean;
  readonly calleeBodies: boolean;
}

export interface AssembleContextOptions {
  readonly symbol: DocumentationSymbol;
  readonly symbols: readonly DocumentationSymbol[];
  readonly graph: Graph;
  readonly index: ContextIndex;
  readonly budgetTokens: number;
  readonly model: string;
  readonly countTokens?: TokenCount;
  readonly sources: ContextSources;
  readonly includeSourceNotes: boolean;
  readonly bodyMaxLines: number;
  readonly callSiteMax: number;
  readonly callSiteSampling: "moduleDiversity" | "first";
  readonly calleeSummaries?: ReadonlyMap<SymbolId, string>;
  readonly gitSubject?: string;
}

export interface AssembledContext {
  readonly text: string;
  readonly tokenCount: number;
  readonly tokenBudget: number;
  readonly model: string;
  readonly included: readonly ContextSource[];
  readonly omitted: readonly ContextSource[];
  readonly truncated: boolean;
}

export interface TokenCounter {
  readonly model: string;
  count(text: string): number;
  truncate(text: string, maxTokens: number): string;
}

/** A provider tokenizer, passed in rather than imported: `core/` never depends on `llm/`. */
export type TokenCount = (text: string) => number;

/**
 * Uses the provider tokenizer when one is supplied. The fallback is a lexical
 * estimate of one token per 4 bytes of each word or punctuation run, which
 * over-counts for most natural-language and code input and so degrades to a
 * smaller context rather than an over-budget request.
 */
export const createTokenCounter = (
  model: string,
  countTokens?: TokenCount,
): TokenCounter => {
  const count = countTokens ?? conservativeTokenCount;
  return {
    model,
    count,
    truncate: (value, maxTokens) => truncateToTokens(value, maxTokens, count),
  };
};

export const assembleContext = (
  options: AssembleContextOptions,
): AssembledContext => {
  const counter = createTokenCounter(options.model, options.countTokens);
  const header = `SYMBOL: ${options.symbol.id}\nSIGNATURE: ${options.symbol.signature}`;
  if (counter.count(header) > options.budgetTokens) {
    const text = counter.truncate(header, options.budgetTokens);
    return {
      text,
      tokenCount: counter.count(text),
      tokenBudget: options.budgetTokens,
      model: options.model,
      included: [],
      omitted: contextCandidates(options).map((candidate) => candidate.source),
      truncated: true,
    };
  }

  const candidates = contextCandidates(options);
  const selected = rankedKnapsack(
    candidates,
    options.budgetTokens - counter.count(`${header}\n\n`),
    counter,
  );
  const text = [header, ...selected.items.map((item) => item.text)].join(
    "\n\n",
  );
  return {
    text,
    tokenCount: counter.count(text),
    tokenBudget: options.budgetTokens,
    model: options.model,
    included: selected.items.map((item) => item.source),
    omitted: selected.omitted.map((item) => item.source),
    truncated: selected.truncated,
  };
};

export const rankedKnapsack = (
  candidates: readonly ContextCandidate[],
  budgetTokens: number,
  counter: TokenCounter,
): {
  readonly items: readonly ContextCandidate[];
  readonly omitted: readonly ContextCandidate[];
  readonly truncated: boolean;
} => {
  const items: ContextCandidate[] = [];
  const omitted: ContextCandidate[] = [];
  let remaining = Math.max(0, budgetTokens);
  let truncated = false;

  for (const candidate of candidates) {
    const separatorCost = items.length === 0 ? 0 : counter.count("\n\n");
    const cost = counter.count(candidate.text) + separatorCost;
    if (cost <= remaining) {
      items.push(candidate);
      remaining -= cost;
      continue;
    }
    if (candidate.truncatable === true && remaining - separatorCost >= 8) {
      const text = counter.truncate(candidate.text, remaining - separatorCost);
      if (text !== "") {
        items.push({ ...candidate, text });
        remaining = 0;
        truncated = true;
        continue;
      }
    }
    omitted.push(candidate);
  }

  return { items, omitted, truncated };
};

/**
 * The documented fallback for providers that expose no tokenizer: one token per
 * word or punctuation run, and an extra token per 4 bytes of a long run. It
 * over-counts real BPE tokenizers on both prose and code, so an unknown model
 * loses context rather than overflowing its window.
 */
export const conservativeTokenCount = (text: string): number => {
  if (text === "") return 0;
  const lexical = text.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
  return lexical.reduce(
    (total, token) =>
      total + Math.max(1, Math.ceil(Buffer.byteLength(token) / 4)),
    0,
  );
};

const truncateToTokens = (
  text: string,
  maxTokens: number,
  count: TokenCount,
): string => {
  if (maxTokens <= 0) return "";
  if (count(text) <= maxTokens) return text;
  const marker = "\n… [elided]";
  const markerTokens = count(marker);
  if (markerTokens >= maxTokens) return "";

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (count(text.slice(0, middle)) <= maxTokens - markerTokens) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${text.slice(0, low).trimEnd()}${marker}`;
};
