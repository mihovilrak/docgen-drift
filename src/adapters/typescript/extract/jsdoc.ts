import { Node, type JSDocableNode } from "ts-morph";

import type { ExistingDoc, ExistingDocTag } from "../../../core/symbol.js";
import { sourceRange } from "./range.js";
import { KNOWN_JSDOC_TAGS } from "./types.js";

/**
 * Extract the latest JSDoc description, tags, raw text, and source range from the node.
 * @param node JSDocable node whose latest JSDoc comment should be parsed.
 * @returns The parsed existing documentation, or null when the node has no JSDoc comment.
 */
export const parseExistingDoc = (node: JSDocableNode): ExistingDoc | null => {
  const doc = node.getJsDocs().at(-1);
  if (doc === undefined) return null;

  const tags: ExistingDocTag[] = doc.getTags().map((tag) => {
    const name = tag.getTagName();
    const parameterName = Node.isJSDocParameterTag(tag)
      ? tag.getName()
      : undefined;
    return {
      name,
      text: tag.getCommentText() ?? "",
      ...(parameterName === undefined ? {} : { parameterName }),
      raw: tag.getText(),
      known: KNOWN_JSDOC_TAGS.has(name),
    };
  });

  return {
    description: doc.getDescription().trim(),
    tags,
    raw: doc.getText(),
    range: sourceRange(doc.getSourceFile(), doc.getStart(), doc.getEnd()),
  };
};

export const findDocOwner = (
  nodes: readonly JSDocableNode[],
): JSDocableNode | undefined =>
  nodes.find((node) => node.getJsDocs().length > 0);
