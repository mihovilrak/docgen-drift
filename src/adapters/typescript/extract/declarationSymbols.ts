import type {
  ClassDeclaration,
  EnumDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
} from "ts-morph";

import type { Symbol as DocumentationSymbol } from "../../../core/symbol.js";
import type { TypeScriptProjectHandle } from "../loadProject.js";
import { parseExistingDoc } from "./jsdoc.js";
import { renderTypeParameters } from "./signature.js";
import { extractSourceNote } from "./sourceNotes.js";
import { makeSymbol } from "./symbolFactory.js";

/**
 * Build a documentation symbol for a class declaration, including its type parameters, inheritance, implemented interfaces, members, visibility, and existing documentation.
 * @param handle Use the TypeScript project handle to create the symbol with normalized source metadata.
 * @param declaration Provide the class declaration to extract.
 */
export const classSymbol = (
  handle: TypeScriptProjectHandle,
  declaration: ClassDeclaration,
): DocumentationSymbol => {
  const name = declaration.getName() ?? "default";
  const typeParameters = renderTypeParameters(declaration.getTypeParameters());
  const extended = declaration.getExtends()?.getText();
  const implemented = declaration.getImplements().map((item) => item.getText());
  const signature = [
    `class ${name}${typeParameters}`,
    extended === undefined ? "" : `extends ${extended}`,
    implemented.length === 0 ? "" : `implements ${implemented.join(", ")}`,
  ]
    .filter(Boolean)
    .join(" ");

  return makeSymbol(handle, declaration, {
    name,
    kind: "class",
    signature,
    body: declaration
      .getMembers()
      .map((member) => member.getText())
      .join("\n"),
    parameters: [],
    asynchronous: false,
    exported: declaration.isExported(),
    visibility: declaration.isExported() ? "public" : "package",
    existingDoc: parseExistingDoc(declaration),
    sourceNote: extractSourceNote(declaration.getSourceFile(), declaration),
  });
};

/**
 * Build a documentation symbol for an interface declaration, including its rendered type parameters and inheritance.
 * @param handle Use the TypeScript project context when assembling the symbol.
 * @param declaration Read the interface name, type parameters, extended interfaces, members, visibility, and source documentation from this declaration.
 */
export const interfaceSymbol = (
  handle: TypeScriptProjectHandle,
  declaration: InterfaceDeclaration,
): DocumentationSymbol => {
  const name = declaration.getName();
  const typeParameters = renderTypeParameters(declaration.getTypeParameters());
  const extended = declaration.getExtends().map((item) => item.getText());
  const signature = `interface ${name}${typeParameters}${extended.length === 0 ? "" : ` extends ${extended.join(", ")}`}`;

  return makeSymbol(handle, declaration, {
    name,
    kind: "interface",
    signature,
    body: declaration
      .getMembers()
      .map((member) => member.getText())
      .join("\n"),
    parameters: [],
    asynchronous: false,
    exported: declaration.isExported(),
    visibility: declaration.isExported() ? "public" : "package",
    existingDoc: parseExistingDoc(declaration),
    sourceNote: extractSourceNote(declaration.getSourceFile(), declaration),
  });
};

/**
 * Build the documentation symbol for a TypeScript type-alias declaration.
 * @param handle Provide the TypeScript project context used to assemble the symbol and resolve its source metadata.
 * @param declaration Provide the type-alias declaration whose name, type parameters, body, visibility, documentation, and source note are extracted.
 */
export const typeAliasSymbol = (
  handle: TypeScriptProjectHandle,
  declaration: TypeAliasDeclaration,
): DocumentationSymbol => {
  const name = declaration.getName();
  const typeText = declaration.getTypeNodeOrThrow().getText();
  return makeSymbol(handle, declaration, {
    name,
    kind: "type-alias",
    signature: `type ${name}${renderTypeParameters(declaration.getTypeParameters())} = ${typeText}`,
    body: typeText,
    parameters: [],
    asynchronous: false,
    exported: declaration.isExported(),
    visibility: declaration.isExported() ? "public" : "package",
    existingDoc: parseExistingDoc(declaration),
    sourceNote: extractSourceNote(declaration.getSourceFile(), declaration),
  });
};

/**
 * Build a documentation symbol for an enum, including its members, visibility, existing JSDoc, and anchored source note.
 * @param handle Project context used to assemble the documentation symbol and normalize its source metadata.
 * @param declaration Enum declaration whose name, members, export status, documentation, and source location are extracted.
 */
export const enumSymbol = (
  handle: TypeScriptProjectHandle,
  declaration: EnumDeclaration,
): DocumentationSymbol => {
  const name = declaration.getName();
  return makeSymbol(handle, declaration, {
    name,
    kind: "enum",
    signature: `enum ${name}`,
    body: declaration
      .getMembers()
      .map((member) => member.getText())
      .join(",\n"),
    parameters: [],
    asynchronous: false,
    exported: declaration.isExported(),
    visibility: declaration.isExported() ? "public" : "package",
    existingDoc: parseExistingDoc(declaration),
    sourceNote: extractSourceNote(declaration.getSourceFile(), declaration),
  });
};
