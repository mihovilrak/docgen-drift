import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  type ModelCapabilities,
} from "../capabilities.js";
import {
  promptWithPrefix,
  type LlmProvider,
  type ProviderRequest,
  type ProviderResponse,
} from "../client.js";
import type { ProviderUsage } from "../usage.js";
import type { ProviderErrorInfo } from "../call.js";

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
    readonly cwd?: string;
    readonly signal?: AbortSignal;
    readonly env?: NodeJS.ProcessEnv;
  },
) => Promise<CliRunResult>;

/**
 * Non-interactive argv per tool. Read-only, tool-less and session-less by
 * construction: docgen owns batching and edits, the CLI only completes text.
 * Authentication is whatever the user already established for the executable;
 * docgen never touches credential files.
 *
 * Every flag that replaces or suppresses the agent harness preamble is a direct
 * token saving repeated on every symbol, so prefer them over prompt text.
 */
const ARGV: Record<
  CliTool,
  (
    model: string,
    system: string,
    artifacts?: Readonly<Record<string, string>>,
  ) => readonly string[]
> = {
  claude: (model, system, artifacts) => [
    "-p",
    "--model",
    model,
    "--output-format",
    "json",
    ...(artifacts?.["schemaJson"] === undefined
      ? []
      : ["--json-schema", artifacts["schemaJson"]]),
    // Replaces the agent system prompt instead of appending to it: docgen needs
    // a JSON completion, not a coding agent.
    "--system-prompt",
    system,
    "--exclude-dynamic-system-prompt-sections",
    "--strict-mcp-config",
    "--tools",
    "",
    "--permission-mode",
    "plan",
    "--max-turns",
    "3",
    "--no-session-persistence",
  ],
  codex: (model, _system, artifacts) => [
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
  gemini: (model, _system, artifacts) => [
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

/**
 * Route completion requests through a configured command-line tool and expose subscription-backed model capabilities.
 */
export class CliTransportProvider implements LlmProvider {
  readonly id: string;
  readonly #options: CliTransportOptions;

  constructor(options: CliTransportOptions) {
    this.id = `cli:${options.tool}`;
    this.#options = options;
  }

  /**
   * Execute the configured CLI provider and parse its structured response.
   * @param request Provide the model, system instructions, prompt, response schema, and optional cancellation signal for the CLI request.
   * @returns A provider response containing the parsed value and subscription usage.
   */
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const command = this.#options.command ?? this.#options.tool;
    const run = this.#options.run ?? runProcess;
    const execute = (workspace: CliWorkspace) =>
      run(
        command,
        [
          ...(this.#options.args ?? []),
          ...ARGV[this.#options.tool](
            request.model,
            request.system,
            workspace.artifacts,
          ),
        ],
        cliPrompt(request, this.#options.tool),
        {
          timeoutMs: this.#options.timeoutMs ?? 120_000,
          cwd: workspace.cwd,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          ...cliEnvironment(this.#options.tool),
        },
      );
    const { result, cleanupError } = await withCliWorkspace(
      this.#options.tool,
      request.responseSchema,
      async (workspace) => {
        const result = await execute(workspace);
        const cleanupError =
          this.#options.tool === "opencode"
            ? await cleanupOpenCodeSession(
                command,
                result,
                run,
                this.#options,
                workspace.cwd,
              )
            : this.#options.tool === "gemini"
              ? await cleanupGeminiSession(
                  command,
                  result,
                  run,
                  this.#options,
                  workspace.cwd,
                )
              : undefined;
        return { result, cleanupError };
      },
    );
    if (result.spawnError?.code === "ENOENT") {
      throw new CliTransportError(
        `${command} is not installed or not on PATH; install it and sign in, or configure a direct API provider`,
        false,
        undefined,
        true,
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
      const failure = classify(command, result, this.#options.tool);
      throw new CliTransportError(
        failure.message,
        false,
        failure.diagnostic,
        failure.fatal === true,
      );
    }
    if (cleanupError !== undefined) throw cleanupError;
    return {
      value: extractJson(command, result.stdout),
      usage: SUBSCRIPTION_USAGE,
    };
  }

  /**
   * Treat only retryable CLI transport failures as eligible for another attempt.
   * @param error The error to evaluate for retry eligibility.
   */
  isRetryable(error: unknown): boolean {
    return error instanceof CliTransportError && error.retryable;
  }

  errorInfo(error: unknown): ProviderErrorInfo {
    return error instanceof CliTransportError ? { fatal: error.fatal } : {};
  }

  /**
   * Describe the CLI model's capability limits and subscription-based cost model.
   * @param model The model identifier to include in the capability description.
   */
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

/**
 * Represent a CLI transport failure and expose whether retrying may succeed.
 */
export class CliTransportError extends Error {
  readonly fatal: boolean;
  readonly retryable: boolean;
  readonly diagnostic?: string;

  constructor(
    message: string,
    retryable = false,
    diagnostic?: string,
    fatal = false,
  ) {
    super(message);
    this.retryable = retryable;
    this.fatal = fatal;
    if (diagnostic !== undefined) this.diagnostic = diagnostic;
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

interface CliWorkspace {
  readonly cwd: string;
  readonly artifacts?: Readonly<Record<string, string>>;
}

/**
 * Runs the CLI in an empty directory. Agent CLIs discover AGENTS.md, CLAUDE.md
 * and other project context from their working directory and resend it with
 * every request; the completion is fully specified by stdin and does not need
 * any of it. Artifacts live beside the working directory, not in it.
 */
const withCliWorkspace = async <T>(
  tool: CliTool,
  schema: Readonly<Record<string, unknown>>,
  use: (workspace: CliWorkspace) => Promise<T>,
): Promise<T> => {
  const directory = await mkdtemp(join(tmpdir(), "docgen-cli-"));
  const cwd = join(directory, "cwd");
  try {
    await mkdir(cwd);
    const artifacts = await cliArtifacts(tool, schema, directory);
    return await use({
      cwd,
      ...(artifacts === undefined ? {} : { artifacts }),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const cliArtifacts = async (
  tool: CliTool,
  schema: Readonly<Record<string, unknown>>,
  directory: string,
): Promise<Readonly<Record<string, string>> | undefined> => {
  if (tool === "claude") return { schemaJson: JSON.stringify(schema) };
  if (tool === "codex") {
    const path = join(directory, "response.schema.json");
    await writeFile(path, JSON.stringify(schema), "utf8");
    return { schema: path };
  }
  if (tool === "gemini") {
    const path = join(directory, "deny-all-tools.toml");
    await writeFile(path, GEMINI_POLICY, "utf8");
    return { policy: path };
  }
  return undefined;
};

const cleanupGeminiSession = async (
  command: string,
  result: CliRunResult,
  run: CliRunner,
  options: CliTransportOptions,
  cwd: string,
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
    { timeoutMs: options.timeoutMs ?? 120_000, cwd },
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
  cwd: string,
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
      cwd,
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

/** Tools that take the system prompt as argv instead of prompt text. */
const SYSTEM_PROMPT_ARGV: ReadonlySet<CliTool> = new Set(["claude"]);

/** Tools that constrain output with a schema flag, so inlining it is waste. */
const SCHEMA_ARGV: ReadonlySet<CliTool> = new Set(["claude", "codex"]);

const cliPrompt = (request: ProviderRequest, tool: CliTool): string =>
  [
    ...(SYSTEM_PROMPT_ARGV.has(tool) ? [] : [request.system]),
    promptWithPrefix(request),
    SCHEMA_ARGV.has(tool)
      ? "Respond with a single JSON object and nothing else."
      : `Respond with a single JSON object and nothing else. It must validate against this JSON Schema:\n${JSON.stringify(request.responseSchema)}`,
  ].join("\n\n");

interface CliFailure {
  readonly fatal?: boolean;
  readonly message: string;
  readonly diagnostic: string;
}

const classify = (
  command: string,
  result: CliRunResult,
  tool: CliTool,
): CliFailure => {
  const detail = `${result.stderr}\n${result.stdout}`.trim();
  const short = oneLine(detail).slice(0, 240);
  if (
    tool === "claude" &&
    /"stop_reason"\s*:\s*"tool_use"|max(?:imum)? turns?/iu.test(detail)
  ) {
    return {
      message: `${command} reached its structured-output turn limit before returning validated JSON`,
      diagnostic: detail,
    };
  }
  if (/error_max_structured_output_retries/iu.test(detail)) {
    return {
      message: `${command} could not produce JSON matching the response schema`,
      diagnostic: detail,
    };
  }
  if (/login|log in|not authenticated|unauthori[sz]ed|sign in/i.test(detail)) {
    return {
      message: `${command} requires an interactive login; run it once yourself to sign in, then retry`,
      fatal: true,
      diagnostic: detail,
    };
  }
  if (/rate limit|usage limit|quota|exhaust|too many requests/i.test(detail)) {
    return {
      message: `${command} reports its subscription allowance is exhausted; wait for the limit to reset or use a direct API provider`,
      fatal: true,
      diagnostic: detail,
    };
  }
  if (
    /unknown model|model .*(not found|not supported|unavailable)/i.test(detail)
  ) {
    return {
      message: `${command} does not support the configured model: ${short}`,
      fatal: true,
      diagnostic: detail,
    };
  }
  return {
    message: `${command} exited with code ${String(result.code)}${short === "" ? "" : `: ${short}`}`,
    diagnostic: detail,
  };
};

const oneLine = (value: string): string => value.replace(/\s+/gu, " ").trim();

const extractJson = (command: string, stdout: string): unknown => {
  for (const candidate of jsonCandidates(stdout)) {
    const text = unwrap(candidate);
    if (text !== undefined) return text;
  }
  throw new CliTransportError(
    `${command} returned output that did not contain semantic JSON`,
    false,
    stdout,
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

export const runProcess: CliRunner = async (command, args, input, options) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
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
      options.signal?.removeEventListener("abort", terminate);
      resolve(result);
    };
    const terminate = (): void => {
      if (settled || forceKill !== undefined) return;
      child.kill();
      forceKill = setTimeout(() => {
        child.kill("SIGKILL");
        finish({
          code: null,
          stdout,
          stderr,
          ...(timedOut ? { timedOut: true } : {}),
        });
      }, 1_000);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    options.signal?.addEventListener("abort", terminate, { once: true });
    if (options.signal?.aborted === true) terminate();
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
