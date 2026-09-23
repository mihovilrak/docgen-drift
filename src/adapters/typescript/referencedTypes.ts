import { resolve } from "node:path";

import {
  Node,
  SyntaxKind,
  type InterfaceDeclaration,
  type Node as TypeScriptNode,
  type SourceFile,
  type Symbol as TypeScriptSymbol,
  type TypeAliasDeclaration,
} from "ts-morph";

import type {
  ReferencedType,
  Symbol as DocumentationSymbol,
  SymbolId,
} from "../../core/symbol.js";
import type { TypeScriptProjectHandle } from "./loadProject.js";

/**
 * Collect referenced types from each selected symbol’s signature declarations.
 * @param handle Use the TypeScript project handle to locate source files and declarations.
 * @param symbols Provide the documentation symbols whose signature type nodes should be inspected.
 * @param selectedIds Optionally restrict extraction to symbols whose IDs are in this set.
 * @returns Map each processed symbol ID to its distinct referenced types, omitting symbols without resolvable declarations or type references.
 */
export const extractReferencedTypes = (
  handle: TypeScriptProjectHandle,
  symbols: readonly DocumentationSymbol[],
  selectedIds?: ReadonlySet<SymbolId>,
): ReadonlyMap<SymbolId, readonly ReferencedType[]> => {
  const sourceFiles = new Map(
    handle.sourceFiles.map((sourceFile) => [
      resolve(sourceFile.getFilePath()),
      sourceFile,
    ]),
  );
  const result = new Map<SymbolId, readonly ReferencedType[]>();

  for (const symbol of symbols) {
    if (selectedIds !== undefined && !selectedIds.has(symbol.id)) continue;
    const sourceFile = sourceFiles.get(resolve(handle.root, symbol.filePath));
    if (sourceFile === undefined) continue;
    const declaration = findDeclaration(sourceFile, symbol);
    if (declaration === undefined) continue;

    const references = new Map<string, ReferencedType>();
    for (const typeNode of signatureTypeNodes(declaration)) {
      collectTypeReferences(typeNode, declaration, references);
    }
    if (references.size > 0) result.set(symbol.id, [...references.values()]);
  }
  return result;
};

const findDeclaration = (
  sourceFile: SourceFile,
  symbol: DocumentationSymbol,
): TypeScriptNode | undefined => {
  const leaf = sourceFile.getDescendantAtPos(symbol.declaration.start);
  const candidates = leaf === undefined ? [] : [leaf, ...leaf.getAncestors()];
  return candidates.find(
    (candidate) =>
      candidate.getStart() === symbol.declaration.start &&
      candidate.getEnd() === symbol.declaration.end,
  );
};

const signatureTypeNodes = (
  declaration: TypeScriptNode,
): readonly TypeScriptNode[] => {
  if (Node.isFunctionLikeDeclaration(declaration)) {
    return [
      ...declaration
        .getParameters()
        .flatMap((parameter) => optional(parameter.getTypeNode())),
      ...optional(declaration.getReturnTypeNode()),
      ...declaration
        .getTypeParameters()
        .flatMap((parameter) => [
          ...optional(parameter.getConstraint()),
          ...optional(parameter.getDefault()),
        ]),
    ];
  }
  if (Node.isVariableStatement(declaration)) {
    return declaration.getDeclarations().flatMap((item) => {
      const initializer = item.getInitializer();
      return [
        ...optional(item.getTypeNode()),
        ...(initializer !== undefined &&
        Node.isFunctionLikeDeclaration(initializer)
          ? signatureTypeNodes(initializer)
          : []),
      ];
    });
  }
  if (Node.isClassDeclaration(declaration)) {
    return [
      ...optional(declaration.getExtends()),
      ...declaration.getImplements(),
    ];
  }
  if (Node.isInterfaceDeclaration(declaration)) {
    return [
      ...declaration.getExtends(),
      ...declaration
        .getProperties()
        .flatMap((property) => optional(property.getTypeNode())),
    ];
  }
  if (Node.isTypeAliasDeclaration(declaration)) {
    return [declaration.getTypeNodeOrThrow()];
  }
  return [];
};

const collectTypeReferences = (
  typeNode: TypeScriptNode,
  owner: TypeScriptNode,
  references: Map<string, ReferencedType>,
): void => {
  const nodes = [
    ...(Node.isTypeReference(typeNode) ? [typeNode] : []),
    ...typeNode.getDescendantsOfKind(SyntaxKind.TypeReference),
  ];
  for (const reference of nodes) {
    const symbol = unalias(reference.getTypeName().getSymbol());
    for (const declaration of symbol?.getDeclarations() ?? []) {
      if (declaration === owner || declaration.wasForgotten()) continue;
      const rendered = renderFields(declaration);
      if (rendered !== undefined) references.set(rendered.name, rendered);
    }
  }
  const heritageNodes = [
    ...(Node.isExpressionWithTypeArguments(typeNode) ? [typeNode] : []),
    ...typeNode.getDescendantsOfKind(SyntaxKind.ExpressionWithTypeArguments),
  ];
  for (const reference of heritageNodes) {
    const symbol = unalias(reference.getExpression().getSymbol());
    for (const declaration of symbol?.getDeclarations() ?? []) {
      if (declaration === owner || declaration.wasForgotten()) continue;
      const rendered = renderFields(declaration);
      if (rendered !== undefined) references.set(rendered.name, rendered);
    }
  }
};

const renderFields = (
  declaration: TypeScriptNode,
): ReferencedType | undefined => {
  if (Node.isInterfaceDeclaration(declaration)) {
    return renderProperties(declaration.getName(), "interface", declaration);
  }
  if (Node.isClassDeclaration(declaration)) {
    const name = declaration.getName();
    if (name === undefined) return undefined;
    const fields = declaration
      .getProperties()
      .map((property) => property.getText());
    return fields.length === 0
      ? undefined
      : { name, declaration: `class ${name} {\n${indent(fields)}\n}` };
  }
  if (Node.isTypeAliasDeclaration(declaration)) {
    return renderTypeAlias(declaration);
  }
  if (Node.isEnumDeclaration(declaration)) {
    const name = declaration.getName();
    const fields = declaration.getMembers().map((member) => member.getText());
    return {
      name,
      declaration: `enum ${name} {\n${indent(fields)}\n}`,
    };
  }
  return undefined;
};

const renderProperties = (
  name: string,
  kind: "interface",
  declaration: InterfaceDeclaration,
): ReferencedType | undefined => {
  const fields = declaration
    .getProperties()
    .map((property) => property.getText());
  return fields.length === 0
    ? undefined
    : { name, declaration: `${kind} ${name} {\n${indent(fields)}\n}` };
};

const renderTypeAlias = (
  declaration: TypeAliasDeclaration,
): ReferencedType | undefined => {
  const typeNode = declaration.getTypeNodeOrThrow();
  if (!Node.isTypeLiteral(typeNode)) return undefined;
  const fields = typeNode.getProperties().map((property) => property.getText());
  return fields.length === 0
    ? undefined
    : {
        name: declaration.getName(),
        declaration: `type ${declaration.getName()} = {\n${indent(fields)}\n}`,
      };
};

const unalias = (
  symbol: TypeScriptSymbol | undefined,
): TypeScriptSymbol | undefined =>
  symbol !== undefined && symbol.isAlias()
    ? (symbol.getAliasedSymbol() ?? symbol)
    : symbol;

const indent = (lines: readonly string[]): string =>
  lines.map((line) => `  ${line}`).join("\n");

const optional = <T>(value: T | undefined): readonly T[] =>
  value === undefined ? [] : [value];
