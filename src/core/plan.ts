import type { LockEntry, LockFile } from "./lock.js";
import { EMPTY_DOC_HASH, type SymbolHashes } from "./hash.js";
import type { Symbol as DocumentationSymbol, SymbolId } from "./symbol.js";

export type CheckStatus = "unchanged" | "drifted" | "missing" | "orphaned";

/**
 * Bundle a symbol's freshly extracted data with its current hashes for comparison against a stored baseline.
 */
export interface CurrentSymbol {
  readonly id: SymbolId;
  readonly symbol: DocumentationSymbol;
  readonly hashes: SymbolHashes;
}

export interface CheckResult {
  readonly id: SymbolId;
  readonly status: CheckStatus;
  readonly filePath: string;
  readonly startLine: number;
  readonly symbol?: DocumentationSymbol;
}

/**
 * Classify each current symbol against the lock file, then flag stale lock entries as orphaned.
 * @param current Symbols extracted from the project's current source to classify against the lock file.
 * @param knownIds Symbol ids to exclude from orphan detection even though they are absent from current.
 * @param lock Previously recorded symbol state used to detect drift, missing docs, and orphans.
 * @returns Check results sorted by file path, then start line, then symbol id.
 */
export const classifySymbols = (
  current: readonly CurrentSymbol[],
  knownIds: ReadonlySet<SymbolId>,
  lock: LockFile,
): readonly CheckResult[] => {
  const results: CheckResult[] = [];
  const currentIds = new Set<SymbolId>();

  for (const item of current) {
    currentIds.add(item.id);
    const stored = lock.symbols[item.id];
    const status = classifyCurrent(item, stored);
    results.push({
      id: item.id,
      status,
      filePath: item.id.slice(0, item.id.indexOf("#")),
      startLine: item.symbol.declaration.startLine,
      symbol: item.symbol,
    });
  }

  for (const [id, entry] of Object.entries(lock.symbols)) {
    if (
      currentIds.has(id) ||
      knownIds.has(id) ||
      entry.docHash === EMPTY_DOC_HASH
    ) {
      continue;
    }
    results.push({
      id,
      status: "orphaned",
      filePath: entry.filePath,
      startLine: entry.startLine,
    });
  }

  return results.sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.startLine - right.startLine ||
      left.id.localeCompare(right.id),
  );
};

/**
 * Build a lock-file snapshot keyed by symbol id, deriving each entry's file path from the id prefix rather than the symbol's own location data.
 * @param current Symbols captured from the current source tree, each with its id, declaration, and computed hashes.
 */
export const lockEntries = (
  current: readonly CurrentSymbol[],
): Readonly<Record<SymbolId, LockEntry>> =>
  Object.fromEntries(
    current.map((item) => [
      item.id,
      {
        symbolHash: item.hashes.symbolHash,
        docHash: item.hashes.docHash,
        filePath: item.id.slice(0, item.id.indexOf("#")),
        startLine: item.symbol.declaration.startLine,
      },
    ]),
  );

const classifyCurrent = (
  current: CurrentSymbol,
  stored: LockEntry | undefined,
): CheckStatus => {
  if (current.symbol.existingDoc === null) return "missing";
  if (
    stored !== undefined &&
    stored.symbolHash !== current.hashes.symbolHash &&
    stored.docHash === current.hashes.docHash
  ) {
    return "drifted";
  }
  return "unchanged";
};
