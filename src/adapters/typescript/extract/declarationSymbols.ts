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
