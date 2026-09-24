import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { renderConfiguredDoc } from "../adapters/typescript/renderDoc.js";
import type { DocgenConfig } from "../config/schema.js";
import type {
  GeneratedDoc,
  Symbol as DocumentationSymbol,
} from "../core/symbol.js";
import type { GenerationResult } from "../llm/client.js";
import type { JudgeResult } from "../llm/judge.js";
import {
  projectGeneratedDoc,
  type GenerationOutputPolicy,
} from "../llm/outputPolicy.js";
import type { ProviderUsage } from "../llm/usage.js";
import type { GenerationRunMetrics } from "./generationMetrics.js";

export interface GenerationEvaluationRecord {
  readonly symbol: {
    readonly id: string;
    readonly filePath: string;
    readonly startLine: number;
    readonly kind: DocumentationSymbol["kind"];
    readonly signature: string;
  };
  readonly generation: {
    readonly provider: string;
    readonly model: string;
    readonly outcome: "OK" | "SKIP" | "FAILED";
    readonly attempts: number;
    readonly semanticDoc?: GeneratedDoc;
    readonly reason?: string;
    readonly error?: string;
    readonly diagnostic?: string;
  };
  readonly judge?: {
    readonly provider: string;
    readonly model: string;
    readonly outcome: "ACCEPT" | "REJECT" | "FAILED";
    readonly attempts: number;
    readonly reason: string;
    readonly error?: string;
    readonly diagnostic?: string;
  };
  readonly output?: {
    readonly semanticDoc: GeneratedDoc;
    readonly renderedComment: string;
    readonly editStatus:
      "written" | "proposed" | "not-selected" | "edit-failed";
  };
}

export interface GenerationEvaluationArtifact {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly mode: "missing" | "drifted";
  readonly path?: string;
  readonly dryRun: boolean;
  readonly promptVersion: string;
  readonly outputPolicy: GenerationOutputPolicy;
  readonly providers: {
    readonly generation: { readonly id: string; readonly model: string };
    readonly judge?: { readonly id: string; readonly model: string };
  };
  readonly metrics: GenerationRunMetrics;
  readonly usage: ProviderUsage;
  readonly records: readonly GenerationEvaluationRecord[];
}

interface EvaluationRecordOptions {
  readonly symbol: DocumentationSymbol;
  readonly generation: GenerationResult;
  readonly judgment?: JudgeResult;
  readonly generationProvider: string;
  readonly generationModel: string;
  readonly judgeProvider: string;
  readonly judgeModel: string;
  readonly outputPolicy: GenerationOutputPolicy;
  readonly config: DocgenConfig;
  readonly planned: boolean;
  readonly applied: boolean;
  readonly write: boolean;
}

/**
 * Build a per-symbol evaluation record combining symbol metadata, generation
 * outcome, optional judge result, and, when generation succeeded, the projected
 * doc with its rendered comment and edit status.
 * @param options Symbol, generation result, optional judgment, provider and
 *   model identifiers, output policy, config, and planned/applied/write flags
 *   used to assemble the record.
 * @returns A record whose judge section is present only when a judgment exists
 *   and whose output section is present only when generation returned an OK verdict.
 */
export const evaluationRecord = (
  options: EvaluationRecordOptions,
): GenerationEvaluationRecord => {
  const outcome = options.generation.outcome;
  const output =
    outcome?.verdict === "OK"
      ? projectGeneratedDoc(outcome.doc, options.outputPolicy)
      : undefined;
  return {
    symbol: {
      id: options.symbol.id,
      filePath: options.symbol.filePath,
      startLine: options.symbol.declaration.startLine,
      kind: options.symbol.kind,
      signature: options.symbol.signature,
    },
    generation: generationEvaluation(options),
    ...(options.judgment === undefined
      ? {}
      : { judge: judgeEvaluation(options) }),
    ...(output === undefined
      ? {}
      : {
          output: {
            semanticDoc: output,
            renderedComment: renderConfiguredDoc(
              output,
              options.symbol,
              options.config,
            ),
            editStatus: editStatus(options),
          },
        }),
  };
};

const editStatus = (
  options: EvaluationRecordOptions,
): NonNullable<GenerationEvaluationRecord["output"]>["editStatus"] => {
  if (options.applied) return options.write ? "written" : "proposed";
  return options.planned ? "edit-failed" : "not-selected";
};

/**
 * Persist the evaluation artifact as formatted JSON, creating missing parent directories and replacing the target atomically.
 * @param path Specify the destination path for the evaluation artifact.
 * @param artifact Provide the structured evaluation data to serialize as JSON.
 */
export const writeEvaluationArtifact = async (
  path: string,
  artifact: GenerationEvaluationArtifact,
): Promise<void> => {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

const generationEvaluation = (
  options: EvaluationRecordOptions,
): GenerationEvaluationRecord["generation"] => {
  const outcome = options.generation.outcome;
  return {
    provider: options.generationProvider,
    model: options.generationModel,
    outcome: outcome?.verdict ?? "FAILED",
    attempts: options.generation.attempts,
    ...(outcome?.verdict === "OK" ? { semanticDoc: outcome.doc } : {}),
    ...(outcome?.verdict === "SKIP" ? { reason: outcome.reason } : {}),
    ...(options.generation.error === undefined
      ? {}
      : { error: options.generation.error }),
    ...(options.generation.diagnostic === undefined
      ? {}
      : { diagnostic: options.generation.diagnostic }),
  };
};

const judgeEvaluation = (
  options: EvaluationRecordOptions,
): NonNullable<GenerationEvaluationRecord["judge"]> => {
  const judgment = options.judgment;
  if (judgment === undefined) throw new Error("Missing judgment");
  return {
    provider: options.judgeProvider,
    model: options.judgeModel,
    outcome:
      judgment.error !== undefined
        ? "FAILED"
        : judgment.accepted
          ? "ACCEPT"
          : "REJECT",
    attempts: judgment.attempts,
    reason: judgment.reason,
    ...(judgment.error === undefined ? {} : { error: judgment.error }),
    ...(judgment.diagnostic === undefined
      ? {}
      : { diagnostic: judgment.diagnostic }),
  };
};
