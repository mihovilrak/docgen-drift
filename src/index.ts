import { createRequire } from "node:module";

const packageJson = createRequire(import.meta.url)("../package.json") as {
  readonly version: string;
};

export const VERSION = packageJson.version;

export type {
  Edit,
  ExistingDoc,
  ExistingDocTag,
  Graph,
  GraphEdge,
  CallSite,
  ContextIndex,
  Parameter,
  ReferencedType,
  SourceNote,
  SourceRange,
  Symbol,
  SymbolId,
  SymbolKind,
  SymbolVisibility,
  SymbolIndex,
  TestReference,
} from "./core/symbol.js";

export {
  assembleContext,
  createTokenCounter,
  rankedKnapsack,
  sampleCallSites,
} from "./core/budget.js";
export {
  reverseTopologicalOrder,
  stronglyConnectedComponents,
} from "./core/graph.js";
