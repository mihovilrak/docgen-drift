import type { SourceFile, ts } from "ts-morph";
import { getLineStarts } from "./extract/range.js";

const cache = new WeakMap<
  ts.SourceFile,
  { readonly starts: readonly number[]; readonly lines: readonly string[] }
>();

export const sourceLines = (
  file: SourceFile,
): {
  readonly starts: readonly number[];
  readonly lines: readonly string[];
} => {
  const key = file.compilerNode;
  const previous = cache.get(key);
  if (previous !== undefined) return previous;
  const text = file.getFullText();
  const result = { starts: getLineStarts(text), lines: text.split(/\r?\n/u) };
  cache.set(key, result);
  return result;
};
