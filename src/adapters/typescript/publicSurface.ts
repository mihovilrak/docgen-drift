import { relative, resolve } from "node:path";

import { glob } from "tinyglobby";
import { Node } from "ts-morph";

import type {
  Symbol as DocumentationSymbol,
  SymbolId,
} from "../../core/symbol.js";
import type { TypeScriptProjectHandle } from "./loadProject.js";

export const publicSurfaceSymbolIds = async (
  handle: TypeScriptProjectHandle,
  symbols: readonly DocumentationSymbol[],
  entryPoints: readonly string[],
): Promise<ReadonlySet<SymbolId>> => {
  const paths = await glob(entryPoints, {
    absolute: true,
    cwd: handle.root,
    ignore: ["**/node_modules/**", "**/*.d.ts"],
  });
  if (paths.length === 0) {
    throw new Error(
      `symbols.entryPoints did not match any source files in ${handle.root}`,
    );
  }

  const sourceFiles = paths.map((path) =>
    handle.project.getSourceFile(resolve(path)),
  );
  if (sourceFiles.some((sourceFile) => sourceFile === undefined)) {
    throw new Error(
      `symbols.entryPoints matched a file that is not part of ${handle.tsconfigPath}`,
    );
  }
  const declarations = sourceFiles
    .filter(isDefined)
    .flatMap((sourceFile) =>
      [...sourceFile.getExportedDeclarations().values()].flat(),
    );
  const exported = new Set(
    declarations.flatMap((declaration) => declarationKeys(handle, declaration)),
  );

  return new Set(
    symbols
      .filter(
        (symbol) =>
          symbol.exported &&
          exported.has(
            `${symbol.filePath}#${symbol.containerName ?? symbol.name}`,
          ),
      )
      .map((symbol) => symbol.id),
  );
};

const declarationKeys = (
  handle: TypeScriptProjectHandle,
  declaration: Node,
): readonly string[] => {
  const sourceFile = declaration.getSourceFile();
  const filePath = toPosix(relative(handle.root, sourceFile.getFilePath()));
  if (filePath.startsWith("..")) return [];

  if (Node.isVariableDeclaration(declaration)) {
    return [`${filePath}#${declaration.getName()}`];
  }
  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isClassDeclaration(declaration) ||
    Node.isInterfaceDeclaration(declaration) ||
    Node.isTypeAliasDeclaration(declaration) ||
    Node.isEnumDeclaration(declaration)
  ) {
    const name = declaration.getName();
    return name === undefined ? [] : [`${filePath}#${name}`];
  }
  return [];
};

const toPosix = (path: string): string => path.replaceAll("\\", "/");

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;
