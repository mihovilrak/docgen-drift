import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Result } from "./result.js";
import type { SymbolId } from "./symbol.js";

export const LOCK_SCHEMA_VERSION = 1;

export interface LockEntry {
  readonly symbolHash: string;
  readonly docHash: string;
  readonly filePath: string;
  readonly startLine: number;
}

export interface LockFile {
  readonly schemaVersion: typeof LOCK_SCHEMA_VERSION;
  readonly symbols: Readonly<Record<SymbolId, LockEntry>>;
}

export type LockErrorCode = "invalid" | "unsupported-version" | "io";

/**
 * Describe a failure encountered while reading, parsing, or writing a lock
 * file, including its category, the file involved, and a human-readable explanation.
 */
export interface LockError {
  readonly code: LockErrorCode;
  readonly path: string;
  readonly message: string;
}

/**
 * Create a schema-versioned lock file with no symbol entries.
 */
export const emptyLock = (): LockFile => ({
  schemaVersion: LOCK_SCHEMA_VERSION,
  symbols: {},
});

/**
 * Load and validate the lock file at the specified path, treating a missing file as an empty lock.
 * @param path Path to the lock file to read.
 */
export const readLock = async (
  path: string,
): Promise<Result<LockFile, LockError>> => {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ok: true, value: emptyLock() };
    }
    return failure("io", path, errorMessage(error));
  }

  try {
    return parseLock(JSON.parse(source) as unknown, path);
  } catch (error) {
    return failure("invalid", path, errorMessage(error));
  }
};

/**
 * Persist the lock data atomically at the specified path.
 * @param path Destination path for the lockfile.
 * @param lock Schema-versioned lockfile data to serialize.
 */
export const writeLock = async (
  path: string,
  lock: LockFile,
): Promise<Result<void, LockError>> => {
  const temporaryPath = `${path}.${String(process.pid)}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      temporaryPath,
      `${JSON.stringify(lock, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, path);
    return { ok: true, value: undefined };
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    return failure("io", path, errorMessage(error));
  }
};

const parseLock = (
  value: unknown,
  path: string,
): Result<LockFile, LockError> => {
  if (!isRecord(value))
    return failure("invalid", path, "Lockfile must be an object");

  const version = value.schemaVersion ?? 0;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 0
  ) {
    return failure(
      "invalid",
      path,
      "Lockfile schemaVersion must be a non-negative integer",
    );
  }
  if (version > LOCK_SCHEMA_VERSION) {
    return failure(
      "unsupported-version",
      path,
      `Lockfile schema version ${String(version)} is newer than supported version ${String(LOCK_SCHEMA_VERSION)}`,
    );
  }
  if (!isRecord(value.symbols)) {
    return failure("invalid", path, "Lockfile symbols must be an object");
  }

  const symbols: Record<SymbolId, LockEntry> = {};
  for (const [id, entry] of Object.entries(value.symbols)) {
    if (!isRecord(entry)) {
      return failure("invalid", path, `Lock entry ${id} must be an object`);
    }
    const symbolHash = entry.symbolHash ?? entry.symbol_hash;
    const docHash = entry.docHash ?? entry.doc_hash;
    const filePath =
      entry.filePath ?? id.slice(0, Math.max(0, id.indexOf("#")));
    const startLine = entry.startLine ?? 1;
    if (
      typeof symbolHash !== "string" ||
      typeof docHash !== "string" ||
      typeof filePath !== "string" ||
      typeof startLine !== "number" ||
      !Number.isInteger(startLine) ||
      startLine < 1
    ) {
      return failure("invalid", path, `Lock entry ${id} has invalid fields`);
    }
    symbols[id] = { symbolHash, docHash, filePath, startLine };
  }

  return {
    ok: true,
    value: { schemaVersion: LOCK_SCHEMA_VERSION, symbols },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown lockfile error";

const failure = <T>(
  code: LockErrorCode,
  path: string,
  message: string,
): Result<T, LockError> => ({ ok: false, error: { code, path, message } });
