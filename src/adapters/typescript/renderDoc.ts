import type {
  ExistingDocTag,
  GeneratedDoc,
  Symbol as DocumentationSymbol,
} from "../../core/symbol.js";

export interface RenderDocOptions {
  readonly indentation?: string;
  readonly eol?: "\n" | "\r\n";
  readonly emitDetail?: boolean;
  readonly emitParams?: boolean;
  readonly emitReturns?: boolean;
  readonly emitThrows?: boolean;
  readonly preserveTags?: readonly string[];
}

export const renderDoc = (
  doc: GeneratedDoc,
  symbol: DocumentationSymbol,
  options: RenderDocOptions = {},
): string => {
  const indentation = options.indentation ?? "";
  const eol = options.eol ?? "\n";
  const lines = ["/**", ...docLines(doc.summary)];

  if (options.emitDetail !== false && doc.detail !== undefined) {
    lines.push(" *", ...docLines(doc.detail));
  }
  if (options.emitParams !== false) {
    for (const parameter of symbol.parameters) {
      lines.push(
        ` * @param ${parameter.name}${tagDescription(doc.params[parameter.name])}`,
      );
    }
  }
  if (
    options.emitReturns !== false &&
    symbol.returnsValue === true &&
    doc.returns !== undefined
  ) {
    lines.push(` * @returns${tagDescription(doc.returns)}`);
  }
  if (options.emitThrows !== false) {
    for (const item of doc.throws) {
      lines.push(` * @throws ${item.type}${tagDescription(item.when)}`);
    }
  }
  for (const tag of preservedTags(symbol, options.preserveTags ?? [])) {
    lines.push(...renderPreservedTag(tag));
  }
  lines.push(" */");
  return lines.join(`${eol}${indentation}`);
};

const docLines = (text: string): readonly string[] =>
  safeText(text)
    .split(/\r?\n/u)
    .map((line) => ` *${line === "" ? "" : ` ${line}`}`);

const tagDescription = (text: string | undefined): string => {
  const value = safeText(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return value === "" ? "" : ` ${value}`;
};

const safeText = (text: string): string => text.replaceAll("*/", "*\\/");

const preservedTags = (
  symbol: DocumentationSymbol,
  configured: readonly string[],
): readonly ExistingDocTag[] =>
  symbol.existingDoc?.tags.filter(
    (tag) => !tag.known || configured.includes(tag.name),
  ) ?? [];

const renderPreservedTag = (tag: ExistingDocTag): readonly string[] =>
  tag.raw.split(/\r?\n/u).map((line) => {
    const content = line
      .replace(/^\s*\/\*\*?\s?/u, "")
      .replace(/^\s*\*\/?\s?/u, "")
      .trimEnd();
    return ` *${content === "" ? "" : ` ${content}`}`;
  });
