import { relative, resolve } from "node:path";

import { loadWorkspace } from "../adapters/typescript/loadWorkspace.js";
import { ConfigError } from "../config/load.js";
import type { DocgenConfig } from "../config/schema.js";
import { unifiedDiff } from "../core/diff.js";
import { isWorkingTreeDirty } from "../core/git.js";
import type { SymbolId } from "../core/symbol.js";
import type { LlmProvider, ProviderUsage } from "../llm/client.js";
import { createProvider } from "../llm/providers/index.js";
import { refreshLocks, runCheck } from "./run.js";
import { type ProjectIndex } from "./workspace.js";
import {
  generateProject,
  type ProjectGenerationResult,
} from "./generateProject.js";

export type FixMode = "drifted" | "missing";

export interface GenerationOptions {
  readonly mode: FixMode;
  readonly path?: string;
  readonly dryRun?: boolean;
  readonly allowDirty?: boolean;
}

export interface GenerationRunResult {
  readonly requested: number;
  readonly generated: readonly SymbolId[];
  readonly skipped: readonly {
    readonly id: SymbolId;
    readonly reason: string;
  }[];
  readonly failed: readonly {
    readonly id: SymbolId;
    readonly reason: string;
  }[];
  readonly changedFiles: number;
  readonly usage: ProviderUsage;
  readonly diff: string;
}

export const runGeneration = async (
  root: string,
  config: DocgenConfig,
  options: GenerationOptions,
  injectedProvider?: LlmProvider,
): Promise<GenerationRunResult> => {
  validateGenerationOptions(config, options);
  if (options.dryRun !== true && options.allowDirty !== true) {
    if (await isWorkingTreeDirty(root)) {
      throw new ConfigError(
        "Refusing to modify a dirty working tree; commit changes or pass --allow-dirty",
      );
    }
  }

  const check = await runCheck(root, config);
  const targetIds = new Set(
    check.results
      .filter(
        (result) =>
          result.status === options.mode &&
          (options.path === undefined ||
            withinPath(result.filePath, options.path)),
      )
      .map((result) => result.id),
  );
  if (targetIds.size > config.generate.maxSymbolsPerRun) {
    throw new ConfigError(
      `Generation selected ${String(targetIds.size)} symbols, exceeding generate.maxSymbolsPerRun (${String(config.generate.maxSymbolsPerRun)})`,
    );
  }
  if (targetIds.size === 0) return emptyResult();

  const provider = injectedProvider ?? createProvider(config.generate.provider);
  const projectResults = await loadWorkspace(
    {
      root,
      projects: config.workspace.projects,
      projectConcurrency: config.workspace.projectConcurrency,
      include: [...config.include, ...config.tests],
      exclude: config.exclude,
    },
    async (
      project,
    ): Promise<{
      readonly workspacePath: string;
      readonly result: ProjectGenerationResult;
    }> => {
      const projectIndex: ProjectIndex = {
        root: project.root,
        workspacePath: workspacePath(root, project.root),
        symbols: [],
        eligible: [],
      };
      const localTargets = new Set(
        [...targetIds].map((id) => localId(projectIndex, id)).filter(isDefined),
      );
      return {
        workspacePath: projectIndex.workspacePath,
        result: await generateProject(
          project,
          localTargets,
          config,
          provider,
          options.dryRun !== true,
        ),
      };
    },
  );

  const generated = projectResults.flatMap((project) =>
    project.result.generated.map((id) =>
      canonicalResultId(project.workspacePath, id),
    ),
  );
  const skipped = projectResults.flatMap((project) =>
    project.result.skipped.map((item) => ({
      ...item,
      id: canonicalResultId(project.workspacePath, item.id),
    })),
  );
  const failed = projectResults.flatMap((project) =>
    project.result.failed.map((item) => ({
      ...item,
      id: canonicalResultId(project.workspacePath, item.id),
    })),
  );
  const files = projectResults.flatMap((project) => project.result.edits.files);
  if (options.dryRun !== true && generated.length > 0) {
    await refreshLocks(root, config, new Set(generated));
  }
  return {
    requested: targetIds.size,
    generated,
    skipped,
    failed,
    changedFiles: files.length,
    usage: projectResults.reduce(
      (usage, project) => addUsage(usage, project.result.usage),
      emptyUsage(),
    ),
    diff: files
      .map((file) =>
        unifiedDiff(
          relative(root, file.filePath).replaceAll("\\", "/"),
          file.before,
          file.after,
        ),
      )
      .filter(Boolean)
      .join("\n"),
  };
};

const validateGenerationOptions = (
  config: DocgenConfig,
  options: GenerationOptions,
): void => {
  if (options.mode === "missing" && options.path === undefined) {
    throw new ConfigError("Missing-doc backfill requires --path <path>");
  }
  if (config.docs.leadingComments.onGenerate === "replace") {
    throw new ConfigError(
      "docs.leadingComments.onGenerate=replace requires the Phase 5 judge",
    );
  }
};

const localId = (project: ProjectIndex, id: SymbolId): SymbolId | undefined => {
  const prefix =
    project.workspacePath === "." ? "" : `${project.workspacePath}/`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : undefined;
};

const canonicalResultId = (projectPath: string, id: SymbolId): SymbolId =>
  projectPath === "." ? id : `${projectPath}/${id}`;

const workspacePath = (root: string, projectRoot: string): string => {
  const path = relative(resolve(root), resolve(projectRoot));
  return path === "" ? "." : path.replaceAll("\\", "/");
};

const withinPath = (filePath: string, scope: string): boolean => {
  const normalizedFile = filePath.replaceAll("\\", "/");
  const normalizedScope = scope
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/$/u, "");
  return (
    normalizedScope === "." ||
    normalizedFile === normalizedScope ||
    normalizedFile.startsWith(`${normalizedScope}/`)
  );
};

const emptyUsage = (): ProviderUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
});

const addUsage = (
  left: ProviderUsage,
  right: ProviderUsage,
): ProviderUsage => ({
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  costUsd: left.costUsd + right.costUsd,
});

const emptyResult = (): GenerationRunResult => ({
  requested: 0,
  generated: [],
  skipped: [],
  failed: [],
  changedFiles: 0,
  usage: emptyUsage(),
  diff: "",
});

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;
