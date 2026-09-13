import { Node, type VariableStatement } from "ts-morph";

import type { Symbol as DocumentationSymbol } from "../../../core/symbol.js";
import type { TypeScriptProjectHandle } from "../loadProject.js";
import {
  callableSymbol,
  variableFunctionSymbol,
  variableSymbol,
} from "./callableSymbols.js";
import {
  classSymbol,
  enumSymbol,
  interfaceSymbol,
  typeAliasSymbol,
} from "./declarationSymbols.js";
import type { ExtractOptions } from "./types.js";

export type { ExtractOptions } from "./types.js";
export { parseExistingDoc } from "./jsdoc.js";

export const extractSymbols = (
  handle: TypeScriptProjectHandle,
  options: ExtractOptions = {},
): readonly DocumentationSymbol[] => {
  const symbols: DocumentationSymbol[] = [];
  const seenIds = new Set<string>();

  for (const sourceFile of handle.sourceFiles) {
    for (const declaration of sourceFile.getFunctions()) {
      if (declaration.isOverload()) continue;
      addSymbol(
        symbols,
        seenIds,
        callableSymbol(
          handle,
          declaration,
          declaration.getName() ?? "default",
          "function",
        ),
      );
    }

    for (const statement of sourceFile.getVariableStatements()) {
      extractVariableStatement(handle, statement, options, symbols, seenIds);
    }

    for (const declaration of sourceFile.getClasses()) {
      addSymbol(symbols, seenIds, classSymbol(handle, declaration));
      for (const method of declaration.getMethods()) {
        if (method.isOverload()) continue;
        addSymbol(
          symbols,
          seenIds,
          callableSymbol(handle, method, method.getName(), "method"),
        );
      }
      for (const accessor of declaration.getGetAccessors()) {
        addSymbol(
          symbols,
          seenIds,
          callableSymbol(handle, accessor, accessor.getName(), "getter"),
        );
      }
      for (const accessor of declaration.getSetAccessors()) {
        addSymbol(
          symbols,
          seenIds,
          callableSymbol(handle, accessor, accessor.getName(), "setter"),
        );
      }
    }

    for (const declaration of sourceFile.getInterfaces()) {
      addSymbol(symbols, seenIds, interfaceSymbol(handle, declaration));
      for (const method of declaration.getMethods()) {
        addSymbol(
          symbols,
          seenIds,
          callableSymbol(handle, method, method.getName(), "method-signature"),
        );
      }
    }

    for (const declaration of sourceFile.getTypeAliases()) {
      addSymbol(symbols, seenIds, typeAliasSymbol(handle, declaration));
    }

    for (const declaration of sourceFile.getEnums()) {
      addSymbol(symbols, seenIds, enumSymbol(handle, declaration));
    }
  }

  return symbols.sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.declaration.start - right.declaration.start,
  );
};

const addSymbol = (
  symbols: DocumentationSymbol[],
  seenIds: Set<string>,
  symbol: DocumentationSymbol,
): void => {
  if (seenIds.has(symbol.id)) return;
  seenIds.add(symbol.id);
  symbols.push(symbol);
};

const extractVariableStatement = (
  handle: TypeScriptProjectHandle,
  statement: VariableStatement,
  options: ExtractOptions,
  symbols: DocumentationSymbol[],
  seenIds: Set<string>,
): void => {
  for (const declaration of statement.getDeclarations()) {
    const nameNode = declaration.getNameNode();
    if (!Node.isIdentifier(nameNode)) continue;

    const initializer = declaration.getInitializer();
    if (
      initializer !== undefined &&
      (Node.isArrowFunction(initializer) ||
        Node.isFunctionExpression(initializer))
    ) {
      addSymbol(
        symbols,
        seenIds,
        variableFunctionSymbol(handle, statement, declaration, initializer),
      );
      continue;
    }

    if (
      options.includeNonFunctionVariables === true &&
      statement.isExported()
    ) {
      addSymbol(
        symbols,
        seenIds,
        variableSymbol(handle, statement, declaration),
      );
    }
  }
};
