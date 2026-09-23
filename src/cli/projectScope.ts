import type { DocgenConfig } from "../config/schema.js";

/**
 * Constrain workspace project discovery to the requested directory, file, or glob pattern.
 * @param config The loaded documentation-generation configuration to preserve and update.
 * @param project An optional project directory, JSON file, or glob expression used to scope workspace discovery.
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
