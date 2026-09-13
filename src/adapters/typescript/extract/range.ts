import { sep } from "node:path";

import type { SourceFile } from "ts-morph";

import type { SourceRange } from "../../../core/symbol.js";

export const sourceRange = (
  sourceFile: SourceFile,
  start: number,
  end: number,
): SourceRange => {
  const startLocation = sourceFile.getLineAndColumnAtPos(start);
  const endLocation = sourceFile.getLineAndColumnAtPos(end);
  return {
    start,
    end,
    startLine: startLocation.line,
    startColumn: startLocation.column,
    endLine: endLocation.line,
    endColumn: endLocation.column,
  };
};

export const getLineStarts = (text: string): readonly number[] => {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

export const findLineIndex = (
  lineStarts: readonly number[],
  position: number,
): number => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = lineStarts[middle];
    const next = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;
    if (start === undefined) break;
    if (position < start) high = middle - 1;
    else if (position >= next) low = middle + 1;
    else return middle;
  }
  return Math.max(0, low - 1);
};

export const toPosixPath = (path: string): string => path.split(sep).join("/");
