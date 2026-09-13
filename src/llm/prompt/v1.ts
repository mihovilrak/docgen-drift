import type { Symbol as DocumentationSymbol } from "../../core/symbol.js";

export const GENERATION_PROMPT_VERSION = "1";

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
