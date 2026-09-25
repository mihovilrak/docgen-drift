import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ProviderCaller, type ProviderFailureState } from "../src/llm/call.js";
import {
  CliTransportProvider,
  runProcess,
} from "../src/llm/providers/cliTransport.js";
import { postJson, isRetryableHttpError } from "../src/llm/providers/http.js";

const request = {
  model: "stub",
  system: "s",
  prompt: "p",
  responseSchema: { type: "object" },
};
const options = { retryCount: 0, baseDelayMs: 0, sleep: async () => {} };

describe("transport hardening", () => {
  it("shares a fatal login failure across clients and projects", async () => {
    let calls = 0;
    const provider = new CliTransportProvider({
      tool: "claude",
      run: () => {
        calls++;
        return Promise.resolve({
          code: 1,
          stdout: "",
          stderr: "not authenticated; login required",
        });
      },
    });
    const failureState: ProviderFailureState = {};
    await expect(
      new ProviderCaller(provider, { ...options, failureState }).complete(
        request,
      ),
    ).rejects.toThrow("interactive login");
    await expect(
      new ProviderCaller(provider, { ...options, failureState }).complete(
        request,
      ),
    ).rejects.toThrow("Not sent");
    expect(calls).toBe(1);
    await expect(
      new ProviderCaller(provider, options).complete(request),
    ).rejects.toThrow("interactive login");
    expect(calls).toBe(2);
  });

  it("deletes Gemini history in its original workspace before removing the directory", async () => {
    let cwd: string | undefined;
    const provider = new CliTransportProvider({
      tool: "gemini",
      run: async (_command, args, _input, runOptions) => {
        if (args.includes("--delete-session")) {
          expect(runOptions.cwd).toBe(cwd);
          if (cwd === undefined) throw new Error("Missing cwd");
          await expect(access(cwd)).resolves.toBeUndefined();
          return { code: 0, stdout: "", stderr: "" };
        }
        cwd = runOptions.cwd;
        return {
          code: 0,
          stdout: JSON.stringify({
            session_id: "test-session",
            result: {
              id: "symbol",
              verdict: "SKIP",
              reason: "No new information",
            },
          }),
          stderr: "",
        };
      },
    });
    await provider.complete(request);
    if (cwd === undefined) throw new Error("Missing cwd");
    await expect(access(cwd)).rejects.toThrow();
  });

  it("classifies connection loss while reading the body as retryable", async () => {
    const error = await postJson({
      url: "https://test.invalid",
      headers: {},
      body: {},
      timeoutMs: 1000,
      label: "stub",
      fetchImpl: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("body disconnected"));
              },
            }),
          ),
        ),
    }).catch((failure: unknown) => failure);
    expect(isRetryableHttpError(error)).toBe(true);
  });

  it("keeps forced termination active after cancellation", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const cancellation = setTimeout(() => {
      controller.abort();
    }, 500);
    try {
      const result = await runProcess(
        process.execPath,
        ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 100);"],
        "",
        { timeoutMs: 5000, signal: controller.signal },
      );
      expect(result.code).not.toBe(0);
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      clearTimeout(cancellation);
    }
  });
});
