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
      (candidate) => candidate.containerName === container,
    );
    if (matched !== undefined) return matched;
  }
  return undefined;
};

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

export const enclosingSymbol = (
  position: number,
  symbols: readonly DocumentationSymbol[],
): DocumentationSymbol | undefined =>
  symbols
    .filter(
      (symbol) =>
        symbol.declaration.start <= position &&
        symbol.declaration.end >= position,
    )
    .sort(
      (left, right) =>
        left.declaration.end -
        left.declaration.start -
        (right.declaration.end - right.declaration.start),
    )[0];

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

export const sourceWindow = (
  sourceFile: SourceFile,
  position: number,
  radius: number,
): string => {
  const lines = sourceFile.getFullText().split(/\r?\n/u);
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
