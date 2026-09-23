import { createTokenCounter, type TokenCount } from "./budget.js";
import type { Symbol as DocumentationSymbol } from "./symbol.js";

export interface FileContext {
  readonly filePath: string;
  readonly text: string;
  readonly tokenCount: number;
  /**
   * Type-ish names whose fields are fully rendered in `text`. A per-symbol
   * `referencedType` block for one of these repeats the shared block, so
   * `assembleContext` suppresses it — that substitution is what keeps the
   * shared prefix from being pure added cost.
   */
  readonly declaredNames: ReadonlySet<string>;
}

export interface AssembleFileContextOptions {
  readonly filePath: string;
  readonly symbols: readonly DocumentationSymbol[];
  readonly budgetTokens: number;
  readonly model: string;
  readonly countTokens?: TokenCount;
  readonly entryMaxTokens?: number;
}

const DEFAULT_ENTRY_MAX_TOKENS = 240;

/** Kinds whose `body` is the member list, short enough to inline. */
const MEMBER_KINDS: ReadonlySet<string> = new Set(["interface", "enum"]);

/** Kinds a rendered entry describes completely enough to replace a `referencedType` block. */
const SUBSTITUTABLE_KINDS: ReadonlySet<string> = new Set([
  "interface",
  "type-alias",
  "enum",
]);

/**
 * Build the module outline shared by every symbol documented from one file.
 *
 * The text is identical for all symbols in the file, which is what makes it a
 * cacheable prompt prefix; entries are emitted in declaration order and the
 * documented symbol is never excluded, since omitting it would give each symbol
 * a different prefix.
 * @param options Provide the file path, the full symbol list to filter, the token budget, the model tokenizer, and the optional per-entry token cap.
 */
export const assembleFileContext = (
  options: AssembleFileContextOptions,
): FileContext => {
  const counter = createTokenCounter(options.model, options.countTokens);
  const header = `MODULE: ${options.filePath}\nMODULE DECLARATIONS (siblings of the documented symbol; context only, never a documentation target):`;
  const entryMaxTokens = options.entryMaxTokens ?? DEFAULT_ENTRY_MAX_TOKENS;
  const ordered = options.symbols
    .filter((symbol) => symbol.filePath === options.filePath)
    .toSorted(
      (left, right) => left.declaration.start - right.declaration.start,
    );

  const declaredNames = new Set<string>();
  /** Containers whose members are already listed inside their own entry. */
  const inlined = new Set<string>();
  const entries: string[] = [];
  let remaining = options.budgetTokens - counter.count(header);

  for (const symbol of ordered) {
    if (
      symbol.containerName !== undefined &&
      inlined.has(symbol.containerName)
    ) {
      continue;
    }
    const full = entryText(symbol);
    const text =
      counter.count(full) > entryMaxTokens
        ? counter.truncate(full, entryMaxTokens)
        : full;
    if (text === "") continue;
    const cost = counter.count(`\n${text}`);
    if (cost > remaining) break;
    remaining -= cost;
    entries.push(text);
    if (text !== full) continue;
    if (MEMBER_KINDS.has(symbol.kind)) inlined.add(symbol.name);
    if (SUBSTITUTABLE_KINDS.has(symbol.kind)) declaredNames.add(symbol.name);
  }

  if (entries.length === 0) {
    return {
      filePath: options.filePath,
      text: "",
      tokenCount: 0,
      declaredNames,
    };
  }
  const text = [header, ...entries].join("\n");
  return {
    filePath: options.filePath,
    text,
    tokenCount: counter.count(text),
    declaredNames,
  };
};

const entryText = (symbol: DocumentationSymbol): string => {
  const signature =
    symbol.containerName === undefined
      ? symbol.signature
      : `${symbol.containerName}.${symbol.signature}`;
  return MEMBER_KINDS.has(symbol.kind) && symbol.body.trim() !== ""
    ? `- ${signature} {\n${indent(symbol.body)}\n  }`
    : `- ${signature}`;
};

const indent = (text: string): string =>
  text
    .split(/\r?\n/u)
    .map((line) => `    ${line}`)
    .join("\n");
