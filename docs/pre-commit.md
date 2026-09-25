# Pre-commit hook

`check` is read-only, LLM-free, and safe to run before every commit. Add this
script to `.git/hooks/pre-commit`:

```sh
#!/bin/sh
pnpm exec docgen check --since HEAD
```

Then make it executable:

```bash
chmod +x .git/hooks/pre-commit
```

For a hook manager, use the same command. A Lefthook configuration is:

```yaml
pre-commit:
  commands:
    docgen:
      run: pnpm exec docgen check --since HEAD
```

The hook reports drift only for files changed from `HEAD`. It does not generate
documentation, call an LLM, or modify the working tree. Keep the CI check as the
enforcement point because local hooks can be skipped.

The hook reads working-tree contents, including unstaged edits; it does not
check an isolated staged snapshot. Partially staged source or documentation can
therefore produce a different result from the eventual commit. Review staging
and rely on CI to check the committed state.
