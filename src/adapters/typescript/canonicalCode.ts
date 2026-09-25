import { ts, type Node } from "ts-morph";

const cache = new WeakMap<ts.Node, string>();

/** Serialize syntax, not trivia: statement boundaries and literal contents remain significant. */
export const canonicalNode = (node: Node): string =>
  serialize(node.compilerNode, node.getSourceFile().compilerNode);

export const canonicalCode = (
  source: string,
  filePath = "source.ts",
): string => {
  const file = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  return serialize(file, file);
};

const serialize = (node: ts.Node, file: ts.SourceFile): string => {
  const previous = cache.get(node);
  if (previous !== undefined) return previous;
  if (ts.isJSDoc(node)) return "";
  if (ts.isParenthesizedExpression(node))
    return serialize(node.expression, file);
  const children: string[] = [];
  ts.forEachChild(node, (child) => {
    children.push(serialize(child, file));
  });
  const value =
    ts.isIdentifier(node) ||
    ts.isPrivateIdentifier(node) ||
    ts.isLiteralExpression(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
      ? JSON.stringify(node.text)
      : ts.isJsxText(node)
        ? JSON.stringify(file.text.slice(node.pos, node.end))
        : "";
  const flags = ts.isVariableDeclarationList(node)
    ? String(node.flags & ts.NodeFlags.BlockScoped)
    : "";
  const operator =
    ts.isPrefixUnaryExpression(node) ||
    ts.isPostfixUnaryExpression(node) ||
    ts.isTypeOperatorNode(node)
      ? String(node.operator)
      : "";
  const template =
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
      ? JSON.stringify(node.getText(file))
      : value;
  const result = `${String(node.kind)}[${flags}|${operator}|${template}|${children.join(",")}]`;
  cache.set(node, result);
  return result;
};
