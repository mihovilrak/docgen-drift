import { posix } from "node:path";

import type { SymbolId } from "./symbol.js";

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
