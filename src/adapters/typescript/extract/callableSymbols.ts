import {
  Node,
  type ArrowFunction,
  type FunctionExpression,
  type VariableDeclaration,
  type VariableStatement,
} from "ts-morph";

import type {
  Symbol as DocumentationSymbol,
  SymbolKind,
} from "../../../core/symbol.js";
import type { TypeScriptProjectHandle } from "../loadProject.js";
import { findDocOwner, parseExistingDoc } from "./jsdoc.js";
import {
  callableReturnsValue,
  getCallableBody,
  getParameters,
  hasAsyncModifier,
  renderCallableSignature,
  renderTypeParameters,
  type NonArrowCallable,
} from "./signature.js";
import { extractSourceNote } from "./sourceNotes.js";
import { makeSymbol } from "./symbolFactory.js";
import {
  getContainerName,
  getVisibility,
  isDeclarationExported,
} from "./visibility.js";

export const callableSymbol = (
  handle: TypeScriptProjectHandle,
  declaration: NonArrowCallable,
  name: string,
  kind: Exclude<SymbolKind, "variable-function" | "variable">,
): DocumentationSymbol => {
  const sourceFile = declaration.getSourceFile();
  const containerName = getContainerName(declaration);
  const overloads =
    Node.isFunctionDeclaration(declaration) ||
    Node.isMethodDeclaration(declaration)
      ? declaration.getOverloads()
      : [];
  const docOwner = findDocOwner([declaration, ...overloads]);
  const visibility = getVisibility(declaration);
  const asynchronous = hasAsyncModifier(declaration);

  return makeSymbol(handle, declaration, {
    name,
    ...(containerName === undefined ? {} : { containerName }),
    kind,
    signature: renderCallableSignature(declaration, name, kind),
    body: getCallableBody(declaration),
    parameters: getParameters(declaration),
    returnsValue:
      kind === "setter"
        ? false
        : callableReturnsValue(declaration, asynchronous),
    asynchronous,
    exported: isDeclarationExported(declaration, visibility),
    visibility,
    existingDoc: docOwner === undefined ? null : parseExistingDoc(docOwner),
    sourceNote: extractSourceNote(sourceFile, declaration),
  });
};

export const variableFunctionSymbol = (
  handle: TypeScriptProjectHandle,
  statement: VariableStatement,
  declaration: VariableDeclaration,
  initializer: ArrowFunction | FunctionExpression,
): DocumentationSymbol => {
  const name = declaration.getName();
  const declarationKind = statement.getDeclarationKind();
  const typeParameters = renderTypeParameters(initializer.getTypeParameters());
  const parameters = initializer
    .getParameters()
    .map((parameter) => parameter.getText())
    .join(", ");
  const returnType = initializer.getReturnTypeNode()?.getText();
  const signature = `${declarationKind} ${name}${typeParameters}(${parameters})${returnType === undefined ? "" : `: ${returnType}`}`;
  const asynchronous = initializer.isAsync();

  return makeSymbol(handle, statement, {
    name,
    kind: "variable-function",
    signature,
    body: getCallableBody(initializer),
    parameters: getParameters(initializer),
    returnsValue: callableReturnsValue(initializer, asynchronous),
    asynchronous,
    exported: statement.isExported(),
    visibility: statement.isExported() ? "public" : "package",
    existingDoc: parseExistingDoc(statement),
    sourceNote: extractSourceNote(statement.getSourceFile(), statement),
  });
};

export const variableSymbol = (
  handle: TypeScriptProjectHandle,
  statement: VariableStatement,
  declaration: VariableDeclaration,
): DocumentationSymbol => {
  const name = declaration.getName();
  const typeNode = declaration.getTypeNode();
  const initializer = declaration.getInitializer();
  return makeSymbol(handle, statement, {
    name,
    kind: "variable",
    signature: `${statement.getDeclarationKind()} ${name}${typeNode === undefined ? "" : `: ${typeNode.getText()}`}`,
    body: initializer?.getText() ?? "",
    parameters: [],
    asynchronous: false,
    exported: statement.isExported(),
    visibility: "public",
    existingDoc: parseExistingDoc(statement),
    sourceNote: extractSourceNote(statement.getSourceFile(), statement),
  });
};
