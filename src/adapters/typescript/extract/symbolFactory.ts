import { relative } from "node:path";

import type { Node } from "ts-morph";

import type { Symbol as DocumentationSymbol } from "../../../core/symbol.js";
import { makeSymbolId } from "../../../core/id.js";
import { canonicalNode } from "../canonicalCode.js";
import type { TypeScriptProjectHandle } from "../loadProject.js";
import { sourceRange, toPosixPath } from "./range.js";

/**
 * Assemble a documentation symbol with a stable identifier, normalized file path, and source range.
 * @param handle Use the project handle to resolve the declaration's path relative to the project root.
 * @param declaration Provide the source node whose file and character range identify the symbol declaration.
 * @param data Supply the symbol metadata to enrich with its generated identifier, file path, and declaration range.
 */
export const makeSymbol = (
  handle: TypeScriptProjectHandle,
  declaration: Node,
  data: Omit<DocumentationSymbol, "id" | "filePath" | "declaration">,
): DocumentationSymbol => {
  const filePath = toPosixPath(
    relative(handle.root, declaration.getSourceFile().getFilePath()),
  );
  const discriminator =
    [
      data.kind === "getter" || data.kind === "setter" ? data.kind : undefined,
      data.static === true ? "static" : undefined,
    ]
      .filter(Boolean)
      .join(":") || undefined;

  return {
    ...data,
    canonicalCode: data.canonicalCode ?? canonicalNode(declaration),
    id: makeSymbolId(filePath, data.name, data.containerName, discriminator),
    filePath,
    declaration: sourceRange(
      declaration.getSourceFile(),
      declaration.getStart(),
      declaration.getEnd(),
    ),
  };
};
