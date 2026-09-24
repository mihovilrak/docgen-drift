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

/**
 * Build a documentation symbol for a function, method, accessor, or method
 * signature by collecting its signature, body, parameters, async and return
 * status, visibility, export state, and any existing doc comment.
 * @param handle Project handle used to build the symbol's id and file path.
 * @param declaration Function-like declaration node to describe, which is not
 *   an arrow function.
 * @param name Name recorded for the symbol, such as the method or accessor name.
 * @param kind Symbol kind to assign, which excludes variable-based kinds. A
 *   "setter" is always recorded as returning no value.
 * @returns A symbol for the declaration. For overloaded functions and methods,
 *   its existing doc is taken from the first declaration or overload that has one.
 */
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

/**
 * Build a documentation symbol for a variable initialized with an arrow
 * function or function expression, synthesizing a signature from the
 * declaration keyword, name, type parameters, parameters, and any explicit return type.
 * @param handle Project handle used to build the symbol's identity and location.
 * @param statement Variable statement that supplies the declaration keyword,
 *   export status, existing documentation, and source note.
 * @param declaration Variable declaration whose name becomes the symbol name.
 * @param initializer Arrow function or function expression whose type
 *   parameters, parameters, return type, body, and async status describe the callable.
 * @returns A symbol of kind "variable-function", public when the statement is
 *   exported and package-visible otherwise.
 */
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

/**
 * Assemble a documentation symbol for a variable declaration, including its type, initializer, export status, and source metadata.
 * @param handle Use the TypeScript project handle when constructing the documentation symbol.
 * @param statement Provide the variable statement that contains the declaration and its associated documentation metadata.
 * @param declaration Provide the specific variable declaration whose name, type, and initializer are extracted.
 */
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
