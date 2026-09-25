import { resolve } from "node:path";

import { SyntaxKind } from "ts-morph";

import type {
  CallSite,
  GraphEdge,
  Symbol as DocumentationSymbol,
  SymbolId,
  SymbolIndex,
  TestReference,
} from "../../core/symbol.js";
import type { TypeScriptProjectHandle } from "./loadProject.js";
import {
  declarationLookup,
  enclosingFunctionName,
  enclosingTestNames,
  resolveCallee,
  sourceWindow,
  toProjectPath,
} from "./graphContext.js";
import { extractReferencedTypes } from "./referencedTypes.js";

export interface BuildGraphOptions {
  readonly testFilePaths?: ReadonlySet<string>;
  readonly callSiteLines?: number;
  readonly referencedTypeSymbolIds?: ReadonlySet<SymbolId>;
}

/**
 * Build a symbol index with deduplicated call-graph edges, test references, call-site context, and selected referenced types.
 * @param handle TypeScript project handle whose source files are traversed for call expressions and declarations.
 * @param symbols Documented symbols used to identify graph nodes, callers, callees, and referenced types.
 * @param options Optional test-file paths, call-site context length, and referenced-type selection settings.
 */
export const buildGraph = (
  handle: TypeScriptProjectHandle,
  symbols: readonly DocumentationSymbol[],
  options: BuildGraphOptions = {},
): SymbolIndex => {
  const symbolsByFile = groupSymbolsByFile(symbols);
  const symbolByDeclaration = declarationLookup(symbols);
  const edgeKeys = new Set<string>();
  const forward: GraphEdge[] = [];
  const callSites = new Map<SymbolId, CallSite[]>();
  const testReferences = new Map<SymbolId, TestReference[]>();
  const testReferenceKeys = new Set<string>();

  for (const sourceFile of handle.sourceFiles) {
    const filePath = toProjectPath(handle, sourceFile);
    const fileSymbols = symbolsByFile.get(filePath) ?? [];
    const byStart = new Map(
      fileSymbols.map((symbol) => [symbol.declaration.start, symbol]),
    );
    const isTest =
      options.testFilePaths?.has(resolve(sourceFile.getFilePath())) === true;
    for (const call of sourceFile.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )) {
      const callee = resolveCallee(call, handle, symbolByDeclaration);
      if (callee === undefined) continue;
      let ancestor = call.getParent();
      let caller: DocumentationSymbol | undefined;
      while (
        ancestor !== undefined &&
        ancestor.getKind() !== SyntaxKind.SourceFile &&
        caller === undefined
      ) {
        caller = byStart.get(ancestor.getStart());
        ancestor = ancestor.getParent();
      }

      if (caller !== undefined) {
        const key = `${caller.id}\0${callee.id}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          forward.push({ from: caller.id, to: callee.id });
        }
      }

      if (isTest) {
        const names = enclosingTestNames(call);
        const key = `${callee.id}\0${filePath}\0${names.join("\0")}`;
        if (names.length > 0 && !testReferenceKeys.has(key)) {
          testReferenceKeys.add(key);
          pushMap(testReferences, callee.id, {
            symbol: callee.id,
            filePath,
            line: sourceFile.getLineAndColumnAtPos(call.getStart()).line,
            names,
          });
        }
      } else {
        const enclosingFunction = enclosingFunctionName(call);
        pushMap(callSites, callee.id, {
          callee: callee.id,
          ...(caller === undefined ? {} : { caller: caller.id }),
          filePath,
          modulePath: filePath,
          line: sourceFile.getLineAndColumnAtPos(call.getStart()).line,
          ...(enclosingFunction === undefined ? {} : { enclosingFunction }),
          text: sourceWindow(
            sourceFile,
            call.getStart(),
            options.callSiteLines ?? 2,
          ),
        });
      }
    }
  }

  forward.sort(compareEdges);
  const reverse = forward
    .map((edge) => ({ from: edge.to, to: edge.from }))
    .sort(compareEdges);
  return {
    graph: {
      symbols: symbols.map((symbol) => symbol.id),
      forward,
      reverse,
    },
    context: {
      callSites,
      testReferences,
      referencedTypes: extractReferencedTypes(
        handle,
        symbols,
        options.referencedTypeSymbolIds,
      ),
    },
  };
};

const groupSymbolsByFile = (
  symbols: readonly DocumentationSymbol[],
): ReadonlyMap<string, readonly DocumentationSymbol[]> => {
  const result = new Map<string, DocumentationSymbol[]>();
  for (const symbol of symbols) pushMap(result, symbol.filePath, symbol);
  return result;
};

const pushMap = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
};

const compareEdges = (left: GraphEdge, right: GraphEdge): number =>
  left.from.localeCompare(right.from) || left.to.localeCompare(right.to);
