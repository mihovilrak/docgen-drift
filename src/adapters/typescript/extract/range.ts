import { sep } from "node:path";

import type { SourceFile } from "ts-morph";

import type { SourceRange } from "../../../core/symbol.js";

/**
 * Build a SourceRange from two character offsets in a source file, adding the
 * line and column positions for each offset.
 * @param sourceFile Source file used to convert the offsets into line and
 *   column positions.
 * @param start Character offset where the range begins.
 * @param end Character offset where the range ends.
 * @returns A SourceRange holding the original start and end offsets plus the
 *   line and column for each, as reported by the source file.
 */
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

/**
 * Compute the zero-based character offset at which each line of the text
 * begins, for use in position-to-line lookups.
 * @param text Source text to scan for line feed (\n) characters.
 * @returns Ascending offsets, starting with 0 for the first line, followed by
 *   the offset just after each line feed. A trailing newline produces a final
 *   entry equal to the text length.
 */
export const getLineStarts = (text: string): readonly number[] => {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

/**
 * Locate the zero-based line containing a character offset by binary searching
 * the sorted line start offsets.
 * @param lineStarts Ascending character offsets at which each line begins, as
 *   produced by getLineStarts.
 * @param position Zero-based character offset in the source text to locate.
 * @returns Zero-based index of the line containing the position; positions
 *   before the first line start resolve to 0, and positions past the last line
 *   start resolve to the last line.
 */
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
