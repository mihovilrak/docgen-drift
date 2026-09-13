import { access } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { glob } from "tinyglobby";
import { Project, type SourceFile } from "ts-morph";

export interface TypeScriptProjectOptions {
  readonly tsconfigPath: string;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export interface TypeScriptProjectHandle {
  readonly project: Project;
  readonly root: string;
  readonly tsconfigPath: string;
  readonly sourceFiles: readonly SourceFile[];
}

const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/*.d.ts",
];

export const resolveTsconfigPath = async (path: string): Promise<string> => {
  const absolutePath = resolve(path);
  const tsconfigPath = absolutePath.endsWith(".json")
    ? absolutePath
    : resolve(absolutePath, "tsconfig.json");

  await access(tsconfigPath);
  return tsconfigPath;
};

export const loadProject = async (
  options: TypeScriptProjectOptions,
): Promise<TypeScriptProjectHandle> => {
  const tsconfigPath = await resolveTsconfigPath(options.tsconfigPath);
  const root = dirname(tsconfigPath);
  const project = new Project({
    skipAddingFilesFromTsConfig: false,
    tsConfigFilePath: tsconfigPath,
  });

  const selectedFiles = await selectFiles(
    root,
    project.getSourceFiles(),
    project.getCompilerOptions().outDir,
    options.include,
    options.exclude,
  );

  return {
    project,
    root,
    tsconfigPath,
    sourceFiles: selectedFiles,
  };
};

const selectFiles = async (
  root: string,
  sourceFiles: readonly SourceFile[],
  outDir: string | undefined,
  includes: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
): Promise<readonly SourceFile[]> => {
  const resolvedOutDir =
    outDir === undefined ? undefined : resolve(root, outDir);
  const candidates = sourceFiles.filter((sourceFile) => {
    const filePath = sourceFile.getFilePath();
    const relativePath = relative(root, filePath);
    const pathSegments = relativePath.split(/[\\/]/u);
    return (
      !sourceFile.isDeclarationFile() &&
      !relativePath.startsWith("..") &&
      !isAbsolute(relativePath) &&
      !pathSegments.some((segment) =>
        ["node_modules", "dist", "build"].includes(segment),
      ) &&
      (resolvedOutDir === undefined || !isWithin(resolvedOutDir, filePath))
    );
  });

  if (includes === undefined && excludes === undefined) {
    return candidates;
  }

  const matched = new Set(
    (
      await glob(includes ?? ["**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"], {
        absolute: true,
        cwd: root,
        ignore: [...DEFAULT_EXCLUDES, ...(excludes ?? [])],
      })
    ).map((filePath) => resolve(filePath)),
  );

  return candidates.filter((sourceFile) =>
    matched.has(resolve(sourceFile.getFilePath())),
  );
};

const isWithin = (parent: string, child: string): boolean => {
  const relativePath = relative(parent, child);
  return !relativePath.startsWith("..") && !isAbsolute(relativePath);
};
