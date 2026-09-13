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
  Parameter,
  SourceNote,
  SourceRange,
  Symbol,
  SymbolId,
  SymbolKind,
  SymbolVisibility,
} from "./core/symbol.js";
