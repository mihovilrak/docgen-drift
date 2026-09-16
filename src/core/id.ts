import { posix } from "node:path";

import type { SymbolId } from "./symbol.js";

/**
 * Build a stable, workspace-portable identifier for a symbol from its file path, name, and optional container and discriminator.
 * @param filePath Source file path of the symbol; path separators are normalized and a leading './' is removed.
 * @param name The symbol's own name, used as-is when containerName is not given.
 * @param containerName Optional enclosing symbol name; when present, qualifies name as 'containerName.name'.
 * @param discriminator Optional suffix appended as ':discriminator' to distinguish otherwise-identical symbols.
 * @returns A string of the form "normalizedPath#qualifiedName" with an optional ":discriminator" suffix.
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
 * Rewrite a project-scoped symbol id into a workspace-scoped id by resolving its file path against the project's path within the workspace.
 * @param projectPath Path of the symbol's project relative to (or within) the workspace root, used to prefix the file path portion of the id.
 * @param projectSymbolId Symbol id scoped to its own project, in "filePath#name" form.
 * @returns The symbol id with its file path resolved against projectPath, or the original projectSymbolId if it contains no "#" separator.
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
