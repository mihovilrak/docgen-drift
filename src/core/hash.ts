import { createHash } from "node:crypto";

import type { ExistingDoc, Symbol as DocumentationSymbol } from "./symbol.js";

export interface HashRecipe {
  readonly includeSourceNotes: boolean;
  readonly contextRecipeVersion: string;
  readonly promptVersion: string;
  readonly configFingerprint: string;
}

export interface SymbolHashes {
  readonly symbolHash: string;
  readonly docHash: string;
}

export const normalizeDoc = (doc: ExistingDoc | null): string =>
  doc === null
    ? ""
    : [doc.description, ...doc.tags.map((tag) => tag.raw)]
        .join("\n")
        .replace(/\s+/gu, " ")
        .trim();

export const hashText = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
export const EMPTY_DOC_HASH = hashText("");

/** Custom symbol producers without canonical data retain exact source, conservatively. */
export const symbolCode = (symbol: DocumentationSymbol): string =>
  symbol.canonicalCode ??
  JSON.stringify([symbol.signature, symbol.body, symbol.asynchronous]);

export const hashSymbol = (
  symbol: DocumentationSymbol,
  recipe: HashRecipe,
): SymbolHashes => ({
  symbolHash: hashText(
    [
      symbolCode(symbol),
      recipe.includeSourceNotes
        ? (symbol.sourceNote?.text.replace(/\s+/gu, " ").trim() ?? "")
        : "",
      recipe.contextRecipeVersion,
      recipe.promptVersion,
      recipe.configFingerprint,
    ].join("\0"),
  ),
  docHash: hashText(normalizeDoc(symbol.existingDoc)),
});
