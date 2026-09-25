import { Node } from "ts-morph";

import type { Symbol as DocumentationSymbol } from "../../../core/symbol.js";
import { callableReturnsValue } from "./signature.js";
import type { TypeScriptProjectHandle } from "../loadProject.js";

/** Resolve return types only for symbols selected for rendering. */
export const enrichReturns = (
  handle: TypeScriptProjectHandle,
  symbols: readonly DocumentationSymbol[],
  selected: ReadonlySet<string>,
): readonly DocumentationSymbol[] =>
  symbols.map((symbol) => {
    if (
      !selected.has(symbol.id) ||
      symbol.editBlockedReason !== undefined ||
      symbol.returnsValue !== undefined
    )
      return symbol;
    const file = handle.project.getSourceFile(
      `${handle.root}/${symbol.filePath}`,
    );
    let node = file?.getDescendantAtPos(symbol.declaration.start);
    while (
      node !== undefined &&
      (node.getStart() !== symbol.declaration.start ||
        node.getEnd() !== symbol.declaration.end)
    )
      node = node.getParent();
    if (node !== undefined && Node.isVariableStatement(node)) {
      node = node
        .getDeclarations()
        .find((item) => item.getName() === symbol.name)
        ?.getInitializer();
    }
    if (
      node === undefined ||
      !(
        Node.isFunctionDeclaration(node) ||
        Node.isMethodDeclaration(node) ||
        Node.isMethodSignature(node) ||
        Node.isGetAccessorDeclaration(node) ||
        Node.isSetAccessorDeclaration(node) ||
        Node.isArrowFunction(node) ||
        Node.isFunctionExpression(node)
      )
    )
      return symbol;
    return {
      ...symbol,
      returnsValue: Node.isSetAccessorDeclaration(node)
        ? false
        : callableReturnsValue(node, symbol.asynchronous),
    };
  });
