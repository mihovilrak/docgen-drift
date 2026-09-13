# Extraction benchmarks

Phase 1 baseline, recorded 2026-09-13. Times cover project loading and symbol extraction. Peak RSS is the process high-water mark reported by Node.

| Repository | Shape | Projects | Source files | Source lines | Symbols | Wall time | Peak RSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pnpm `cb96f9d` | single `tsconfig.lint.json` program | 1 | 1,609 | 319,725 | 5,678 | 12.95 s | 700.0 MiB |
| pnpm `cb96f9d` | sequential `core`, `catalogs`, and `text` package programs | 14 | 63 | 2,534 | 228 | 7.46 s | 443.5 MiB |

Environment: Linux 7.0.12 container layer, 2 vCPUs on an AMD Ryzen 7 3700U, Node 22.22.1. The repository was a clean depth-one checkout. Its checked-in `@pnpm/tsconfig` workspace package was linked as it would be after a normal install; packages were not built.

Commands:

```bash
node --import tsx scripts/benchmark-extraction.ts \
  single /tmp/docgen-bench-pnpm/tsconfig.lint.json

node --import tsx scripts/benchmark-extraction.ts \
  workspace /tmp/docgen-bench-pnpm \
  'pnpm11/{core,catalogs,text}/*/tsconfig.json' \
  1
```

The workspace run uses `projectConcurrency: 1`, so only one compiler program is actively visited at a time. Duplicate ownership is validated from the project file lists before indexing begins.
