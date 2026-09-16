import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  type ModelCapabilities,
} from "../capabilities.js";
import type {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
} from "../client.js";
import type { ProviderUsage } from "../usage.js";

export type CliTool = "claude" | "codex" | "gemini" | "opencode" | "pi";

export interface CliTransportOptions {
  readonly tool: CliTool;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  readonly run?: CliRunner;
}

export interface CliRunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly spawnError?: NodeJS.ErrnoException;
  readonly timedOut?: boolean;
}

export type CliRunner = (
  command: string,
  args: readonly string[],
  input: string,
  options: {
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
    readonly env?: NodeJS.ProcessEnv;
  },
) => Promise<CliRunResult>;

/**
 * Non-interactive argv per tool. Read-only, tool-less and session-less by
 * construction: docgen owns batching and edits, the CLI only completes text.
 * Authentication is whatever the user already established for the executable;
 * docgen never touches credential files.
 */
const ARGV: Record<
  CliTool,
  (
    model: string,
    artifacts?: Readonly<Record<string, string>>,
  ) => readonly string[]
> = {
  claude: (model, artifacts) => [
    "-p",
    "--model",
    model,
    "--output-format",
    "json",
    ...(artifacts?.["schemaJson"] === undefined
      ? []
      : ["--json-schema", artifacts["schemaJson"]]),
    "--tools",
    "",
    "--permission-mode",
    "plan",
    "--max-turns",
    "1",
    "--no-session-persistence",
  ],
  codex: (model, artifacts) => [
    "exec",
    "--model",
    model,
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--json",
    "--ignore-user-config",
    "--skip-git-repo-check",
    ...(artifacts?.["schema"] === undefined
      ? []
      : ["--output-schema", artifacts["schema"]]),
    "-",
  ],
  gemini: (model, artifacts) => [
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--approval-mode",
    "plan",
    "--extensions",
    "none",
    ...(artifacts?.["policy"] === undefined
      ? []
      : ["--admin-policy", artifacts["policy"]]),
  ],
  opencode: (model) => ["--pure", "run", "--format", "json", "--model", model],
  pi: (model) => [
    "--print",
    "--mode",
    "json",
    "--no-session",
    "--no-tools",
    "--no-skills",
    "--model",
    model,
  ],
};

export class CliTransportProvider implements LlmProvider {
  readonly id: string;
  readonly #options: CliTransportOptions;

  constructor(options: CliTransportOptions) {
    this.id = `cli:${options.tool}`;
    this.#options = options;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const command = this.#options.command ?? this.#options.tool;
    const run = this.#options.run ?? runProcess;
    const execute = (artifacts?: Readonly<Record<string, string>>) =>
      run(
        command,
        [
          ...(this.#options.args ?? []),
          ...ARGV[this.#options.tool](request.model, artifacts),
        ],
        cliPrompt(request),
        {
          timeoutMs: this.#options.timeoutMs ?? 120_000,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          ...cliEnvironment(this.#options.tool),
        },
      );
    const result = await withCliArtifacts(
      this.#options.tool,
      request.responseSchema,
      execute,
    );
    const cleanupError =
      this.#options.tool === "opencode"
        ? await cleanupOpenCodeSession(command, result, run, this.#options)
        : this.#options.tool === "gemini"
          ? await cleanupGeminiSession(command, result, run, this.#options)
          : undefined;
    if (result.spawnError?.code === "ENOENT") {
      throw new CliTransportError(
        `${command} is not installed or not on PATH; install it and sign in, or configure a direct API provider`,
      );
    }
    if (request.signal?.aborted === true) {
      throw request.signal.reason instanceof Error
        ? request.signal.reason
        : new CliTransportError(`${command} was cancelled`);
    }
    if (result.timedOut === true) {
      throw new CliTransportError(
        `${command} timed out after ${String(this.#options.timeoutMs ?? 120_000)}ms`,
        true,
      );
    }
    if (result.code !== 0) {
      throw new CliTransportError(classify(command, result));
    }
    if (cleanupError !== undefined) throw cleanupError;
    return {
      value: extractJson(command, result.stdout),
      usage: SUBSCRIPTION_USAGE,
    };
  }

  isRetryable(error: unknown): boolean {
    return error instanceof CliTransportError && error.retryable;
  }

  describe(model: string): ModelCapabilities {
    return {
      model,
      contextWindowTokens: CLI_CONTEXT_WINDOW_TOKENS,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      structuredOutput: false,
      costBasis: "subscription",
    };
  }
}

export class CliTransportError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

/** Agent CLIs do not publish per-model windows; assume a large modern context. */
export const CLI_CONTEXT_WINDOW_TOKENS = FALLBACK_CONTEXT_WINDOW_TOKENS * 16;

/** Subscription runs draw on an allowance; no monetary cost is observable. */
const SUBSCRIPTION_USAGE: ProviderUsage = {
  inputTokens: 0,
  outputTokens: 0,
  tokenCountsAvailable: false,
  costBasis: "subscription",
};

const cliEnvironment = (tool: CliTool): { readonly env?: NodeJS.ProcessEnv } =>
  tool === "opencode"
    ? {
        env: {
          ...process.env,
          OPENCODE_PERMISSION: JSON.stringify({ "*": "deny" }),
          OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
        },
      }
    : {};

const GEMINI_POLICY = `[[rule]]
toolName = "*"
decision = "deny"
priority = 999

[[rule]]
mcpName = "*"
decision = "deny"
priority = 999
`;

const withCliArtifacts = async <T>(
  tool: CliTool,
  schema: Readonly<Record<string, unknown>>,
  use: (artifacts?: Readonly<Record<string, string>>) => Promise<T>,
): Promise<T> => {
  if (tool === "claude") return use({ schemaJson: JSON.stringify(schema) });
  if (tool !== "codex" && tool !== "gemini") return use();
  const directory = await mkdtemp(join(tmpdir(), "docgen-cli-"));
  try {
    if (tool === "codex") {
      const path = join(directory, "response.schema.json");
      await writeFile(path, JSON.stringify(schema), "utf8");
      return await use({ schema: path });
    }
    const path = join(directory, "deny-all-tools.toml");
    await writeFile(path, GEMINI_POLICY, "utf8");
    return await use({ policy: path });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const cleanupGeminiSession = async (
  command: string,
  result: CliRunResult,
  run: CliRunner,
  options: CliTransportOptions,
): Promise<CliTransportError | undefined> => {
  const sessionId = geminiSessionId(result.stdout);
  if (sessionId === undefined) {
    return result.code === 0
      ? new CliTransportError(
          `${command} returned no session id, so docgen cannot remove the completion session; update Gemini CLI or use a direct API provider`,
        )
      : undefined;
  }
  const cleanup = await run(
    command,
    [...(options.args ?? []), "--delete-session", sessionId],
    "",
    { timeoutMs: options.timeoutMs ?? 120_000 },
  );
  return cleanup.code === 0
    ? undefined
    : new CliTransportError(
        `${command} could not remove completion session ${sessionId}: ${cleanup.stderr.slice(0, 300)}`,
      );
};

const geminiSessionId = (stdout: string): string | undefined => {
  const matches = stdout.matchAll(/"session_id"\s*:\s*"([\w-]+)"/gu);
  return [...matches][0]?.[1];
};

const cleanupOpenCodeSession = async (
  command: string,
  result: CliRunResult,
  run: CliRunner,
  options: CliTransportOptions,
): Promise<CliTransportError | undefined> => {
  const sessionId = openCodeSessionId(result.stdout);
  if (sessionId === undefined) {
    return result.code === 0
      ? new CliTransportError(
          `${command} returned no session id, so docgen cannot remove the completion session; update OpenCode or use a direct API provider`,
        )
      : undefined;
  }
  const cleanup = await run(
    command,
    [...(options.args ?? []), "session", "delete", sessionId],
    "",
    {
      timeoutMs: options.timeoutMs ?? 120_000,
      ...cliEnvironment("opencode"),
    },
  );
  return cleanup.code === 0
    ? undefined
    : new CliTransportError(
        `${command} could not remove completion session ${sessionId}: ${cleanup.stderr.slice(0, 300)}`,
      );
};

const openCodeSessionId = (stdout: string): string | undefined => {
  const matches = stdout.matchAll(/"sessionID"\s*:\s*"(ses_[\w-]+)"/gu);
  return [...matches][0]?.[1];
};

const cliPrompt = (request: ProviderRequest): string =>
  `${request.system}\n\n${request.prompt}\n\nRespond with a single JSON object and nothing else. It must validate against this JSON Schema:\n${JSON.stringify(request.responseSchema)}`;

const classify = (command: string, result: CliRunResult): string => {
  const detail = `${result.stderr}\n${result.stdout}`.trim();
  const short = detail.slice(0, 500);
  if (/login|log in|not authenticated|unauthori[sz]ed|sign in/i.test(detail)) {
    return `${command} requires an interactive login; run it once yourself to sign in, then retry`;
  }
  if (/rate limit|usage limit|quota|exhaust|too many requests/i.test(detail)) {
    return `${command} reports its subscription allowance is exhausted; wait for the limit to reset or use a direct API provider`;
  }
  if (
    /unknown model|model .*(not found|not supported|unavailable)/i.test(detail)
  ) {
    return `${command} does not support the configured model: ${short}`;
  }
  return `${command} exited with code ${String(result.code)}: ${short}`;
};

const extractJson = (command: string, stdout: string): unknown => {
  for (const candidate of jsonCandidates(stdout)) {
    const text = unwrap(candidate);
    if (text !== undefined) return text;
  }
  throw new CliTransportError(
    `${command} returned output that is not a JSON object: ${stdout.slice(0, 300)}`,
  );
};

/** Whole stdout first, then each line, so both JSON and JSONL modes work. */
const jsonCandidates = (stdout: string): readonly string[] => [
  stdout.trim(),
  ...stdout.split("\n").reverse(),
];

const TEXT_FIELDS = ["result", "response", "text", "content", "message"];

const unwrap = (candidate: string): unknown => {
  const trimmed = candidate.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  return findSemanticResult(parsed, 0);
};

const findSemanticResult = (value: unknown, depth: number): unknown => {
  if (depth > 6 || typeof value !== "object" || value === null) {
    return typeof value === "string" && value.includes("{")
      ? parseEmbeddedObject(value)
      : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSemanticResult(item, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record["id"] === "string" &&
    typeof record["verdict"] === "string"
  ) {
    return record;
  }
  for (const field of TEXT_FIELDS) {
    const found = findSemanticResult(record[field], depth + 1);
    if (found !== undefined) return found;
  }
  for (const nested of Object.values(record)) {
    const found = findSemanticResult(nested, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
};

const parseEmbeddedObject = (value: string): unknown => {
  const inner = value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1);
  try {
    return JSON.parse(inner);
  } catch {
    return undefined;
  }
};

const runProcess: CliRunner = async (command, args, input, options) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let forceKill: NodeJS.Timeout | undefined;
    const finish = (result: CliRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill !== undefined) clearTimeout(forceKill);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      forceKill = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ code: null, stdout, stderr, timedOut: true });
      }, 1_000);
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ code: null, stdout, stderr, spawnError: error });
    });
    child.on("close", (code) => {
      finish({ code, stdout, stderr, ...(timedOut ? { timedOut: true } : {}) });
    });
    child.stdin.on("error", (error: Error) => {
      stderr += `${stderr === "" ? "" : "\n"}${error.message}`;
    });
    child.stdin.end(input);
  });
