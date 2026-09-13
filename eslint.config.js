import eslint from "@eslint/js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const typeScriptFiles = [
  "src/**/*.ts",
  "test/**/*.test.ts",
  "scripts/**/*.ts",
  "*.config.ts",
];

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "test/fixtures/**"],
  },
  { ...eslint.configs.recommended, files: ["**/*.js"] },
  ...tseslint.configs.strictTypeChecked.map((configuration) => ({
    ...configuration,
    files: typeScriptFiles,
  })),
  {
    files: typeScriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: rootDirectory,
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "ts-morph",
              message:
                "ts-morph may only be imported from src/adapters/typescript/.",
            },
          ],
          patterns: ["ts-morph/*"],
        },
      ],
    },
  },
  {
    files: ["src/adapters/typescript/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
