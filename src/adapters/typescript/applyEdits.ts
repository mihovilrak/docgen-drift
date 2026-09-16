import { randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { format, resolveConfig } from "prettier";
import { ts } from "ts-morph";

import type { DocgenConfig } from "../../config/schema.js";
import { hashText, normalizeCode } from "../../core/hash.js";
import type {
  GeneratedDoc,
  Symbol as DocumentationSymbol,
} from "../../core/symbol.js";
import { extractSymbols } from "./extract/index.js";
import type { TypeScriptProjectHandle } from "./loadProject.js";
import { renderDoc } from "./renderDoc.js";

export interface PlannedDocEdit {
  readonly symbol: DocumentationSymbol;
  readonly doc: GeneratedDoc;
  readonly expectedFileHash: string;
  readonly expectedAnchorHash: string;
}

export interface ChangedFile {
  readonly filePath: string;
  readonly before: string;
  readonly after: string;
}

export interface FailedEdit {
  readonly symbolId: string;
  readonly reason: string;
}

export interface ApplyEditsResult {
  readonly applied: readonly string[];
  readonly failed: readonly FailedEdit[];
  readonly files: readonly ChangedFile[];
}

export type SourceWriter = (path: string, source: string) => Promise<void>;

export const symbolAnchorHash = (symbol: DocumentationSymbol): string =>
  hashText(
    [
      normalizeCode(symbol.signature),
      normalizeCode(symbol.body),
      symbol.existingDoc?.raw ?? "",
      symbol.sourceNote?.raw ?? "",
    ].join("\0"),
  );

export const applyEdits = async (
  handle: TypeScriptProjectHandle,
  plans: readonly PlannedDocEdit[],
  config: DocgenConfig,
  write: boolean,
  writeSource: SourceWriter = atomicWriteSource,
): Promise<ApplyEditsResult> => {
  const grouped = new Map<string, PlannedDocEdit[]>();
  for (const plan of plans) {
    const values = grouped.get(plan.symbol.filePath);
    if (values === undefined) grouped.set(plan.symbol.filePath, [plan]);
    else values.push(plan);
  }

  const applied: string[] = [];
  const failed: FailedEdit[] = [];
  const files: ChangedFile[] = [];
  for (const [relativePath, filePlans] of grouped) {
    const fileApplied: string[] = [];
    const filePath = resolve(handle.root, relativePath);
    const before = await readFile(filePath, "utf8");
    const symbols = currentSymbols(
      handle,
      filePath,
      before,
      filePlans.some((plan) => plan.expectedFileHash !== hashText(before)),
      config,
    );
    const resolvedPlans = resolvePlans(filePlans, symbols, failed);
    let after = before;
    for (const plan of [...resolvedPlans].sort(
      (left, right) =>
        editStart(right.symbol, config) - editStart(left.symbol, config),
    )) {
      const edit = buildEdit(plan, after, config);
      const candidate = `${after.slice(0, edit.start)}${edit.text}${after.slice(edit.end)}`;
      if (syntaxErrors(filePath, candidate).length > 0) {
        failed.push({
          symbolId: plan.symbol.id,
          reason: "Generated edit did not parse cleanly",
        });
        continue;
      }
      after = candidate;
      applied.push(plan.symbol.id);
      fileApplied.push(plan.symbol.id);
    }
    if (after === before) continue;

    try {
      after = await formatIfConfigured(filePath, after, eolOf(before));
    } catch (error) {
      for (const id of fileApplied) {
        const index = applied.indexOf(id);
        if (index >= 0) applied.splice(index, 1);
        failed.push({ symbolId: id, reason: errorMessage(error) });
      }
      continue;
    }
    if (syntaxErrors(filePath, after).length > 0) {
      for (const plan of resolvedPlans) {
        const index = applied.indexOf(plan.symbol.id);
        if (index >= 0) applied.splice(index, 1);
        failed.push({
          symbolId: plan.symbol.id,
          reason: "Formatted file did not parse cleanly",
        });
      }
      continue;
    }
    if (write) {
      try {
        await writeSource(filePath, after);
      } catch (error) {
        for (const id of fileApplied) {
          const index = applied.indexOf(id);
          if (index >= 0) applied.splice(index, 1);
          failed.push({ symbolId: id, reason: errorMessage(error) });
        }
        continue;
      }
    }
    files.push({ filePath, before, after });
  }
  return { applied, failed, files };
};

const currentSymbols = (
  handle: TypeScriptProjectHandle,
  filePath: string,
  source: string,
  refresh: boolean,
  config: DocgenConfig,
): readonly DocumentationSymbol[] => {
  if (!refresh) return extractSymbols(handle, extractOptions(config));
  const sourceFile = handle.project.getSourceFile(filePath);
  if (sourceFile === undefined) return [];
  sourceFile.replaceWithText(source);
  return extractSymbols(handle, extractOptions(config));
};

const resolvePlans = (
  plans: readonly PlannedDocEdit[],
  symbols: readonly DocumentationSymbol[],
  failed: FailedEdit[],
): readonly PlannedDocEdit[] => {
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const result: PlannedDocEdit[] = [];
  for (const plan of plans) {
    const current = byId.get(plan.symbol.id);
    if (current === undefined) {
      failed.push({
        symbolId: plan.symbol.id,
        reason: "Symbol disappeared before the edit was applied",
      });
    } else if (symbolAnchorHash(current) !== plan.expectedAnchorHash) {
      failed.push({
        symbolId: plan.symbol.id,
        reason: "Symbol changed after generation",
      });
    } else {
      result.push({ ...plan, symbol: current });
    }
  }
  return result;
};

const buildEdit = (
  plan: PlannedDocEdit,
  source: string,
  config: DocgenConfig,
): { readonly start: number; readonly end: number; readonly text: string } => {
  const symbol = plan.symbol;
  const replaceSourceNote = shouldReplaceSourceNote(symbol, config);
  const start = editStart(symbol, config);
  const indentation = indentationAt(source, symbol.declaration.start);
  const eol = eolOf(source);
  const includeStandardSections = config.docs.granularity !== "minimal";
  const includeDetailedSections = config.docs.granularity === "detailed";
  const rendered = renderDoc(plan.doc, symbol, {
    indentation,
    eol,
    emitDetail: includeDetailedSections,
    emitParams: includeStandardSections && config.docs.tags.params,
    emitReturns: includeStandardSections && config.docs.tags.returns,
    emitThrows: includeDetailedSections && config.docs.tags.throws,
    preserveTags: config.docs.preserveTags,
  });
  return {
    start,
    end: replaceSourceNote
      ? symbol.declaration.start
      : (symbol.existingDoc?.range.end ?? start),
    text: replaceSourceNote
      ? `${indentation}${rendered}${eol}${indentation}`
      : symbol.existingDoc === null
        ? `${rendered}${eol}${indentation}`
        : rendered,
  };
};

const editStart = (
  symbol: DocumentationSymbol,
  config: DocgenConfig,
): number =>
  shouldReplaceSourceNote(symbol, config)
    ? (symbol.sourceNote?.range.start ?? symbol.declaration.start)
    : (symbol.existingDoc?.range.start ?? symbol.declaration.start);

const shouldReplaceSourceNote = (
  symbol: DocumentationSymbol,
  config: DocgenConfig,
): boolean =>
  config.docs.leadingComments.onGenerate === "replace" &&
  symbol.existingDoc === null &&
  symbol.sourceNote?.replacementEligible === true;

const indentationAt = (source: string, position: number): string => {
  const lineStart = Math.max(
    source.lastIndexOf("\n", Math.max(0, position - 1)) + 1,
    0,
  );
  return source.slice(lineStart, position).match(/^\s*/u)?.[0] ?? "";
};

const eolOf = (source: string): "\n" | "\r\n" =>
  source.includes("\r\n") ? "\r\n" : "\n";

const formatIfConfigured = async (
  filePath: string,
  source: string,
  eol: "\n" | "\r\n",
): Promise<string> => {
  const config = await resolveConfig(filePath);
  if (config === null) return source;
  return format(source, {
    ...config,
    filepath: filePath,
    endOfLine: eol === "\r\n" ? "crlf" : "lf",
  });
};

interface ParsedSourceFile extends ts.SourceFile {
  readonly parseDiagnostics: readonly ts.Diagnostic[];
}

const syntaxErrors = (
  filePath: string,
  source: string,
): readonly ts.Diagnostic[] => {
  const scriptKind = filePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : filePath.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : filePath.endsWith(".js") || filePath.endsWith(".mjs")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  ) as ParsedSourceFile;
  return parsed.parseDiagnostics;
};

const extractOptions = (config: DocgenConfig) => ({
  includeNonFunctionVariables: config.symbols.kinds.includes("variable"),
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Failed to format generated edits";

const atomicWriteSource: SourceWriter = async (filePath, source) => {
  const temporaryPath = `${filePath}.docgen-${String(process.pid)}-${randomUUID()}.tmp`;
  const mode = (await stat(filePath)).mode;
  try {
    await writeFile(temporaryPath, source, { encoding: "utf8", mode });
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
};
