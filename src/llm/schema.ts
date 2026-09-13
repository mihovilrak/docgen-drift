import { z } from "zod";

import type {
  GeneratedDoc,
  Symbol as DocumentationSymbol,
} from "../core/symbol.js";

export const generatedResponseSchema = z
  .object({
    id: z.string().min(1),
    summary: z.string().nullable(),
    detail: z.string().nullable(),
    params: z.record(z.string(), z.string()),
    returns: z.string().nullable(),
    throws: z.array(
      z.object({ type: z.string().min(1), when: z.string().min(1) }).strict(),
    ),
    verdict: z.enum(["OK", "SKIP"]),
    reason: z.string().nullable(),
  })
  .strict();

export type GeneratedResponse = z.infer<typeof generatedResponseSchema>;

export const generationResponseJsonSchema = z.toJSONSchema(
  generatedResponseSchema,
);

export type GenerationOutcome =
  | { readonly verdict: "OK"; readonly id: string; readonly doc: GeneratedDoc }
  | { readonly verdict: "SKIP"; readonly id: string; readonly reason: string };

export const parseGenerationResponse = (
  value: unknown,
  symbol: DocumentationSymbol,
): GenerationOutcome => {
  const response = generatedResponseSchema.parse(
    typeof value === "string" ? JSON.parse(value) : value,
  );
  if (response.id !== symbol.id) {
    throw new Error(`Response id ${response.id} does not match ${symbol.id}`);
  }
  if (response.verdict === "SKIP") {
    return {
      verdict: "SKIP",
      id: response.id,
      reason:
        response.reason?.trim() || "Model declined to generate documentation",
    };
  }

  const summary = response.summary?.trim();
  if (summary === undefined || summary === "") {
    throw new Error(`Response for ${symbol.id} has no summary`);
  }
  const expectedParams = symbol.parameters.map((parameter) => parameter.name);
  const actualParams = Object.keys(response.params);
  if (
    expectedParams.length !== actualParams.length ||
    expectedParams.some((name) => !actualParams.includes(name))
  ) {
    throw new Error(`Response for ${symbol.id} has invalid parameter names`);
  }
  for (const text of [
    summary,
    response.detail,
    response.returns,
    ...Object.values(response.params),
    ...response.throws.flatMap((item) => [item.type, item.when]),
  ]) {
    if (text !== null && containsMarkup(text)) {
      throw new Error(
        `Response for ${symbol.id} contains documentation markup`,
      );
    }
  }

  const detail = nonempty(response.detail);
  const returns = nonempty(response.returns);

  return {
    verdict: "OK",
    id: response.id,
    doc: {
      summary,
      ...(detail === undefined ? {} : { detail }),
      params: Object.fromEntries(
        expectedParams.map((name) => [
          name,
          response.params[name]?.trim() ?? "",
        ]),
      ),
      ...(returns === undefined ? {} : { returns }),
      throws: response.throws.map((item) => ({
        type: item.type.trim(),
        when: item.when.trim(),
      })),
    },
  };
};

const nonempty = (value: string | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const containsMarkup = (value: string): boolean =>
  /\/\*\*|\*\/|^\s*@[\p{L}_-]+/mu.test(value);
