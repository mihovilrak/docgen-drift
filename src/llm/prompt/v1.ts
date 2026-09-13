import type {
  GeneratedDoc,
  Symbol as DocumentationSymbol,
} from "../../core/symbol.js";

export const GENERATION_PROMPT_VERSION = "1";
export const JUDGE_PROMPT_VERSION = "1";

export const generationSystemPrompt = `You write concise API documentation from supplied repository context.
Return only the requested JSON object. Return semantic plain text, never JSDoc markup or tags.
Use verdict SKIP when the context cannot support documentation that adds information beyond the signature.`;

export const generationPrompt = (
  symbol: DocumentationSymbol,
  context: string,
): string => `Document ${symbol.id}.

Rules:
- id must be exactly ${JSON.stringify(symbol.id)}.
- summary is one sentence, imperative, and must not merely restate the symbol name or signature.
- params must contain exactly these keys: ${JSON.stringify(symbol.parameters.map((parameter) => parameter.name))}.
- returns is null when omitted or when the return is self-describing.
- detail is null unless it adds a useful invariant, side effect, or constraint.
- throws contains only exceptions supported by the context.
- reason briefly explains a SKIP verdict and is null for OK.

Context:
${context}`;

export const judgeSystemPrompt = `You gate generated API documentation for information value and factual support.
Return only the requested JSON object. Reject fluent documentation that merely restates names, parameter types, or the signature.`;

export const judgePrompt = (
  symbol: DocumentationSymbol,
  doc: GeneratedDoc,
  context: string,
  strict: boolean,
): string => `Judge generated documentation for ${symbol.id}.

Rules:
- id must be exactly ${JSON.stringify(symbol.id)}.
- verdict is ACCEPT only when the documentation states useful behavior, intent, side effects, constraints, edge cases, or failure conditions not already evident from the signature.
- every accepted claim must be supported by the supplied context.
- reject paraphrases of the symbol name, parameter names, types, and return type.
- strict mode is ${strict ? "enabled" : "disabled"}.${strict ? " Require a clear, concrete addition because this leaf summary may propagate to callers." : ""}
- reason must concisely identify the useful added information or the rejection cause.

Signature:
${symbol.signature}

Generated semantic documentation:
${JSON.stringify(doc, null, 2)}

Context:
${context}`;
