import { Node, Scope } from "ts-morph";

import type { SymbolVisibility } from "../../../core/symbol.js";

/**
 * Check whether a declaration is an exported top-level function, class, interface, type alias, or enum.
 * @param declaration Declaration node to classify.
 */
export const isTopLevelExported = (declaration: Node): boolean =>
  (Node.isFunctionDeclaration(declaration) ||
    Node.isClassDeclaration(declaration) ||
    Node.isInterfaceDeclaration(declaration) ||
    Node.isTypeAliasDeclaration(declaration) ||
    Node.isEnumDeclaration(declaration)) &&
  declaration.isExported();

/**
 * Classify a declaration as public, protected, private, or package visibility.
 * @param declaration The declaration whose visibility to determine.
 */
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

/**
 * Treat top-level declarations as exported when applicable, and require public visibility for members of exported classes or interfaces.
 * @param declaration AST declaration to evaluate for exportability.
 * @param visibility Visibility classification used when evaluating class or interface members.
 */
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

/**
 * Resolve the name of the declaration’s enclosing class or interface, using "default" for an unnamed class.
 * @param declaration Declaration node whose parent is inspected.
 */
export const getContainerName = (declaration: Node): string | undefined => {
  const parent = declaration.getParent();
  if (Node.isClassDeclaration(parent)) return parent.getName() ?? "default";
  if (Node.isInterfaceDeclaration(parent)) return parent.getName();
  return undefined;
};
