import {
  Node,
  type ArrowFunction,
  type FunctionExpression,
  type Type,
} from "ts-morph";

import type { Parameter, SymbolKind } from "../../../core/symbol.js";
import type { CallableDeclaration } from "./types.js";

export type NonArrowCallable = Exclude<
  CallableDeclaration,
  ArrowFunction | FunctionExpression
>;

/**
 * Format a callable declaration as a source-like signature, preserving accessor, async, generator, type-parameter, parameter, and return-type syntax.
 * @param declaration The callable declaration to render.
 * @param name The callable's name.
 * @param kind The symbol kind that determines whether to render an accessor or function form.
 */
export const renderCallableSignature = (
  declaration: NonArrowCallable,
  name: string,
  kind: SymbolKind,
): string => {
  const typeParameters =
    Node.isGetAccessorDeclaration(declaration) ||
    Node.isSetAccessorDeclaration(declaration)
      ? ""
      : renderTypeParameters(declaration.getTypeParameters());
  const parameters = declaration
    .getParameters()
    .map((parameter) => parameter.getText())
    .join(", ");
  const returnType = declaration.getReturnTypeNode()?.getText();
  const returnSuffix = returnType === undefined ? "" : `: ${returnType}`;

  if (kind === "getter") return `get ${name}()${returnSuffix}`;
  if (kind === "setter") return `set ${name}(${parameters})`;

  const asyncPrefix = hasAsyncModifier(declaration) ? "async " : "";
  const generatorMarker =
    (Node.isFunctionDeclaration(declaration) ||
      Node.isMethodDeclaration(declaration)) &&
    declaration.isGenerator()
      ? "*"
      : "";
  const functionPrefix = kind === "function" ? "function" : "";
  return `${asyncPrefix}${functionPrefix}${generatorMarker}${functionPrefix === "" ? "" : " "}${name}${typeParameters}(${parameters})${returnSuffix}`;
};

/**
 * Format type parameters as a comma-separated angle-bracketed list, or return an empty string when none are provided.
 * @param parameters Type-parameter nodes whose text is used in the rendered list.
 */
export const renderTypeParameters = (
  parameters: readonly { getText(): string }[],
): string =>
  parameters.length === 0
    ? ""
    : `<${parameters.map((parameter) => parameter.getText()).join(", ")}>`;

export const getParameters = (
  declaration: CallableDeclaration,
): readonly Parameter[] =>
  declaration.getParameters().map((parameter, index) => ({
    // Destructured names have no identifier; use the eslint-plugin-jsdoc `rootN` convention.
    name: Node.isIdentifier(parameter.getNameNode())
      ? parameter.getName()
      : `root${String(index)}`,
    text: parameter.getText(),
    optional: parameter.isOptional(),
    rest: parameter.isRestParameter(),
  }));

/**
 * Extract the callable's source body text, returning an empty string when no body exists.
 * @param declaration Callable declaration whose body text should be extracted.
 */
export const getCallableBody = (declaration: CallableDeclaration): string => {
  if (Node.isMethodSignature(declaration)) return "";
  const body = declaration.getBody();
  return body?.getText() ?? "";
};

/**
 * Determine whether the callable produces a non-void result, unwrapping asynchronous return types first.
 * @param declaration Callable declaration whose return type is inspected.
 * @param asynchronous Whether to inspect the awaited return type for an asynchronous callable.
 * @returns True when the callable returns a non-void value; otherwise false.
 */
export const callableReturnsValue = (
  declaration: CallableDeclaration,
  asynchronous: boolean,
): boolean => {
  let returnType: Type = declaration.getReturnType();
  if (asynchronous) returnType = returnType.getAwaitedType() ?? returnType;
  return !returnType.isVoid();
};

export const hasAsyncModifier = (declaration: CallableDeclaration): boolean =>
  "isAsync" in declaration && declaration.isAsync();
