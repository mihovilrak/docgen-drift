Short answer: the project can generate documentation now, but it is
  currently Anthropic-API-specific and only superficially language-agnostic.
  I would add provider portability before Phase 7, then make PHP the second
  language.

  ## 1. Can it generate documentation for this repository now?

  Yes.

  Generation, judging, validation, dry runs, and safe insertion are
  implemented in PLAN.md:86. This repository already has a .docgenrc.json.

  I ran it against the repository:

  - 374 symbols extracted in total.
  - 157 symbols are eligible under the current policy.
  - All 157 eligible symbols are currently missing documentation.
  - No .docgen/lock.json has been committed yet.
  - The working tree remained clean.

  Start with one real public module:

  node ./dist/cli.js fix --missing --path src/core/graph.ts --dry-run

  Then review the diff and repeat without --dry-run. Note that dry-run still
  calls the model and consumes usage.

  One important limitation: exportedOnly currently means “has a TypeScript
  export,” not “reachable through the package’s public entry point.”
  Consequently, the 157 candidates include internal cross-module exports, not
  just the public API from src/index.ts. I would dogfood file-by-file, or add
  entry-point-aware public-surface filtering before generating across all
  src/.

  Verification:

  - Build: passed.
  - Typecheck: passed.
  - Lint/format: passed.
  - Generation tests: 11/11 passed when run separately.
  - The full test suite had one 30-second timeout while all verification
    commands were running concurrently; 83/84 tests passed in that run. I
    would rerun the full suite alone before formally entering Phase 7.

  There is also a bookkeeping inconsistency: package.json:3 says 1.0.0, while
  PLAN.md:133 still has “Release v1.0.0” unchecked.

  ## 2. Is it already agent/provider agnostic?

  Not currently, although the beginning of the abstraction is present.

  The good part is the small LlmProvider interface in src/llm/client.ts:26.
  Any backend capable of returning the requested JSON could implement it.

  The runtime is nevertheless Anthropic-only:

  - Configuration accepts only "anthropic" in src/config/schema.ts:116.
  - The provider factory only constructs AnthropicProvider in src/llm/
    providers/index.ts:5.

  - Generation and judging share the same provider.
  - The CLI has no external provider/plugin registration mechanism.

  I would call the desired design “provider- and transport-agnostic,” not
  agent-agnostic. OpenCode and Pi are agent harnesses; Anthropic, OpenAI,
  Gemini, Ollama, and similar systems are inference providers or transports.

  A sensible Phase 6.5 would add:

  1. Direct Anthropic and OpenAI providers.
  2. An OpenAI-compatible provider with configurable base URL, covering
     Ollama, LM Studio, llama.cpp, vLLM, and gateways.

  3. Separate generation and judge provider configuration.
  4. Optional claude-cli, codex-cli, opencode-cli, and pi-cli transports.
  5. Provider-owned token accounting, pricing, retry classification, and
     capability checks.

  6. Tests running the same generation contract against every provider stub.

  This does not need to violate ADR-011 (DECISIONS.md:146): docgen should
  continue owning selection, batching, judging, and edits. A CLI backend
  should only act as a structured completion transport.

  ## 3. Can subscription CLIs be used instead of API keys?

  As checked on 14 September 2026: yes in some documented scenarios, but the
  answer differs by vendor.

  ### Anthropic

  Anthropic explicitly documents:

  - claude -p and the Agent SDK for programmatic operation.
  - JSON Schema output.
  - Third-party applications authenticating through a Claude subscription.
  - Current subscription usage being charged against subscription limits.

  Their current help article specifically says claude -p, Agent SDK, and
  third-party app usage still draw from subscription usage limits. For shared
  production automation, Anthropic recommends the API for predictable
  billing. Anthropic subscription/Agent SDK guidance, programmatic Claude
  Code documentation.

  Therefore, a local claude-cli adapter using the official CLI or Agent SDK
  is a supported approach.

  ### OpenAI

  OpenAI explicitly documents codex exec for scripts, pipelines, CI, piping
  output, and JSON Schema structured output. It reuses saved CLI
  authentication by default. Codex non-interactive documentation.

  OpenAI also says:

  - ChatGPT sign-in provides subscription access for local Codex work.
  - API-key authentication is the recommended default for programmatic
    workflows.

  - ChatGPT-managed account authentication can be used for trusted private
    automation, with dedicated enterprise access tokens available. Codex
    authentication documentation.

  There is a legal caveat: the applicable European consumer terms prohibit
  automatically or programmatically extracting Output. The product-specific
  Codex documentation simultaneously and explicitly supports piping and
  structured consumption of codex exec output. OpenAI Europe Terms.

  My practical conclusion is:

  - An opt-in local adapter invoking a user-installed, authenticated codex
    exec through its documented interface is reasonable.

  - Do not read or copy ~/.codex/auth.json.
  - Do not build an unofficial OAuth client or replay private endpoints.
  - Do not resell, pool, or expose one user’s subscription to other users.
  - Before advertising subscription-backed Codex as a formally supported
    commercial feature, obtain written clarification from OpenAI.

  ### OpenCode and Pi

  Both can technically work:

  - OpenCode has non-interactive execution, JSON output, many providers, and
    local-model support. OpenCode provider documentation.

  - Pi has print, JSON, SDK, and JSON-RPC modes intended for embedding. Pi
    RPC documentation.

  However, they do not override upstream terms. Using OpenCode or Pi with API
  keys or local models is straightforward. Using them with unofficial access
  to a Claude or ChatGPT subscription depends on what the upstream vendor
  authorizes. For subscription access, prefer the vendor’s official CLI.

  Every CLI adapter should:

  - Inherit the user’s existing login without accessing credential files.
  - Disable tools and source writes.
  - Use read-only/restricted and ephemeral modes.
  - Enforce timeouts and process cancellation.
  - Validate the returned JSON with the existing Zod schemas.
  - Clearly report that monetary cost is unavailable for subscription usage.

  ## 4. Can PHP be added to Phase 7?

  Yes. I recommend choosing PHP as the second language, rather than adding
  PHP alongside Python and Go in the same phase.

  PHP is a credible fit because nikic/PHP-Parser provides precise source
  offsets, namespace-name resolution, comment access, JSON conversion, and
  formatting-preserving transformations. PHP-Parser. PHPStan could optionally
  improve type and call resolution, but should not be required for basic
  drift checking. PHPStan reflection API.

  Phase 7 should cover:

  - Composer-root and project-boundary discovery.
  - Functions, classes, interfaces, traits, enums, methods, constructors,
    properties, and closures assigned to stable names.

  - PHPDoc parsing/rendering.
  - Preservation of @template, @phpstan-*, @psalm-*, annotations, and unknown
    tags.

  - Deterministic insertion and reverse-order edits.
  - Direct/static call resolution where reliable.
  - Honest degradation for dynamic method names, container magic, Laravel-
    style facades, and runtime-generated properties.

  - PHP fixtures and a PHP-specific quality evaluation set.

  Before that adapter is written, the language abstraction needs to become
  real. The LanguageAdapter currently exists only in ARCHITECTURE.md:194;
  production code still directly imports the TypeScript workspace and uses
  TypeScriptProjectHandle in src/cli/generateProject.ts:54 and src/cli/
  workspace.ts:22.

  The current supposedly language-neutral SymbolKind is also TS-oriented and
  lacks PHP concepts such as traits and properties. See src/core/symbol.ts:3.
  Therefore, Phase 7’s exit condition requiring “no changes to core” is
  probably unrealistic. A small, documented generalization is preferable to
  mapping PHP concepts inaccurately. That should receive an ADR.

  ## 5. Can local models be used?

  Yes, and this should be easier than adding agent CLIs.

  An OpenAI-compatible HTTP provider could support:

  - Ollama
  - LM Studio
  - llama.cpp
  - vLLM
  - LocalAI
  - compatible remote gateways

  The critical requirement is schema-constrained JSON. LM Studio and
  llama.cpp already document JSON Schema structured output through OpenAI-
  compatible endpoints. LM Studio structured output, llama.cpp server.

  Remaining considerations:

  - Small local models may produce structurally valid but semantically weak
    documentation.

  - Generation and judging should be evaluated separately; using the same
    weak model for both can let filler through.

  - Context-window capabilities must be checked.
  - The current tokenizer is a generic estimate, not a provider tokenizer, in
    src/core/budget.ts:69.

  - Current cost estimation only recognizes Anthropic model names in src/llm/
    cost.ts:6. Local runs should report “local/unknown cost,” not misleading
    $0.00.

  - Local-provider quality should be measured using the existing Phase 5 eval
    corpus before being presented as equivalent to cloud models.

  Summary: dogfood the current repo now in small dry-run scopes; add a
  provider-transport phase before Phase 7; support official Claude and Codex
  CLIs cautiously; make PHP the second language; and add local models through
  an OpenAI-compatible provider first.
