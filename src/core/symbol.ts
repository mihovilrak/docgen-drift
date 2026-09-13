export type SymbolId = string;

export type SymbolKind =
  | "function"
  | "variable-function"
  | "method"
  | "method-signature"
  | "getter"
  | "setter"
  | "class"
  | "interface"
  | "type-alias"
  | "enum"
  | "variable";

export type SymbolVisibility = "public" | "protected" | "private" | "package";

export interface SourceRange {
  readonly start: number;
  readonly end: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface ExistingDocTag {
  readonly name: string;
  readonly text: string;
  readonly parameterName?: string;
  readonly raw: string;
  readonly known: boolean;
}

export interface ExistingDoc {
  readonly description: string;
  readonly tags: readonly ExistingDocTag[];
  readonly raw: string;
  readonly range: SourceRange;
}

export type SourceNoteBlockReason = "directive" | "license" | "triple-slash";

export interface SourceNote {
  readonly text: string;
  readonly raw: string;
  readonly range: SourceRange;
  readonly replacementEligible: boolean;
  readonly blockedBy?: SourceNoteBlockReason;
}

export interface Parameter {
  readonly name: string;
  readonly text: string;
  readonly optional: boolean;
  readonly rest: boolean;
}

export interface Symbol {
  readonly id: SymbolId;
  readonly name: string;
  readonly containerName?: string;
  readonly kind: SymbolKind;
  readonly filePath: string;
  readonly signature: string;
  readonly body: string;
  readonly parameters: readonly Parameter[];
  readonly returnsValue?: boolean;
  readonly asynchronous: boolean;
  readonly exported: boolean;
  readonly visibility: SymbolVisibility;
  readonly declaration: SourceRange;
  readonly existingDoc: ExistingDoc | null;
  readonly sourceNote: SourceNote | null;
}

export interface GraphEdge {
  readonly from: SymbolId;
  readonly to: SymbolId;
}

export interface Graph {
  readonly symbols: readonly SymbolId[];
  readonly forward: readonly GraphEdge[];
  readonly reverse: readonly GraphEdge[];
}

export interface CallSite {
  readonly callee: SymbolId;
  readonly caller?: SymbolId;
  readonly filePath: string;
  readonly modulePath: string;
  readonly line: number;
  readonly enclosingFunction?: string;
  readonly text: string;
}

export interface TestReference {
  readonly symbol: SymbolId;
  readonly filePath: string;
  readonly line: number;
  readonly names: readonly string[];
}

export interface ReferencedType {
  readonly name: string;
  readonly declaration: string;
}

export interface ContextIndex {
  readonly callSites: ReadonlyMap<SymbolId, readonly CallSite[]>;
  readonly testReferences: ReadonlyMap<SymbolId, readonly TestReference[]>;
  readonly referencedTypes: ReadonlyMap<SymbolId, readonly ReferencedType[]>;
}

export interface SymbolIndex {
  readonly graph: Graph;
  readonly context: ContextIndex;
}

export interface GeneratedThrow {
  readonly type: string;
  readonly when: string;
}

export interface GeneratedDoc {
  readonly summary: string;
  readonly detail?: string;
  readonly params: Readonly<Record<string, string>>;
  readonly returns?: string;
  readonly throws: readonly GeneratedThrow[];
}

export interface Edit {
  readonly filePath: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}
