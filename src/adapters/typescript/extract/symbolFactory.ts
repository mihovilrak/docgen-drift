import { relative } from "node:path";

import type { Node } from "ts-morph";

import type { Symbol as DocumentationSymbol } from "../../../core/symbol.js";
import { makeSymbolId } from "../../../core/id.js";
import type { TypeScriptProjectHandle } from "../loadProject.js";
import { sourceRange, toPosixPath } from "./range.js";

export const makeSymbol = (
  handle: TypeScriptProjectHandle,
  declaration: Node,
  data: Omit<DocumentationSymbol, "id" | "filePath" | "declaration">,
): DocumentationSymbol => {
  const filePath = toPosixPath(
    relative(handle.root, declaration.getSourceFile().getFilePath()),
  );
  const discriminator =
    data.kind === "getter" || data.kind === "setter" ? data.kind : undefined;

  return {
    ...data,
    id: makeSymbolId(filePath, data.name, data.containerName, discriminator),
    filePath,
    declaration: sourceRange(
      declaration.getSourceFile(),
      declaration.getStart(),
      declaration.getEnd(),
    ),
  };
};
