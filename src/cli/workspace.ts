import { relative, resolve } from "node:path";

import { glob } from "tinyglobby";

import { ConfigError } from "../config/load.js";
import type { DocgenConfig } from "../config/schema.js";
import { hashSymbol, hashText, type HashRecipe } from "../core/hash.js";
import { workspaceSymbolId } from "../core/id.js";
import { PROMPT_VERSION } from "../llm/prompt/index.js";
import type { CurrentSymbol } from "../core/plan.js";
import type {
  Symbol as DocumentationSymbol,
  SymbolId,
} from "../core/symbol.js";

export interface ProjectIndex {
  readonly root: string;
  readonly workspacePath: string;
  readonly symbols: readonly DocumentationSymbol[];
  readonly eligible: readonly DocumentationSymbol[];
}

/**
 * Build project indexes for the workspace, applying configured inclusion, exclusion, symbol, and public-surface policies.
 * @param root Workspace root used to resolve project paths and workspace-relative paths.
 * @param config Documentation configuration controlling projects, file selection, exclusions, symbol filtering, test files, and public-surface rules.
 * @returns A promise resolving to one project index per loaded workspace project, including all extracted symbols and the eligible symbols selected for documentation.
 */
export const indexWorkspace = async (
  root: string,
  config: DocgenConfig,
): Promise<readonly ProjectIndex[]> => {
  const [{ extractSymbols }, { loadWorkspace }, { publicSurfaceSymbolIds }] =
    await Promise.all([
      import("../adapters/typescript/extract/index.js"),
      import("../adapters/typescript/loadWorkspace.js"),
      import("../adapters/typescript/publicSurface.js"),
    ]);
  const includes = [...config.include, ...config.tests];
  return loadWorkspace(
    {
      root,
      projects: config.workspace.projects,
      projectConcurrency: config.workspace.projectConcurrency,
      include: includes,
      exclude: config.exclude,
    },
    async (project) => {
      const symbols = extractSymbols(project, {
        includeNonFunctionVariables: config.symbols.kinds.includes("variable"),
      });
      const ignoredContainers = new Set(
        symbols
          .filter((symbol) =>
            config.symbols.ignorePragmas.some((pragma) =>
              hasPragma(symbol, pragma),
            ),
          )
          .map((symbol) => `${symbol.filePath}#${symbol.name}`),
      );
      const testFiles = new Set(
        (
          await glob(config.tests, {
            absolute: true,
            cwd: project.root,
            ignore: config.exclude,
          })
        ).map((path) => resolve(path)),
      );
      const entryPointSymbols =
        config.symbols.exportedOnly &&
        config.symbols.publicSurface === "entryPoints"
          ? await configuredPublicSurface(
              () =>
                publicSurfaceSymbolIds(
                  project,
                  symbols,
                  config.symbols.entryPoints,
                ),
              project.tsconfigPath,
            )
          : undefined;
      return {
        root: project.root,
        workspacePath: toPosix(relative(root, project.root)),
        symbols,
        eligible: symbols.filter(
          (symbol) =>
            !testFiles.has(resolve(project.root, symbol.filePath)) &&
            isEligible(symbol, ignoredContainers, config, entryPointSymbols),
        ),
      };
    },
  );
};

/**
 * Build the hashable symbol snapshot used by workspace lock operations.
 * @param project Project index whose eligible symbols are included.
 * @param config Documentation settings used to create the hashing recipe.
 * @param shared Whether to use shared-workspace symbol identifiers.
 * @returns An array of eligible symbols with canonical IDs and stable content and documentation hashes.
 */
export const currentSymbols = (
  project: ProjectIndex,
  config: DocgenConfig,
  shared: boolean,
): readonly CurrentSymbol[] => {
  const recipe = hashRecipe(config);
  return project.eligible.map((symbol) => ({
    id: canonicalId(project, symbol.id, shared),
    symbol,
    hashes: hashSymbol(symbol, recipe),
  }));
};

/**
 * Collect canonical symbol IDs for the project's symbols, using shared-workspace normalization when requested.
 * @param project Project index whose symbols supply the IDs.
 * @param shared Whether to canonicalize IDs using shared-workspace rules.
 */
export const knownSymbolIds = (
  project: ProjectIndex,
  shared: boolean,
): ReadonlySet<SymbolId> =>
  new Set(
    project.symbols.map((symbol) => canonicalId(project, symbol.id, shared)),
  );

export const canonicalId = (
  project: ProjectIndex,
  id: SymbolId,
  shared: boolean,
): SymbolId => (shared ? workspaceSymbolId(project.workspacePath, id) : id);

/**
 * Build a stable workspace-hash recipe from documentation settings, symbol selection, and the active prompt version.
 * @param config Documentation configuration used to derive source-note inclusion and the configuration fingerprint.
 */
export const hashRecipe = (config: DocgenConfig): HashRecipe => ({
  includeSourceNotes: config.docs.leadingComments.includeInContext,
  contextRecipeVersion: "2",
  promptVersion: PROMPT_VERSION,
  configFingerprint: hashText(
    JSON.stringify({
      symbols: config.symbols,
      docs: config.docs,
    }),
  ),
});

const isEligible = (
  symbol: DocumentationSymbol,
  ignoredContainers: ReadonlySet<string>,
  config: DocgenConfig,
  entryPointSymbols: ReadonlySet<SymbolId> | undefined,
): boolean =>
  matchesKind(symbol, config.symbols.kinds) &&
  (!config.symbols.exportedOnly ||
    (entryPointSymbols === undefined
      ? symbol.exported
      : entryPointSymbols.has(symbol.id))) &&
  config.symbols.visibility.includes(symbol.visibility) &&
  bodyLines(symbol.body) >= config.symbols.minBodyLines &&
  !config.symbols.ignorePragmas.some((pragma) => hasPragma(symbol, pragma)) &&
  !containerIsIgnored(symbol, ignoredContainers);

const matchesKind = (
  symbol: DocumentationSymbol,
  kinds: readonly string[],
): boolean => {
  const configuredKind =
    symbol.kind === "variable-function"
      ? "arrow"
      : symbol.kind === "type-alias"
        ? "typeAlias"
        : symbol.kind === "getter" || symbol.kind === "setter"
          ? "accessor"
          : symbol.kind === "method-signature"
            ? "method"
            : symbol.kind;
  return kinds.includes(configuredKind);
};

const bodyLines = (body: string): number => {
  const trimmed = body.trim();
  return trimmed === "" ? 0 : trimmed.split(/\r?\n/u).length;
};

const hasPragma = (symbol: DocumentationSymbol, pragma: string): boolean =>
  symbol.existingDoc?.raw.includes(pragma) === true ||
  symbol.sourceNote?.raw.includes(pragma) === true;

const containerIsIgnored = (
  symbol: DocumentationSymbol,
  ignoredContainers: ReadonlySet<string>,
): boolean =>
  symbol.containerName !== undefined &&
  ignoredContainers.has(`${symbol.filePath}#${symbol.containerName}`);

const toPosix = (path: string): string =>
  path === "" ? "." : path.replaceAll("\\", "/");

const configuredPublicSurface = async (
  load: () => Promise<ReadonlySet<SymbolId>>,
  tsconfigPath: string,
): Promise<ReadonlySet<SymbolId>> => {
  try {
    return await load();
  } catch (error) {
    throw new ConfigError(
      `Cannot resolve symbols.entryPoints for ${tsconfigPath}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
};
