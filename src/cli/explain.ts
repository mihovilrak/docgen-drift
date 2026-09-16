import { relative, resolve } from "node:path";

import { glob } from "tinyglobby";

import { buildGraph } from "../adapters/typescript/graph.js";
import { extractSymbols } from "../adapters/typescript/extract/index.js";
import { loadWorkspace } from "../adapters/typescript/loadWorkspace.js";
import type { DocgenConfig } from "../config/schema.js";
import { assembleContext, type AssembledContext } from "../core/budget.js";
import { findGitSubject } from "../core/git.js";
import { ConfigError } from "../config/load.js";
import type { Symbol as DocumentationSymbol } from "../core/symbol.js";
import { canonicalId, type ProjectIndex } from "./workspace.js";

interface ExplainCandidate {
  readonly label: string;
  readonly context: AssembledContext;
}

/**
 * Assemble offline context for the uniquely matched workspace symbol.
 * @param root Workspace root used to load projects and compute project-relative symbol labels.
 * @param query Symbol query used to select candidate symbols.
 * @param config Configuration controlling workspace discovery, symbol extraction, context sources, limits, and formatting.
 */
export const runExplain = async (
  root: string,
  query: string,
  config: DocgenConfig,
): Promise<AssembledContext> => {
  const results = (
    await loadWorkspace(
      {
        root,
        projects: config.workspace.projects,
        projectConcurrency: config.workspace.projectConcurrency,
        include: [...config.include, ...config.tests],
        exclude: config.exclude,
      },
      async (project): Promise<readonly ExplainCandidate[]> => {
        const symbols = extractSymbols(project, {
          includeNonFunctionVariables:
            config.symbols.kinds.includes("variable"),
        });
        const projectIndex: ProjectIndex = {
          root: project.root,
          workspacePath: relativeProjectPath(root, project.root),
          symbols,
          eligible: symbols,
        };
        const matches = symbols.filter((symbol) =>
          matchesQuery(projectIndex, symbol, query),
        );
        if (matches.length === 0) return [];

        const testFilePaths = new Set(
          (
            await glob(config.tests, {
              absolute: true,
              cwd: project.root,
              ignore: config.exclude,
            })
          ).map((path) => resolve(path)),
        );
        const requestedIds = new Set(matches.map((symbol) => symbol.id));
        const index = buildGraph(project, symbols, {
          testFilePaths,
          callSiteLines: config.context.callSites.lines,
          referencedTypeSymbolIds: requestedIds,
        });

        return Promise.all(
          matches.map(async (symbol) => {
            const gitSubject = config.context.sources.gitSubject
              ? await findGitSubject({
                  root: project.root,
                  filePath: symbol.filePath,
                  startLine: symbol.declaration.startLine,
                  endLine: symbol.declaration.endLine,
                  timeoutMs: config.context.git.timeoutMs,
                })
              : undefined;
            return {
              label: canonicalId(projectIndex, symbol.id, true),
              // No provider is constructed here: `explain` stays offline and
              // credential-free, so it reports the conservative token estimate.
              context: assembleContext({
                symbol,
                symbols,
                graph: index.graph,
                index: index.context,
                budgetTokens: config.context.budgetTokens,
                model: config.generate.model,
                sources: config.context.sources,
                includeSourceNotes:
                  config.docs.leadingComments.includeInContext,
                bodyMaxLines: config.context.bodyMaxLines,
                callSiteMax: config.context.callSites.max,
                callSiteSampling: config.context.callSites.sampling,
                ...(gitSubject === undefined ? {} : { gitSubject }),
              }),
            };
          }),
        );
      },
    )
  ).flat();

  if (results.length === 0) {
    throw new ConfigError(`No symbol matches ${query}`);
  }
  if (results.length > 1) {
    throw new ConfigError(
      `Symbol ${query} is ambiguous; use one of: ${results.map((result) => result.label).join(", ")}`,
    );
  }
  const match = results[0];
  if (match === undefined) throw new ConfigError(`No symbol matches ${query}`);
  return match.context;
};

const matchesQuery = (
  project: ProjectIndex,
  symbol: DocumentationSymbol,
  query: string,
): boolean =>
  query === symbol.id ||
  query === canonicalId(project, symbol.id, true) ||
  query === symbol.name ||
  query ===
    (symbol.containerName === undefined
      ? symbol.name
      : `${symbol.containerName}.${symbol.name}`);

const relativeProjectPath = (
  workspaceRoot: string,
  projectRoot: string,
): string => {
  const projectPath = relative(resolve(workspaceRoot), resolve(projectRoot));
  return projectPath === "" ? "." : projectPath.replaceAll("\\", "/");
};
