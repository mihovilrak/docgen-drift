import { Node, Scope } from "ts-morph";

import type { SymbolVisibility } from "../../../core/symbol.js";

export const isTopLevelExported = (declaration: Node): boolean =>
  (Node.isFunctionDeclaration(declaration) ||
    Node.isClassDeclaration(declaration) ||
    Node.isInterfaceDeclaration(declaration) ||
    Node.isTypeAliasDeclaration(declaration) ||
    Node.isEnumDeclaration(declaration)) &&
  declaration.isExported();

export const getVisibility = (declaration: Node): SymbolVisibility => {
  if (
    Node.isMethodDeclaration(declaration) ||
    Node.isGetAccessorDeclaration(declaration) ||
    Node.isSetAccessorDeclaration(declaration)
  ) {
    if (Node.isPrivateIdentifier(declaration.getNameNode())) return "private";
    const scope = declaration.getScope();
    if (scope === Scope.Private) return "private";
    if (scope === Scope.Protected) return "protected";
    return "public";
  }
  if (Node.isMethodSignature(declaration)) return "public";
  return isTopLevelExported(declaration) ? "public" : "package";
};

export const isDeclarationExported = (
  declaration: Node,
  visibility: SymbolVisibility,
): boolean => {
  if (
    Node.isMethodDeclaration(declaration) ||
    Node.isMethodSignature(declaration) ||
    Node.isGetAccessorDeclaration(declaration) ||
    Node.isSetAccessorDeclaration(declaration)
  ) {
    const parent = declaration.getParent();
    return (
      visibility === "public" &&
      (Node.isClassDeclaration(parent) ||
        Node.isInterfaceDeclaration(parent)) &&
      parent.isExported()
    );
  }
  return isTopLevelExported(declaration);
};

export const getContainerName = (declaration: Node): string | undefined => {
  const parent = declaration.getParent();
  if (Node.isClassDeclaration(parent)) return parent.getName() ?? "default";
  if (Node.isInterfaceDeclaration(parent)) return parent.getName();
  return undefined;
};
