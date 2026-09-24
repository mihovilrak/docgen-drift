import type {
  ExistingDocTag,
  GeneratedDoc,
  Symbol as DocumentationSymbol,
} from "../../core/symbol.js";
import { type DocgenConfig, replacesSourceNote } from "../../config/schema.js";
import { type WrapWidth, wrapWords } from "../../core/wrap.js";

export interface RenderDocOptions {
  readonly indentation?: string;
  readonly eol?: "\n" | "\r\n";
  readonly emitDetail?: boolean;
  readonly emitParams?: boolean;
  readonly emitReturns?: boolean;
  readonly emitThrows?: boolean;
  readonly preserveTags?: readonly string[];
  readonly lineWidth?: number;
  readonly maxLineWidth?: number;
}

/**
 * Assemble a JSDoc comment from generated content and symbol metadata, honoring formatting, emission, and tag-preservation options.
 * @param doc Generated documentation containing the summary, optional detail and return text, parameter descriptions, and thrown-error descriptions.
 * @param symbol Documentation symbol whose parameters, return status, and preserved tags determine which JSDoc tags are rendered.
 * @param options Optional formatting, tag-emission, and preserved-tag settings.
 */
export const renderDoc = (
  doc: GeneratedDoc,
  symbol: DocumentationSymbol,
  options: RenderDocOptions = {},
): string => {
  const indentation = options.indentation ?? "";
  const eol = options.eol ?? "\n";
  const limits = wrapLimits(options, indentation);
  const tagLines = (head: string, text: string | undefined) =>
    wrapWords(safeText(text ?? ""), `${head} `, TAG_CONTINUATION, limits);
  const lines = ["/**", ...docLines(doc.summary, limits)];

  if (options.emitDetail !== false && doc.detail !== undefined) {
    lines.push(" *", ...docLines(doc.detail, limits));
  }
  if (options.emitParams !== false) {
    for (const parameter of symbol.parameters) {
      lines.push(
        ...tagLines(` * @param ${parameter.name}`, doc.params[parameter.name]),
      );
    }
  }
  if (
    options.emitReturns !== false &&
    symbol.returnsValue === true &&
    doc.returns !== undefined
  ) {
    lines.push(...tagLines(" * @returns", doc.returns));
  }
  if (options.emitThrows !== false) {
    for (const item of doc.throws) {
      lines.push(...tagLines(` * @throws ${item.type}`, item.when));
    }
  }
  for (const tag of preservedTags(symbol, options.preserveTags ?? [])) {
    lines.push(...renderPreservedTag(tag));
  }
  lines.push(" */");
  return lines.join(`${eol}${indentation}`);
};

/**
 * Render generated documentation as a configured JSDoc comment, applying granularity, tag, preservation, and source-formatting settings.
 * @param doc Generated documentation content to render.
 * @param symbol Documented symbol metadata used to contextualize the comment.
 * @param config Documentation configuration controlling granularity, emitted tags, and preserved tags.
 * @param formatting Optional indentation and line-ending settings for the rendered comment.
 * @returns The rendered JSDoc comment.
 */
export const renderConfiguredDoc = (
  doc: GeneratedDoc,
  symbol: DocumentationSymbol,
  config: DocgenConfig,
  formatting: Pick<RenderDocOptions, "indentation" | "eol"> = {},
): string => {
  const standard = config.docs.granularity !== "minimal";
  const detailed = config.docs.granularity === "detailed";
  return renderDoc(doc, symbol, {
    ...formatting,
    emitDetail: detailed || replacesSourceNote(config, symbol),
    emitParams: standard && config.docs.tags.params,
    emitReturns: standard && config.docs.tags.returns,
    emitThrows: detailed && config.docs.tags.throws,
    preserveTags: config.docs.preserveTags,
    lineWidth: config.docs.lineWidth,
    maxLineWidth: config.docs.maxLineWidth,
  });
};

const TAG_CONTINUATION = " *   ";
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/u;

const wrapLimits = (
  options: RenderDocOptions,
  indentation: string,
): WrapWidth => {
  const width = options.lineWidth ?? Number.POSITIVE_INFINITY;
  return {
    width: width - indentation.length,
    maxWidth:
      Math.max(width, options.maxLineWidth ?? width) - indentation.length,
  };
};

// Fenced and indented lines are code; reflowing them would change meaning.
const docLines = (text: string, limits: WrapWidth): readonly string[] => {
  let fenced = false;
  return safeText(text)
    .split(/\r?\n/u)
    .flatMap((line) => {
      const verbatim = [` *${line === "" ? "" : ` ${line}`}`];
      if (/^\s*```/u.test(line)) {
        fenced = !fenced;
        return verbatim;
      }
      if (fenced || line === "" || /^\s/u.test(line)) return verbatim;
      const marker = LIST_MARKER.exec(line)?.[0] ?? "";
      return wrapWords(
        line.slice(marker.length),
        ` * ${marker}`,
        ` * ${" ".repeat(marker.length)}`,
        limits,
      );
    });
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
