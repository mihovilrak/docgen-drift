import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

import type { ProviderConfig } from "../config/provider.js";
import { judgeProviderConfig, type DocgenConfig } from "../config/schema.js";
import type { ModelCapabilities } from "../llm/capabilities.js";
import {
  providerCapabilities,
  providerStatus,
  type Env,
  type ProviderStatus,
} from "../llm/providers/index.js";

export type ProviderRole = "generate" | "judge";

/**
 * Describe an effective provider role, its credential preflight status, and its model limits, schema support, and pricing basis.
 */
export interface ProviderInspection {
  readonly role: ProviderRole;
  readonly enabled: boolean;
  readonly config: ProviderConfig;
  readonly model: string;
  readonly status: ProviderStatus;
  readonly capabilities: ModelCapabilities;
}

/**
 * Reads configuration, price tables and environment variable names only. No
 * provider is constructed and no credential is required or read.
 */
export const inspectProviders = (
  config: DocgenConfig,
  env: Env = process.env,
): readonly ProviderInspection[] => [
  inspect(
    "generate",
    true,
    config.generate.provider,
    config.generate.model,
    env,
  ),
  inspect(
    "judge",
    config.judge.enabled,
    judgeProviderConfig(config),
    config.judge.model,
    env,
  ),
];

const inspect = (
  role: ProviderRole,
  enabled: boolean,
  config: ProviderConfig,
  model: string,
  env: Env,
): ProviderInspection => ({
  role,
  enabled,
  config,
  model,
  status: providerStatus(config, env),
  capabilities: providerCapabilities(config, model),
});

export const renderProviders = (
  inspections: readonly ProviderInspection[],
): string => `${inspections.map(describe).join("\n")}\n`;

const describe = (item: ProviderInspection): string => {
  const limits = item.capabilities;
  const { price } = limits;
  return [
    `${item.role}: ${item.status.id} ${item.model}${item.enabled ? "" : " (disabled)"}`,
    `  context ${String(limits.contextWindowTokens)} tokens, max output ${String(limits.maxOutputTokens)} tokens, json schema ${limits.structuredOutput ? "enforced" : "not guaranteed"}`,
    `  cost ${limits.costBasis}${price === undefined ? "" : `, $${String(price.inputUsdPerMillion)} in / $${String(price.outputUsdPerMillion)} out per 1M tokens`}`,
    `  credentials ${item.status.credentials}: ${item.status.detail}`,
  ].join("\n");
};

export interface PreflightResult {
  readonly role: ProviderRole;
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Checks reachability of credentials without using them: environment variables
 * are tested for presence, CLI transports only for an executable on PATH.
 */
export const preflightProviders = async (
  inspections: readonly ProviderInspection[],
  env: Env = process.env,
): Promise<readonly PreflightResult[]> =>
  Promise.all(
    inspections
      .filter((item) => item.enabled)
      .map((item) => preflight(item, env)),
  );

const preflight = async (
  item: ProviderInspection,
  env: Env,
): Promise<PreflightResult> => {
  if (item.config.kind !== "cli") {
    return {
      role: item.role,
      id: item.status.id,
      ok: item.status.credentials !== "missing",
      detail: item.status.detail,
    };
  }
  const command = item.config.command ?? item.config.tool;
  const found = await onPath(command, env);
  return {
    role: item.role,
    id: item.status.id,
    ok: found,
    detail: found
      ? `${command} is on PATH; docgen inherits the login you already established`
      : `${command} is not installed or not on PATH`,
  };
};

/**
 * Format one newline-terminated status line per provider, or a plain message when no providers require checks.
 * @param results Preflight results to render, each containing a provider role, identifier, success status, and detail message.
 * @returns A newline-terminated preflight report.
 */
export const renderPreflight = (results: readonly PreflightResult[]): string =>
  results.length === 0
    ? "No providers to check.\n"
    : results
        .map(
          (result) =>
            `${result.role} ${result.id}: ${result.ok ? "ok" : "failed"}, ${result.detail}\n`,
        )
        .join("");

const onPath = async (command: string, env: Env): Promise<boolean> => {
  if (command.includes("/") || command.includes("\\")) {
    return executable(command);
  }
  const extensions =
    process.platform === "win32"
      ? (env["PATHEXT"] ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const directory of (env["PATH"] ?? "")
    .split(delimiter)
    .filter(Boolean)) {
    for (const extension of extensions) {
      if (await executable(join(directory, `${command}${extension}`)))
        return true;
    }
  }
  return false;
};

const executable = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};
