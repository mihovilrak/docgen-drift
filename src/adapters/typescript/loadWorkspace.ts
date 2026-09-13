import { dirname, relative, resolve } from "node:path";

import { glob } from "tinyglobby";
import { ts } from "ts-morph";

import {
  loadProject,
  type TypeScriptProjectHandle,
  type TypeScriptProjectOptions,
} from "./loadProject.js";

export interface WorkspaceOptions {
  readonly root: string;
  readonly projects: readonly string[];
  readonly projectConcurrency?: number;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export interface WorkspaceProject {
  readonly tsconfigPath: string;
  readonly root: string;
  readonly sourceFiles: readonly string[];
}

export interface Workspace {
  readonly root: string;
  readonly projects: readonly WorkspaceProject[];
  readonly projectConcurrency: number;
}

export class DuplicateSourceOwnershipError extends Error {
  readonly filePath: string;
  readonly projects: readonly string[];

  constructor(filePath: string, projects: readonly string[]) {
    super(
      `Source file ${filePath} is owned by multiple projects: ${projects.join(", ")}`,
    );
    this.name = "DuplicateSourceOwnershipError";
    this.filePath = filePath;
    this.projects = projects;
  }
}

export const resolveWorkspace = async (
  options: WorkspaceOptions,
): Promise<Workspace> => {
  const root = resolve(options.root);
  const projectConcurrency = options.projectConcurrency ?? 1;
  if (!Number.isInteger(projectConcurrency) || projectConcurrency < 1) {
    throw new Error("workspace.projectConcurrency must be a positive integer");
  }

  const tsconfigPaths = (
    await glob(options.projects, {
      absolute: true,
      cwd: root,
      ignore: ["**/node_modules/**"],
    })
  ).sort();

  if (tsconfigPaths.length === 0) {
    throw new Error("workspace.projects did not match any tsconfig files");
  }

  const projects = tsconfigPaths.map((tsconfigPath) => ({
    tsconfigPath,
    root: dirname(tsconfigPath),
    sourceFiles: readProjectFileNames(tsconfigPath),
  }));

  rejectDuplicateOwnership(root, projects);
  return { root, projects, projectConcurrency };
};

export const loadWorkspace = async <T>(
  options: WorkspaceOptions,
  visit: (project: TypeScriptProjectHandle) => Promise<T> | T,
): Promise<readonly T[]> => {
  const workspace = await resolveWorkspace(options);
  const results = new Array<T>(workspace.projects.length);
  let cursor = 0;

  const workers = Array.from(
    {
      length: Math.min(workspace.projectConcurrency, workspace.projects.length),
    },
    async () => {
      while (cursor < workspace.projects.length) {
        const index = cursor++;
        const descriptor = workspace.projects[index];
        if (descriptor === undefined) continue;

        const projectOptions: TypeScriptProjectOptions = {
          tsconfigPath: descriptor.tsconfigPath,
          ...(options.include === undefined
            ? {}
            : { include: options.include }),
          ...(options.exclude === undefined
            ? {}
            : { exclude: options.exclude }),
        };
        const project = await loadProject(projectOptions);
        results[index] = await visit(project);
      }
    },
  );

  await Promise.all(workers);
  return results;
};

const readProjectFileNames = (tsconfigPath: string): readonly string[] => {
  const configFile = ts.readConfigFile(tsconfigPath, (path) =>
    ts.sys.readFile(path),
  );
  if (configFile.error !== undefined) {
    throw new Error(formatDiagnostic(configFile.error));
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  );
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(formatDiagnostic).join("\n"));
  }

  return parsed.fileNames
    .filter((filePath) => !filePath.endsWith(".d.ts"))
    .map((filePath) => resolve(filePath))
    .sort();
};

const rejectDuplicateOwnership = (
  root: string,
  projects: readonly WorkspaceProject[],
): void => {
  const owners = new Map<string, string[]>();
  for (const project of projects) {
    for (const filePath of project.sourceFiles) {
      const projectPath = relative(root, project.tsconfigPath);
      const existing = owners.get(filePath);
      if (existing === undefined) owners.set(filePath, [projectPath]);
      else existing.push(projectPath);
    }
  }

  for (const [filePath, projectOwners] of owners) {
    if (projectOwners.length > 1) {
      throw new DuplicateSourceOwnershipError(
        relative(root, filePath),
        projectOwners,
      );
    }
  }
};

const formatDiagnostic = (diagnostic: ts.Diagnostic): string => {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
};
