/**
 * Generate a unified diff with file headers and surrounding context for changed lines.
 * @param path The file path to include in the diff headers.
 * @param before The original file contents.
 * @param after The updated file contents.
 */
export const unifiedDiff = (
  path: string,
  before: string,
  after: string,
): string => {
  if (before === after) return "";
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - suffix - 1] ===
      newLines[newLines.length - suffix - 1]
  ) {
    suffix++;
  }

  const contextStart = Math.max(0, prefix - 3);
  const oldEnd = Math.min(oldLines.length, oldLines.length - suffix + 3);
  const newEnd = Math.min(newLines.length, newLines.length - suffix + 3);
  const oldCount = oldEnd - contextStart;
  const newCount = newEnd - contextStart;
  const commonBefore = oldLines.slice(contextStart, prefix).map(prefixLine);
  const removed = oldLines
    .slice(prefix, oldLines.length - suffix)
    .map(removeLine);
  const added = newLines.slice(prefix, newLines.length - suffix).map(addLine);
  const commonAfter = oldLines
    .slice(oldLines.length - suffix, oldEnd)
    .map(prefixLine);

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${String(contextStart + 1)},${String(oldCount)} +${String(contextStart + 1)},${String(newCount)} @@`,
    ...commonBefore,
    ...removed,
    ...added,
    ...commonAfter,
  ].join("\n");
};

const splitLines = (source: string): readonly string[] =>
  source.replace(/\r\n/gu, "\n").replace(/\n$/u, "").split("\n");

const prefixLine = (line: string): string => ` ${line}`;
const removeLine = (line: string): string => `-${line}`;
const addLine = (line: string): string => `+${line}`;
