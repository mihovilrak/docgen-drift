import type { DocgenConfig } from "../config/schema.js";

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
