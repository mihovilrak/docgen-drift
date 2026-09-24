export interface WrapWidth {
  readonly width: number;
  readonly maxWidth: number;
}

/**
 * Greedily fill lines to `width`, letting a paragraph's remainder run to
 * `maxWidth` instead of breaking off a short final line. Widths count the
 * prefixes; a single word longer than the width is never split.
 */
export const wrapWords = (
  text: string,
  firstPrefix: string,
  nextPrefix: string,
  limits: WrapWidth,
): readonly string[] => {
  const words = text.split(/\s+/u).filter((word) => word !== "");
  const lines: string[] = [];
  let prefix = firstPrefix;
  let index = 0;
  while (index < words.length) {
    const rest = words.slice(index).join(" ");
    if (prefix.length + rest.length <= limits.maxWidth) {
      lines.push(prefix + rest);
      return lines;
    }
    let line = prefix + (words[index] ?? "");
    index += 1;
    while (
      index < words.length &&
      line.length + 1 + (words[index] ?? "").length <= limits.width
    ) {
      line += ` ${words[index] ?? ""}`;
      index += 1;
    }
    lines.push(line);
    prefix = nextPrefix;
  }
  return lines.length === 0 ? [firstPrefix.trimEnd()] : lines;
};
