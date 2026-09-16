import type { DocgenConfig } from "../config/schema.js";

/**
 * Preserve JSON paths and globs, map a directory to its tsconfig, or leave project discovery unchanged when no scope is given.
 * @param config The documentation-generation configuration to preserve or scope.
 * @param project An optional project directory, JSON configuration path, or glob pattern.
 */
export const scopeProjects = (
  config: DocgenConfig,
  project: string | undefined,
): DocgenConfig => {
  if (project === undefined) return config;
  const pattern =
    project.endsWith(".json") || /[*?{}[\]]/u.test(project)
      ? project
      : `${project.replace(/[\\/]$/u, "")}/tsconfig.json`;
  return {
    ...config,
    workspace: { ...config.workspace, projects: [pattern] },
  };
};
