import { posix } from "node:path";

import type { SymbolId } from "./symbol.js";

/**
 * Normalize the file path and combine the symbol's qualification and discriminator into a stable identifier.
 * @param filePath The source file path, with backslashes converted to forward slashes and a leading ./ removed.
 * @param name The symbol name.
 * @param containerName An optional containing symbol name to qualify before the symbol name.
 * @param discriminator An optional discriminator appended to distinguish otherwise equivalent symbols.
 */
export const makeSymbolId = (
  filePath: string,
  name: string,
  containerName?: string,
  discriminator?: string,
): SymbolId => {
  const normalizedPath = filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
  const qualifiedName =
    containerName === undefined ? name : `${containerName}.${name}`;
  return `${normalizedPath}#${qualifiedName}${discriminator === undefined ? "" : `:${discriminator}`}`;
};

/**
 * Resolve a project-relative symbol ID against the workspace path while preserving its symbol suffix.
 * @param projectPath Workspace path used to resolve the symbol's file path.
 * @param projectSymbolId Project-relative symbol ID whose file path should be made workspace-safe.
 */
export const workspaceSymbolId = (
  projectPath: string,
  projectSymbolId: SymbolId,
): SymbolId => {
  const separator = projectSymbolId.indexOf("#");
  if (separator < 0) return projectSymbolId;
  const filePath = projectSymbolId.slice(0, separator);
  const suffix = projectSymbolId.slice(separator);
  const normalizedProjectPath = projectPath.replaceAll("\\", "/");
  return `${posix.normalize(posix.join(normalizedProjectPath, filePath))}${suffix}`;
};
