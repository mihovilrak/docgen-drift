import type {
  ArrowFunction,
  FunctionDeclaration,
  FunctionExpression,
  GetAccessorDeclaration,
  MethodDeclaration,
  MethodSignature,
  SetAccessorDeclaration,
} from "ts-morph";

export interface ExtractOptions {
  readonly includeNonFunctionVariables?: boolean;
}

export type CallableDeclaration =
  | FunctionDeclaration
  | MethodDeclaration
  | MethodSignature
  | GetAccessorDeclaration
  | SetAccessorDeclaration
  | ArrowFunction
  | FunctionExpression;

export const KNOWN_JSDOC_TAGS = new Set([
  "deprecated",
  "example",
  "internal",
  "param",
  "returns",
  "return",
  "see",
  "throws",
  "typeParam",
]);

export const DIRECTIVE_PATTERN =
  /(?:@ts-|eslint|prettier|biome|istanbul|c8\s+ignore|v8\s+ignore|coverage\s+ignore)/iu;
export const LICENSE_PATTERN =
  /(?:copyright|spdx-license-identifier|@license|licensed under|all rights reserved)/iu;
