# Phase 2 validation

Recorded 2026-09-13 against a fresh depth-one checkout of pnpm.

| Repository | Commit | TypeScript lines | Eligible symbols | Documented | Missing |
| --- | --- | ---: | ---: | ---: | ---: |
| pnpm | `cb96f9d4515157d60431000a26de5f43d918eee4` | 319,474 | 2,153 | 392 | 1,761 |

The checkout used the root `tsconfig.lint.json`, with its checked-in `@pnpm/tsconfig` package linked into `node_modules`. Source selection was `**/src/**/*.ts`; tests, declarations, generated output, and non-public symbols were outside the check policy.

Validation sequence:

1. Run `docgen baseline`; it records 2,153 symbols in one shared lockfile.
2. Run `docgen check --json`; it reports 0 drifted and 0 orphaned symbols.
3. In the documented standalone function `mergeCatalogs`, replace a local `as Record<string, Catalog>` assertion with its equivalent variable type annotation. No documentation is changed.
4. Run `docgen check`; it reports exactly `pnpm11/catalogs/config/src/mergeCatalogs.ts#mergeCatalogs` as drifted, with 0 orphaned and no other drift.

The checkout and generated lockfile remained under `/tmp` and are not repository fixtures.
