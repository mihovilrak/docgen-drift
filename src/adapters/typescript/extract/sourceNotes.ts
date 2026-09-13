import { Node, type SourceFile } from "ts-morph";

import type {
  SourceNote,
  SourceNoteBlockReason,
} from "../../../core/symbol.js";
import { findLineIndex, getLineStarts, sourceRange } from "./range.js";
import { DIRECTIVE_PATTERN, LICENSE_PATTERN } from "./types.js";

export const extractSourceNote = (
  sourceFile: SourceFile,
  declaration: Node,
): SourceNote | null => {
  const sourceText = sourceFile.getFullText();
  const anchor = getCommentAnchor(declaration);
  const anchorPosition = anchor.getStart();
  const lineStarts = getLineStarts(sourceText);
  const anchorLine = findLineIndex(lineStarts, anchorPosition);
  const anchorLineStart = lineStarts[anchorLine] ?? 0;

  if (sourceText.slice(anchorLineStart, anchorPosition).trim() !== "")
    return null;

  let firstLine = anchorLine;
  for (let line = anchorLine - 1; line >= 0; line--) {
    const start = lineStarts[line];
    const end = lineStarts[line + 1] ?? sourceText.length;
    if (start === undefined) break;
    const lineText = sourceText.slice(start, end).replace(/\r?\n$/u, "");
    if (!lineText.trimStart().startsWith("//")) break;
    firstLine = line;
  }

  if (firstLine === anchorLine) return null;

  const start = lineStarts[firstLine];
  if (start === undefined) return null;
  const end = anchorLineStart;
  const raw = sourceText.slice(start, end);
  const lines = raw.split(/\r?\n/u).filter((line) => line.length > 0);
  const trimmedLines = lines.map((line) => line.trimStart());
  const text = trimmedLines
    .map((line) => line.replace(/^\/\/\/?\s?/u, ""))
    .join("\n")
    .trim();
  const blockedBy = sourceNoteBlockReason(trimmedLines);

  return {
    text,
    raw,
    range: sourceRange(sourceFile, start, end),
    replacementEligible: blockedBy === undefined,
    ...(blockedBy === undefined ? {} : { blockedBy }),
  };
};

const sourceNoteBlockReason = (
  lines: readonly string[],
): SourceNoteBlockReason | undefined => {
  if (lines.some((line) => line.startsWith("///"))) return "triple-slash";
  if (lines.some((line) => DIRECTIVE_PATTERN.test(line))) return "directive";
  if (lines.some((line) => LICENSE_PATTERN.test(line))) return "license";
  return undefined;
};

const getCommentAnchor = (declaration: Node): Node => {
  if (
    Node.isClassDeclaration(declaration) ||
    Node.isMethodDeclaration(declaration) ||
    Node.isGetAccessorDeclaration(declaration) ||
    Node.isSetAccessorDeclaration(declaration)
  ) {
    return declaration.getDecorators()[0] ?? declaration;
  }
  return declaration;
};
