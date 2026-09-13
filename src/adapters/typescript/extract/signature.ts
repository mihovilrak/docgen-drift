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

export const renderTypeParameters = (
  parameters: readonly { getText(): string }[],
): string =>
  parameters.length === 0
    ? ""
    : `<${parameters.map((parameter) => parameter.getText()).join(", ")}>`;

export const getParameters = (
  declaration: CallableDeclaration,
): readonly Parameter[] =>
  declaration.getParameters().map((parameter) => ({
    name: parameter.getName(),
    text: parameter.getText(),
    optional: parameter.isOptional(),
    rest: parameter.isRestParameter(),
  }));

export const getCallableBody = (declaration: CallableDeclaration): string => {
  if (Node.isMethodSignature(declaration)) return "";
  const body = declaration.getBody();
  return body?.getText() ?? "";
};

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
