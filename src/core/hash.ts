import { createHash } from "node:crypto";

import type { ExistingDoc, Symbol as DocumentationSymbol } from "./symbol.js";

/**
 * Describes the settings and version identifiers that determine how a content
 * hash is computed, so changes to any of them alter the resulting hash.
 */
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

/**
 * Canonicalize source text for stable hashing while preserving token boundaries and literal contents.
 * @param text Source text to normalize by removing comments and insignificant whitespace.
 * @returns The normalized source text.
 */
export const normalizeCode = (text: string): string => {
  let result = "";
  let index = 0;
  let pendingSpace = false;

  const append = (value: string): void => {
    if (
      pendingSpace &&
      result.length > 0 &&
      needsSeparator(result.at(-1), value)
    ) {
      result += " ";
    }
    result += value;
    pendingSpace = false;
  };

  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];
    if (character === undefined) break;

    if (/\s/u.test(character)) {
      pendingSpace = true;
      index++;
      continue;
    }

    if (character === "/" && next === "/") {
      index += 2;
      while (
        index < text.length &&
        text[index] !== "\n" &&
        text[index] !== "\r"
      ) {
        index++;
      }
      pendingSpace = true;
      continue;
    }

    if (character === "/" && next === "*") {
      index += 2;
      while (
        index < text.length &&
        !(text[index] === "*" && text[index + 1] === "/")
      ) {
        index++;
      }
      index = Math.min(index + 2, text.length);
      pendingSpace = true;
      continue;
    }

    if (character === "`") {
      const literal = readTemplate(text, index);
      append(literal.value);
      index = literal.end;
      continue;
    }

    if (character === '"' || character === "'") {
      const literal = readQuoted(text, index, character);
      append(literal.value);
      index = literal.end;
      continue;
    }

    append(character);
    index++;
  }

  return result.trim();
};

/**
 * Normalize an existing document into a trimmed, whitespace-collapsed string containing its description and raw tags.
 * @param doc The existing document to normalize, or null when no document exists.
 */
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

/**
 * Compute stable content and documentation hashes from normalized symbol data and the selected hashing recipe.
 * @param symbol Symbol whose signature, body, source notes, and existing documentation contribute to the hashes.
 * @param recipe Hashing options and version fingerprints that control source-note inclusion and invalidate hashes when hashing inputs change.
 */
export const hashSymbol = (
  symbol: DocumentationSymbol,
  recipe: HashRecipe,
): SymbolHashes => {
  const sourceNotes =
    recipe.includeSourceNotes && symbol.sourceNote !== null
      ? symbol.sourceNote.text.replace(/\s+/gu, " ").trim()
      : "";
  const symbolContent = [
    normalizeCode(symbol.signature),
    normalizeCode(symbol.body),
    sourceNotes,
    recipe.contextRecipeVersion,
    recipe.promptVersion,
    recipe.configFingerprint,
  ].join("\0");

  return {
    symbolHash: hashText(symbolContent),
    docHash: hashText(normalizeDoc(symbol.existingDoc)),
  };
};

const needsSeparator = (previous: string | undefined, next: string): boolean =>
  previous !== undefined &&
  ((/[$\p{ID_Continue}]/u.test(previous) && /[$\p{ID_Continue}]/u.test(next)) ||
    MERGING_OPERATORS.has(`${previous}${next}`));

const MERGING_OPERATORS = new Set([
  "++",
  "--",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "**",
  "<<",
  ">>",
  "?.",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "//",
  "/*",
  "*/",
]);

const readQuoted = (
  text: string,
  start: number,
  quote: string,
): { readonly value: string; readonly end: number } => {
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === undefined) break;
    if (character === "\\") {
      index += 2;
      continue;
    }
    index++;
    if (character === quote) break;
  }
  return { value: text.slice(start, index), end: index };
};

const readTemplate = (
  text: string,
  start: number,
): { readonly value: string; readonly end: number } => {
  let value = "`";
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === undefined) break;
    if (character === "\\") {
      value += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character === "`") {
      return { value: `${value}\``, end: index + 1 };
    }
    if (character === "$" && text[index + 1] === "{") {
      const end = findTemplateExpressionEnd(text, index + 2);
      value += `\${${normalizeCode(text.slice(index + 2, end))}}`;
      index = Math.min(end + 1, text.length);
      continue;
    }
    value += character;
    index++;
  }
  return { value, end: index };
};

const findTemplateExpressionEnd = (text: string, start: number): number => {
  let depth = 1;
  let index = start;
  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' || character === "'") {
      index = readQuoted(text, index, character).end;
      continue;
    }
    if (character === "`") {
      index = readTemplate(text, index).end;
      continue;
    }
    if (character === "/" && next === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n") index++;
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (
        index < text.length &&
        !(text[index] === "*" && text[index + 1] === "/")
      ) {
        index++;
      }
      index += 2;
      continue;
    }
    if (character === "{") depth++;
    if (character === "}" && --depth === 0) return index;
    index++;
  }
  return text.length;
};
