import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { CheckResult } from "../core/plan.js";

const execFileAsync = promisify(execFile);

interface ChangedFile {
  readonly ranges: readonly LineRange[];
}

interface LineRange {
  readonly start: number;
  readonly end: number;
}

export class SinceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SinceError";
  }
}

/**
 * Read changed-file ranges from a Git diff against the specified reference.
 * @param root Working directory in which to run Git.
 * @param reference Git reference to compare against.
 * @returns A promise resolving to a map of changed file paths and their changed line ranges.
 */
export const readChangedFiles = async (
  root: string,
  reference: string,
): Promise<ReadonlyMap<string, ChangedFile>> => {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--unified=0", "--no-ext-diff", "--relative", reference, "--"],
      { cwd: root, maxBuffer: 20 * 1024 * 1024 },
    );
    return parseDiff(stdout);
  } catch (error) {
    throw new SinceError(
      `Cannot diff ${reference}: ${error instanceof Error ? error.message : "git failed"}`,
    );
  }
};

/**
 * Retain results from changed files whose declarations overlap a diff range, along with orphaned or symbol-less results.
 * @param results The check results to filter.
 * @param changed A map of changed file paths to their modified line ranges.
 */
export const filterByChanges = (
  results: readonly CheckResult[],
  changed: ReadonlyMap<string, ChangedFile>,
): readonly CheckResult[] =>
  results.filter((result) => {
    const file = changed.get(result.filePath);
    if (file === undefined) return false;
    if (result.status === "orphaned" || result.symbol === undefined)
      return true;
    return file.ranges.some(
      (range) =>
        result.symbol !== undefined &&
        result.symbol.declaration.startLine <= range.end &&
        result.symbol.declaration.endLine >= range.start,
    );
  });

const parseDiff = (diff: string): ReadonlyMap<string, ChangedFile> => {
  const ranges = new Map<string, LineRange[]>();
  let currentPath: string | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- a/")) {
      currentPath = line.slice(6);
      if (!ranges.has(currentPath)) ranges.set(currentPath, []);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      currentPath = line.slice(6);
      if (!ranges.has(currentPath)) ranges.set(currentPath, []);
      continue;
    }
    if (line === "+++ /dev/null") {
      continue;
    }
    if (!line.startsWith("@@") || currentPath === undefined) continue;
    const match = /\+(\d+)(?:,(\d+))?/u.exec(line);
    if (match === null) continue;
    const start = Number(match[1]);
    const count = Number(match[2] ?? 1);
    ranges.get(currentPath)?.push({
      start: Math.max(1, start),
      end: Math.max(1, start + Math.max(1, count) - 1),
    });
  }
  return new Map(
    [...ranges].map(([path, fileRanges]) => [path, { ranges: fileRanges }]),
  );
};
