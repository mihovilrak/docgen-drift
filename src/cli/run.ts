import { join } from "node:path";

import {
  LOCK_SCHEMA_VERSION,
  readLock,
  writeLock,
  type LockFile,
} from "../core/lock.js";
import {
  classifySymbols,
  lockEntries,
  type CheckResult,
} from "../core/plan.js";
import type { DocgenConfig } from "../config/schema.js";
import { ConfigError } from "../config/load.js";
import {
  canonicalId,
  currentSymbols,
  indexWorkspace,
  knownSymbolIds,
  type ProjectIndex,
} from "./workspace.js";

export interface BaselineResult {
  readonly symbols: number;
  readonly lockfiles: readonly string[];
}

export interface WorkspaceCheckResult {
  readonly results: readonly CheckResult[];
  readonly projects: readonly {
    readonly path: string;
    readonly symbolIds: readonly string[];
  }[];
}

/**
 * Create lockfiles containing the current workspace symbol baseline.
 * @param root Workspace root to index and use for shared lockfile placement.
 * @param config Documentation configuration controlling workspace lockfile mode and symbol indexing policies.
 * @returns A promise resolving to the number of baselined symbols and the paths of the lockfiles written.
 */
export const runBaseline = async (
  root: string,
  config: DocgenConfig,
): Promise<BaselineResult> => {
  const projects = await indexWorkspace(root, config);
  if (config.workspace.lockfile === "shared") {
    const current = projects.flatMap((project) =>
      currentSymbols(project, config, true),
    );
    const path = sharedLockPath(root);
    await saveLock(path, {
      schemaVersion: LOCK_SCHEMA_VERSION,
      symbols: lockEntries(current),
    });
    return { symbols: current.length, lockfiles: [path] };
  }

  const lockfiles: string[] = [];
  let symbols = 0;
  for (const project of projects) {
    const current = currentSymbols(project, config, false);
    const path = projectLockPath(project);
    await saveLock(path, {
      schemaVersion: LOCK_SCHEMA_VERSION,
      symbols: lockEntries(current),
    });
    lockfiles.push(path);
    symbols += current.length;
  }
  return { symbols, lockfiles };
};

/**
 * Compare current workspace symbols with configured lock files and report drift consistently for shared or per-project locking.
 * @param root Workspace root used to index projects and locate lock files.
 * @param config Documentation and workspace-lock configuration controlling project scope, symbol policies, and lockfile mode.
 */
export const runCheck = async (
  root: string,
  config: DocgenConfig,
): Promise<WorkspaceCheckResult> => {
  const projects = await indexWorkspace(root, config);
  const projectTargets = projects.map((project) => ({
    path: project.projectPath ?? "tsconfig.json",
    symbolIds: project.eligible.map((symbol) =>
      canonicalId(project, symbol.id, true),
    ),
  }));
  if (config.workspace.lockfile === "shared") {
    const lock = await loadLock(sharedLockPath(root));
    const current = projects.flatMap((project) =>
      currentSymbols(project, config, true),
    );
    const known = new Set(
      projects.flatMap((project) => [...knownSymbolIds(project, true)]),
    );
    const selected = new Set(projects.map((project) => project.projectPath));
    const scopedLock =
      config.projectSelection === undefined
        ? lock
        : {
            ...lock,
            symbols: Object.fromEntries(
              Object.entries(lock.symbols).filter(([, entry]) =>
                selected.has(entry.project),
              ),
            ),
          };
    return {
      results: classifySymbols(current, known, scopedLock),
      projects: projectTargets,
    };
  }

  const results: CheckResult[] = [];
  for (const project of projects) {
    const lock = await loadLock(projectLockPath(project));
    const local = classifySymbols(
      currentSymbols(project, config, false),
      knownSymbolIds(project, false),
      lock,
    );
    results.push(...local.map((result) => workspaceResult(project, result)));
  }
  return { results: results.sort(compareResults), projects: projectTargets };
};

/**
 * Persist updated symbol hashes in the configured shared or per-project workspace lockfiles.
 * @param root Workspace root used to index projects and resolve lockfile paths.
 * @param config Documentation configuration controlling workspace indexing and whether locks are shared or project-specific.
 * @param generatedIds Identifiers of generated symbols whose current snapshots should be written to the lockfiles.
 */
export const refreshLocks = async (
  root: string,
  config: DocgenConfig,
  generatedIds: ReadonlySet<string>,
  updatedProjects?: readonly ProjectIndex[],
): Promise<void> => {
  const projects = updatedProjects ?? (await indexWorkspace(root, config));
  if (config.workspace.lockfile === "shared") {
    const path = sharedLockPath(root);
    const previous = await loadLock(path);
    const current = projects
      .flatMap((project) => currentSymbols(project, config, true))
      .filter((symbol) => generatedIds.has(symbol.id));
    await saveLock(path, {
      schemaVersion: LOCK_SCHEMA_VERSION,
      symbols: { ...previous.symbols, ...lockEntries(current) },
    });
    return;
  }

  for (const project of projects) {
    const path = projectLockPath(project);
    const previous = await loadLock(path);
    const current = currentSymbols(project, config, false).filter((symbol) =>
      generatedIds.has(canonicalId(project, symbol.id, true)),
    );
    await saveLock(path, {
      schemaVersion: LOCK_SCHEMA_VERSION,
      symbols: {
        ...previous.symbols,
        ...lockEntries(current),
      },
    });
  }
};

const loadLock = async (path: string): Promise<LockFile> => {
  const result = await readLock(path);
  if (!result.ok) throw new ConfigError(result.error.message);
  return result.value;
};

const saveLock = async (path: string, lock: LockFile): Promise<void> => {
  const result = await writeLock(path, lock);
  if (!result.ok) throw new Error(result.error.message);
};

const workspaceResult = (
  project: ProjectIndex,
  result: CheckResult,
): CheckResult => ({
  ...result,
  id: canonicalId(project, result.id, true),
  filePath: canonicalId(project, `${result.filePath}#file`, true).slice(0, -5),
});

const compareResults = (left: CheckResult, right: CheckResult): number =>
  left.filePath.localeCompare(right.filePath) ||
  left.startLine - right.startLine;

const sharedLockPath = (root: string): string =>
  join(root, ".docgen", "lock.json");

const projectLockPath = (project: ProjectIndex): string =>
  join(project.root, ".docgen", "lock.json");
