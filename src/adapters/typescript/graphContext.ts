import { relative } from "node:path";

import {
  Node,
  SyntaxKind,
  type CallExpression,
  type SourceFile,
  type Symbol as TypeScriptSymbol,
} from "ts-morph";

import type { Symbol as DocumentationSymbol } from "../../core/symbol.js";
import type { TypeScriptProjectHandle } from "./loadProject.js";
import { sourceLines } from "./sourceLines.js";

/**
 * Resolve a call expression to its uniquely matching documented declaration.
 * @param call Call expression whose callee declaration should be resolved.
 * @param handle TypeScript project handle used to normalize declaration source paths.
 * @param lookup Map from normalized declaration locations and names to documented symbols.
 */
export const resolveCallee = (
  call: CallExpression,
  handle: TypeScriptProjectHandle,
  lookup: ReadonlyMap<string, readonly DocumentationSymbol[]>,
): DocumentationSymbol | undefined => {
  const expressionSymbol = unalias(call.getExpression().getSymbol());
  for (const declaration of expressionSymbol?.getDeclarations() ?? []) {
    const filePath = toProjectPath(handle, declaration.getSourceFile());
    const name = declarationName(declaration);
    if (name === undefined) continue;
    const candidates = lookup.get(`${filePath}\0${name}`) ?? [];
    if (candidates.length === 1) return candidates[0];
    const container = declarationContainer(declaration);
    const matched = candidates.find(
      (candidate) =>
        candidate.containerName === container &&
        (candidate.static === true) ===
          ((Node.isMethodDeclaration(declaration) ||
            Node.isGetAccessorDeclaration(declaration) ||
            Node.isSetAccessorDeclaration(declaration)) &&
            declaration.isStatic()),
    );
    if (matched !== undefined) return matched;
  }
  return undefined;
};

/**
 * Group symbols by their file path and name for declaration-based lookup.
 * @param symbols Symbols to index by the combined file path and name of each declaration.
 * @returns A read-only map from each file-path/name key to the symbols sharing that declaration identity.
 */
export const declarationLookup = (
  symbols: readonly DocumentationSymbol[],
): ReadonlyMap<string, readonly DocumentationSymbol[]> => {
  const result = new Map<string, DocumentationSymbol[]>();
  for (const symbol of symbols) {
    const key = `${symbol.filePath}\0${symbol.name}`;
    const existing = result.get(key);
    if (existing === undefined) result.set(key, [symbol]);
    else existing.push(symbol);
  }
  return result;
};

/**
 * Find the nearest enclosing function-like declaration and return its declared name, including names obtained from variable declarations.
 * @param node AST node whose enclosing function name should be determined.
 * @returns The enclosing function name, or undefined when no enclosing function-like declaration is found.
 */
export const enclosingFunctionName = (node: Node): string | undefined => {
  const callable = node.getFirstAncestor((ancestor) =>
    Node.isFunctionLikeDeclaration(ancestor),
  );
  if (callable === undefined) return undefined;
  if (
    Node.isFunctionDeclaration(callable) ||
    Node.isMethodDeclaration(callable) ||
    Node.isGetAccessorDeclaration(callable) ||
    Node.isSetAccessorDeclaration(callable)
  ) {
    return callable.getName();
  }
  return callable
    .getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
    ?.getName();
};

/**
 * Collect the literal names of enclosing describe, it, and test calls from outermost to innermost.
 * @param node AST node whose ancestor calls are inspected.
 */
export const enclosingTestNames = (node: Node): readonly string[] => {
  const names: string[] = [];
  let current = node.getParent();
  while (current !== undefined) {
    if (Node.isCallExpression(current)) {
      const expression = current.getExpression();
      const callName = Node.isIdentifier(expression)
        ? expression.getText()
        : Node.isPropertyAccessExpression(expression)
          ? expression.getName()
          : undefined;
      const argument = current.getArguments()[0];
      if (
        callName !== undefined &&
        ["describe", "it", "test"].includes(callName) &&
        argument !== undefined &&
        (Node.isStringLiteral(argument) ||
          Node.isNoSubstitutionTemplateLiteral(argument))
      ) {
        names.push(argument.getLiteralText());
      }
    }
    current = current.getParent();
  }
  return names.reverse();
};

/**
 * Extract a trimmed source-text window centered on the specified position.
 * @param sourceFile Source file from which to read the surrounding lines.
 * @param position Character position whose line should be centered in the window.
 * @param radius Number of lines to include on each side of the position's line.
 */
export const sourceWindow = (
  sourceFile: SourceFile,
  position: number,
  radius: number,
): string => {
  const lines = sourceLines(sourceFile).lines;
  const line = sourceFile.getLineAndColumnAtPos(position).line;
  const start = Math.max(0, line - radius - 1);
  const end = Math.min(lines.length, line + radius);
  return lines.slice(start, end).join("\n").trimEnd();
};

export const toProjectPath = (
  handle: TypeScriptProjectHandle,
  sourceFile: SourceFile,
): string =>
  relative(handle.root, sourceFile.getFilePath()).replaceAll("\\", "/");

const unalias = (
  symbol: TypeScriptSymbol | undefined,
): TypeScriptSymbol | undefined =>
  symbol !== undefined && symbol.isAlias()
    ? (symbol.getAliasedSymbol() ?? symbol)
    : symbol;

const declarationName = (node: Node): string | undefined => {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isMethodSignature(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node) ||
    Node.isVariableDeclaration(node) ||
    Node.isClassDeclaration(node)
  ) {
    return node.getName();
  }
  return undefined;
};

const declarationContainer = (node: Node): string | undefined => {
  const container = node.getFirstAncestor(
    (ancestor) =>
      Node.isClassDeclaration(ancestor) ||
      Node.isInterfaceDeclaration(ancestor),
  );
  return container !== undefined &&
    (Node.isClassDeclaration(container) ||
      Node.isInterfaceDeclaration(container))
    ? container.getName()
    : undefined;
};
