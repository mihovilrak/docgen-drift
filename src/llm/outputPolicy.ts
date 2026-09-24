import { type DocgenConfig, replacesSourceNote } from "../config/schema.js";
import type {
  GeneratedDoc,
  Symbol as DocumentationSymbol,
} from "../core/symbol.js";

/**
 * Describe which documentation sections and how much detail the generator
 * should produce for a symbol, including an optional note carried over from
 * replaced source documentation.
 */
export interface GenerationOutputPolicy {
  readonly granularity: "minimal" | "standard" | "detailed";
  readonly detail: boolean;
  readonly params: boolean;
  readonly returns: boolean;
  readonly throws: boolean;
  /** Source note text that the accepted doc will delete, so its rationale must survive. */
  readonly replacedNote: string | null;
}

export const DEFAULT_OUTPUT_POLICY: GenerationOutputPolicy = {
  granularity: "detailed",
  detail: true,
  params: true,
  returns: true,
  throws: true,
  replacedNote: null,
};

/**
 * Select documentation sections from the configured granularity and tags, suppressing return output when the symbol has no renderable value.
 * @param config Configuration controlling documentation granularity and tag output.
 * @param symbol Optional symbol metadata used to determine whether return output is renderable.
 */
export const generationOutputPolicy = (
  config: DocgenConfig,
  symbol?: DocumentationSymbol,
): GenerationOutputPolicy => {
  const standard = config.docs.granularity !== "minimal";
  const detailed = config.docs.granularity === "detailed";
  const replacedNote =
    symbol !== undefined && replacesSourceNote(config, symbol)
      ? (symbol.sourceNote?.text ?? null)
      : null;
  return {
    granularity: config.docs.granularity,
    detail: detailed || replacedNote !== null,
    params: standard && config.docs.tags.params,
    returns:
      standard &&
      config.docs.tags.returns &&
      (symbol === undefined || symbol.returnsValue === true),
    throws: detailed && config.docs.tags.throws,
    replacedNote,
  };
};

/**
 * Strip a generated doc's params, throws, detail, and returns fields down to only those enabled by the output policy.
 * @param doc The generated documentation whose optional fields are filtered.
 * @param output The policy flags controlling which of params, throws, detail, and returns are kept.
 * @returns A new GeneratedDoc containing only the fields permitted by the output policy; disabled fields are omitted or emptied.
 */
export const projectGeneratedDoc = (
  doc: GeneratedDoc,
  output: GenerationOutputPolicy,
): GeneratedDoc => ({
  summary: doc.summary,
  params: output.params ? doc.params : {},
  throws: output.throws ? doc.throws : [],
  ...(output.detail && doc.detail !== undefined ? { detail: doc.detail } : {}),
  ...(output.returns && doc.returns !== undefined
    ? { returns: doc.returns }
    : {}),
});
