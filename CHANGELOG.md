# Changelog

All notable changes to this project are documented here. Versions follow
[Semantic Versioning](https://semver.org/). The project uses tag-based
releases — see [RELEASING.md](./RELEASING.md). Day-to-day changes land
under `[Unreleased]` and are promoted to a versioned section when
`pnpm release <version>` runs.

## [Unreleased]

### Added

- **`docs/ARCHITECTURE.md`** — contributor-facing reference covering
  the layering rules, file/directory naming conventions, ESM
  resolution discipline, and the core code patterns (factory +
  frozen loader, define-time vs load-time validation, CLI
  `run`/`build`/`print` triplet, generator purity, error throwing,
  preset shape, build-tool plugin shape).
- **`raise(code, message, options?)`** helper in `errors.ts` —
  terse single-call alternative to `throw new NodeSettingsError(...)`
  that returns `never` for cleaner control flow.
- **`utils/zod-issues.ts`** — `zodIssuesOf` + `formatZodIssues`
  consolidate the three previously-duplicated `ZodError → path/message`
  formatters into one source of truth.
- **Five new `NodeSettingsErrorCode` values** wrap previously-bare
  fs/parse failures so callers can match on `.code`:
  `CONFIG_NOT_FOUND`, `CONFIG_LOAD_FAILED`, `CONFIG_INVALID_EXPORT`,
  `FILE_READ_FAILED`, `K8S_YAML_PARSE_FAILED`. Documented in
  `docs/ERRORS.md`.
- **`readDotenvSafe(path)`** in `loaders/dotenv-file.ts` — wraps
  `readFileSync` failures in `FILE_READ_FAILED`.

### Changed

- **`cli/generate.ts`** rewritten around a `HANDLERS` dispatch table.
  Each generator is a single registry entry with its aliases and a
  `run(loader, args)` function; the 90-line switch becomes a Map lookup.
- **`cli/check.ts`, `cli/inspect.ts`, `cli/preflight.ts`** share a
  new `cli/workspace-runner.ts` for workspace setup, header rendering,
  and per-package banners. Removes ~80 lines of duplicated boilerplate.
- **`introspect.ts`** primitive-type detection replaced with a
  `PRIMITIVE_TYPE_RESOLVERS` lookup map; supporting a new primitive
  type is now a one-line table entry instead of an `else if` branch.
- Internal `formatZodError` / inline `err.errors.map(...)` formatters
  replaced with the shared `formatZodIssues` / `zodIssuesOf`.

### Removed

- **`loadViteEnv`** (was a placeholder returning `{}`) and its
  source `src/loaders/vite-env.ts`. Vite consumers should use
  `import.meta.env` directly or `@env-kit/node-settings/vite`.
  **Breaking change** — slated for v1.0.0.
- **`src/utils/index.ts`** — unused barrel, no external impact.

## [0.12.0] — 2026-05-16
### Added

- **esbuild build-time validation plugin** (`@env-kit/node-settings/esbuild`).
  Mirrors the Vite / Next plugins: loads the cascade, runs the
  loader at `build.onStart`, and reports validation failures as
  esbuild errors so the build aborts. `failOnError: false`
  downgrades to a warning (useful for watch mode). esbuild itself
  has no native dev/build distinction, so a single boolean was
  enough — no `failOnDev` knob needed. esbuild is an optional peer
  dep (no install penalty for non-esbuild projects). Completes the
  build-time plugin trifecta the README has been advertising.
- **Mutation testing (Stryker) on a nightly schedule.** New
  `pnpm mutation` script and `.github/workflows/mutation.yml`
  workflow that runs Stryker against the pure-logic source files
  (`check-*.ts`, `diff-k8s.ts`, `validate-options.ts`,
  `introspect.ts`, `define-settings.ts`, generators, loaders,
  utils, presets, todo). The CLI surface is excluded — its tests
  rely on `process.chdir`, which throws inside the worker threads
  Stryker spawns. A dedicated `vitest.mutation.config.ts` skips
  those tests. Score thresholds start at break=50 / low=60 /
  high=80 — raise as test quality improves. Reports are uploaded
  as a 14-day workflow artefact.
- **`CONTRIBUTING.md`** with local setup, the verify-chain mapping
  (each of the eight layers and what kind of regression it catches),
  conventions (ESM-with-.js-imports, no emojis, no AI-attribution,
  English-only), commit-message style, and the "adding a feature"
  checklist (issue first → tests + AGENTS update + CHANGELOG entry).
- **Windows in CI** — `ci.yml` matrix now runs ubuntu + macos +
  windows × Node 18/20/22 (9 jobs). Two scripts had to become
  cross-platform first:
    - `verify-pack.mjs` now lists tarball contents via a tiny
      in-process gzip + tar parser (~30 lines) instead of
      `tar -tzf` (which behaves differently on Windows).
    - `verify:sample` moved into `scripts/verify-sample.mjs` (Node
      `spawnSync` of the built CLI binary + structural assertions
      on stdout) so it no longer relies on `> /dev/null`.
    - `clean` script rewritten in Node so it works on Windows cmd.

### Changed

- **Test coverage tightened** on `validate-options.ts` and
  `check-per-env.ts`. Added 18 targeted tests covering each
  remaining branch (ZodNativeEnum perEnv keys, ZodOptional /
  ZodNullable wrapper unwrapping on envKey, scanConfig recursion
  into nested objects and arrays, empty-string warnings, custom
  placeholder patterns, missing-branch error, secret-in-config
  lint including nested array paths, `lint: false` opt-out,
  custom secretKeyPatterns).
- **Coverage provider switched from `v8` to `istanbul`**
  (`@vitest/coverage-istanbul`). v8 was under-reporting when the
  same module was loaded both directly and transitively (different
  per-file numbers when running in isolation vs. as part of the
  full suite). istanbul aggregates correctly across import paths.
  Full-suite coverage is now 87%+ (was reporting 82% on v8 from
  the same tests).
- **`sample/` restructured to feel like one real project.** The
  `.env`, `.env.local`, `.env.dev`, `.env.stage`, `.env.prod` files
  now sit at the sample's project root (where a real app would have
  them), not in a `sample/env/` subdirectory. A new
  `sample/.gitignore` documents the real-world env-file gitignore
  strategy. `sample/README.md` rewritten to read as a project
  README (file layout, env-vs-config table, the cascade-to-frozen
  flow diagram, two worked examples walking one key through every
  layer, and the runtime-override escape hatch).
- **`sample/consumer/` removed.** The external consumer smoke test
  was useful for one finding (the AnySettingsLoader variance
  issue, logged separately) but the ongoing maintenance + the
  visual clash with "sample is one project" outweighed the value.
  `.github/workflows/consumer.yml` deleted too.
- **`--workspace` discovery now parses `pnpm-workspace.yaml` and
  `package.json` `workspaces` instead of the hardcoded heuristic
  scan.** Priority order: pnpm-workspace.yaml (authoritative when
  present) → package.json workspaces (npm / yarn / Bun) →
  heuristic fallback (`packages/`, `apps/`, `services/`, `libs/`)
  for casual single-app repos with no declared workspace config.
  Supports `!`-prefixed exclusions and `**` recursive globs.
  Glob matching via `picomatch` (small, zero-dep). `node_modules`
  and dotfile dirs are always skipped. An explicit empty
  `packages: []` is honoured — no fallback. 8 new workspace tests
  covering each source and edge case.

### Added

- **Migration guides** (`docs/migration/`) for moving onto this
  library from the four most common neighbours: `from-t3-oss-env.md`
  (Next.js + zod), `from-convict.md` (mature server config),
  `from-node-config.md` (YAML/JSON file cascade), `from-dotenv-flow.md`
  (`.env.<mode>` cascade with no validation). Each guide has a
  before/after side-by-side, a feature-mapping table, a numbered
  step-by-step, gotchas specific to that library, and a "what you
  gain" summary. Indexed at `docs/migration/README.md`.
- **Hybrid release workflow** (`release.yml`). Tag pushes now build,
  verify, and create the GitHub Release page automatically; `npm
  publish` stays manual until the Trusted Publishing OIDC handshake
  is verified working (see BACKLOG.md "Trusted Publishing finalize").
- **One-off OIDC debug workflow** (`oidc-debug.yml`,
  `workflow_dispatch` only) that prints the GitHub Actions OIDC
  token claims for the `npm:registry.npmjs.org` audience. Useful
  when configuring Trusted Publishers and as a future reference.

## [0.11.1] — 2026-05-16

### Added

- **External consumer smoke test** (`sample/consumer/`). A private
  test package under the canonical sample directory that installs
  `@env-kit/node-settings` from the npm registry (not a workspace
  link) and compiles a small app under `strict: true,
  skipLibCheck: false` plus a Node runtime check. New CI workflow
  `.github/workflows/consumer.yml` runs it on every push to `main`,
  on PRs that touch the consumer dir, and on a daily cron (catches
  registry-side regressions). Closes the gap between "works in our
  repo" and "works from npm" — a class of issue that loose in-repo
  `skipLibCheck: true` settings can mask.
- **Realistic `.env.<mode>` files in `sample/env/`.** Previously the
  directory was empty even though the README claimed templates lived
  there. Now ships `.env`, `.env.local`, `.env.dev`, `.env.stage`,
  `.env.prod` with example values + comments explaining which lines
  CI fills in.
- **`sample/README.md` rewrite** with an explicit "env/ = sensitive
  runtime values vs config/ = settings + cross-team intent" table
  plus an ASCII data-flow diagram showing the four `.env` tiers
  cascading into `process.env` and the rest of the pipeline.

### Changed

- **Merged `examples/consumer/` into `sample/consumer/`.** Having
  two example-like directories was confusing; the consumer smoke
  test now lives under the canonical sample/ home. CI workflow
  paths updated.

### Notes

- This release was published from a local `npm publish` while the
  CI Trusted Publishing path is being debugged (see BACKLOG.md
  "Trusted Publishing finalize"). Subsequent releases will use the
  GitHub Actions workflow once OIDC matching is verified. The
  tarball for this version therefore carries no npm provenance
  attestation; that lands in v0.11.2+.

## [0.11.0] — 2026-05-16
### Added

- **`generate tfvars`** — Terraform `.tfvars` file from the schema.
  Required values and secrets render as `REPLACE_ME` placeholders;
  optional fields use their schema default. Booleans / numbers are
  emitted as native HCL types. Pair with `variable "X" {}` blocks
  alongside your Terraform resources. Pipe-friendly for IaC handoff
  without manual transcription.
- **`generate compose`** — Docker Compose fragment from the schema.
  Default `--style service` yields a ready-to-merge `services:` block
  with `${VAR:-default}` / `${VAR}` interpolation (so values stay in
  the host shell / `.env`); `--style env-file` yields a flat
  `KEY=VALUE` file for `env_file:` references. `--name` overrides
  the service name (default `app`).
- Both generators are exported from `@env-kit/node-settings/generators`
  (`generateTfvars`, `generateComposeFragment`) for programmatic use.
- **Next.js plugin** — `import { withNodeSettings } from
  "@env-kit/node-settings/next"`. Wraps the user's `next.config`
  as `withNodeSettings(nextConfig, options?)` and runs env
  validation during config evaluation, *before* Webpack / Turbopack
  starts. `next build` and `next export` always abort on validation
  failure; `next dev` aborts too unless `failOnDev: false`. Reads
  `process.env.NEXT_PHASE` to pick the right behaviour. Next.js is
  added as an *optional* peer dep (`^13 || ^14 || ^15 || ^16`); only
  consumers importing the `/next` entry need it installed.
- The "Build-time validation plugin" comparison row now genuinely
  covers both Vite and Next.js — the row label was updated to reflect
  that.
- **`node-settings diff [file|-]` — K8s drift detection.** Compares
  a live ConfigMap / Secret YAML (file path or stdin) against the env
  schema. Four issue kinds: `missing-required` and
  `secret-in-configmap` are errors (block deploys); `public-in-secret`
  and `extra-key` are warnings (use `--strict` to upgrade). Pipe
  `kubectl get cm,secret -n <ns> -o yaml | node-settings diff -` in
  a CI gate to verify the live cluster still matches the schema you
  ship. `--format json` emits a `DiffReport` document. Closes the
  loop on the `generate k8s` direction — the schema is now the source
  of truth for both writing and verifying cluster state.
- New `yaml` runtime dep (parser for the diff input). Small, no
  transitive deps; loaded only by the `diff` path.
- **`defineClientEnv` — server / client env split.** New factory at
  the package root for browser-bundled env. Takes a `prefix`
  (`NEXT_PUBLIC_` / `VITE_` / `PUBLIC_` / …) and a zod schema; throws
  `CLIENT_ENV_PREFIX_VIOLATION` immediately if any schema key omits
  the prefix, and at runtime filters non-prefixed keys out of the
  source before zod sees them so server-only secrets can't leak in.
  Opt-in `strict: true` flags extra prefixed keys not declared in the
  schema. New error codes: `CLIENT_ENV_PREFIX_VIOLATION`,
  `CLIENT_ENV_UNDECLARED`, `CLIENT_ENV_VALIDATION_FAILED`. Pair with
  `defineSettings` (which stays server-only) — the prefix is your
  compile-time *and* runtime firewall.
- **Vite plugin** — `import { nodeSettings } from
  "@env-kit/node-settings/vite"`. Validates env at config-resolve
  time so `vite build` aborts before bundling on bad env, and the
  dev server refuses to start (override with `failOnDev: false`).
  Reuses the same loader your runtime code calls — the contract you
  ship is exactly the one your build was gated on. Vite is an
  optional peer dep (`vite ^4 || ^5 || ^6 || ^7`); only projects
  that import `/vite` need it installed.
- **`node-settings preflight [env-file]`** — one-shot CI gate that
  composes `validate` + `check` + `inspect` into a single command
  with one exit code. Supports `--config`, `--env`, `--env-file`,
  `--workspace`, `--allow-warnings`, and `--format=json`. The JSON
  payload bundles all three stages under `validate` / `check` /
  `inspect` keys so CI dashboards and AI agents see one document
  instead of three.
- **`--format=json` on `validate` / `check` / `inspect` /
  `preflight`.** Each command emits a single structured JSON
  document on stdout (instead of human-formatted text). Stable
  shapes: `ValidateResult` (with `error.code` + `error.issues[]`
  when zod fails), `CheckResult` / `WorkspaceCheckResult` (carrying
  the full `PerEnvCompletenessReport`), `InspectResult` /
  `WorkspaceInspectResult` (with `envSchema` + per-branch layered
  `config`). `todo()` sentinels serialise natively as
  `{ "$todo": "reason" }` via `Symbol.toPrimitive`-style `toJSON`.
- **JSON Schema generator.** `generateJsonSchema(envFields, options?)`
  exported from `@env-kit/node-settings/generators`. CLI:
  `node-settings generate json-schema [--out file.json] [--title s]
  [--id url] [--description s]`. Produces a Draft 2020-12 schema with
  `format: "password"` + `x-secret: true` on secret fields,
  deterministic `required[]` ordering, and the `additionalProperties:
  true` default. Useful for IDE / editor / AI introspection and
  OpenAPI bridging.
- **`--workspace` flag on `check` and `inspect`.** Walks up to the
  workspace root (`.git` / `pnpm-workspace.yaml` / `turbo.json` /
  `nx.json` / `lerna.json` / `rush.json`) and runs the command
  against every package found under `packages/`, `apps/`, `services/`,
  `libs/` that has a `node-settings.config.*` (or `settings.config.*`)
  file. Exit code aggregates the worst result. Full pnpm-workspace
  glob expansion is tracked in `BACKLOG.md`.
- **GitHub Action** (`action.yml` at repo root). Composite action with
  `command` / `config` / `args` / `version` / `node-version` inputs.
  Usage: `uses: Changsik00/node-settings@v1 with: { command: validate
  }`. Documented in README.
- **`llms.txt`** at repo root following the [llmstxt.org](https://llmstxt.org/)
  convention — name, summary, doc index, API entry points, error
  codes. Lets non-AGENTS-aware AI assistants index the project.
- **Comparison table** in README ranking node-settings against
  dotenv / dotenv-flow / t3-oss-env / convict / node-config across
  16 capabilities. Honest about the mindshare gap.
- **`BACKLOG.md`** at repo root. Categorized future work (CI/CD,
  AI, env+config, monorepo, robustness, generators, docs, project
  hygiene) so post-publish iteration has a tracked starting point.
- Tag-based release flow (`RELEASING.md`, `scripts/release.mjs`,
  `pnpm release <semver>`). Feature commits no longer touch
  `package.json` `version`; the script handles bump + changelog
  promotion + commit + tag + push as a single operation.
- Doc code-block compile verification (`scripts/verify-docs.mjs`).
  Extracts every ` ```ts ` / ` ```typescript ` block from `README.md`,
  `AGENTS.md`, `RELEASING.md`, `docs/*.md`, and `sample/README.md`,
  wraps each with a generous preamble, and runs `tsc --noEmit`. Catches
  doc drift. Blocks opt in via `<!-- doc-test:check -->`.
- macOS added to the CI matrix alongside Ubuntu — every push / PR now
  runs the full verification chain on both, across Node 18 / 20 / 22
  (6 jobs total).

### Changed

- `pnpm verify` chain now includes `verify:docs` and runs on macOS.
- Install instructions in README switched from `npm install` to
  `pnpm add`. (CLI invocations stay with `npx` since it's the broadly
  understood ad-hoc form.)
- `verify-pack.mjs` forbid list extended to keep `action.yml`,
  `llms.txt`, `BACKLOG.md` out of the published tarball (repo-only).
- `verify-dist.mjs` checks for `generateJsonSchema` in the generators
  export.
- `api-surface/generators.d.ts` snapshot refreshed with the new
  `generateJsonSchema` / `JsonSchemaOptions` exports.

## [0.10.0] — 2026-05-15

### Added — three Tier-2 verification layers

Closes the rest of the "how do we know this works?" gaps surfaced by
the audit. The chain is now seven layers deep (typecheck → test+coverage
→ build → dist → sample → api → pack) and runs on every push / PR.

- **Type tests via `expectTypeOf`** (`src/types.test.ts`). 17 tests
  guarding TypeScript-level contracts that erase at runtime:
  - `defineSettings(...)` return type and tooling props
    (`envFields`, `resolved`, `opts`).
  - `extends: [base]` merges parent + child types into `build()`'s
    `env` and `config` parameters.
  - `todo()` returns `never` and is assignable to every field type.
  - `inferAppEnv`, `loadDotenvCascade`, `presets.*`, `mergePerEnv`
    each return the documented shape.
  - `NodeSettingsErrorCode` is exactly the documented union (catches
    accidental code additions / removals).
- **Coverage thresholds** via `@vitest/coverage-v8`. Floors:
  lines 80, statements 80, functions 85, branches 80. Current run:
  lines 82.77 / functions 90.9 / branches 83 / statements 82.77.
  Re-export-only index files, the bin shim, type-test files, and the
  Vite-env placeholder are excluded from coverage. New
  `pnpm test:coverage` script.
- **Public API surface tracking** (`scripts/verify-api.mjs` +
  `api-surface/{root,generators,cli}.d.ts`). Snapshots each entry
  point's `.d.ts` declaration file. Drift fails CI with a pointer
  to `--update`. Catches accidental additions / removals of types,
  classes, functions, even subtle parameter-type changes — the
  things `verify:dist` (runtime introspection only) can't see.
- **Extra `validate` CLI tests** in `cli-e2e.test.ts` (the 3%
  coverage outlier from before). 3 tests covering OK / fail /
  missing-file paths.

### Changed — `pnpm verify` chain extended

The unified `pnpm verify` now runs:

    typecheck → test:coverage → build → verify:dist
              → verify:sample → verify:api → verify:pack

`prepublishOnly` now also runs `verify:api` so a publish cannot
ship an unintended API change.

### Internal

- 163 tests across 21 files (was 143). Coverage gate active.
  `api-surface/` snapshots committed (45 lines total).
  Typecheck + build + every verification layer clean.

## [0.9.0] — 2026-05-15

### Added — five new layers of verification

Audit of "how do we know this works?" surfaced gaps: unit tests alone
didn't cover CLI behaviour end-to-end, exact generator output, the
built `dist/` exports, or what `pnpm pack` actually ships. This
release closes those gaps so we can publish to npm with confidence.

- **CLI e2e tests** (`src/cli/cli-e2e.test.ts`) — 11 tests calling
  `runCli` directly against `sample/settings.ts`, asserting exit
  codes, file outputs, and console output for every subcommand
  (`inspect`, `check`, `generate {env-example,envs,docs,k8s}`, help,
  unknown command).
- **Generator snapshot tests** (`src/generators/snapshots.test.ts`)
  — 8 `toMatchSnapshot` tests covering `.env.example` (default +
  unmasked), Markdown docs (default + custom title), K8s manifests
  (stringData + base64 inlineSecretValues), per-env examples (with
  + without summary). Any format change shows up as a snapshot diff
  in PR review.
- **`scripts/verify-dist.mjs`** — Node script that imports the
  built `dist/index.js`, `dist/generators/index.js`,
  `dist/cli/index.js` and asserts every public export exists,
  round-trips a `defineSettings` call, and verifies the
  `NodeSettingsError(PER_ENV_TODO)` contract. Catches packaging
  mistakes that src/ tests can't see.
- **`scripts/verify-pack.mjs`** — runs `pnpm pack`, lists tarball
  contents, asserts required files (`dist/`, `README.md`, `LICENSE`,
  `AGENTS.md`, `CHANGELOG.md`) are present and forbidden files
  (`src/`, `sample/`, `docs/`, `scripts/`, `*.test.*`,
  `__snapshots__`, `tsconfig*`, `pnpm-lock.yaml`) are absent. Also
  checks every `.js` has a paired `.d.ts`.
- **CI integration** — every push / PR now runs all five layers:
  typecheck → test (incl. snapshots + e2e) → build → verify:dist
  → verify:sample → verify:pack on Node 18 / 20 / 22.

### Added — `package.json` scripts

- `pnpm verify` — chains typecheck + test + build + verify:dist +
  verify:sample + verify:pack. The single command before any release.
- `pnpm verify:dist` / `verify:sample` / `verify:pack` — individual
  layers. Useful for debugging a single failure mode.
- `prepublishOnly` now runs `verify:dist` and `verify:pack` too,
  so `npm publish` cannot ship a broken bundle.

### Changed — `package.json` `files`

Now includes `AGENTS.md` and `CHANGELOG.md` in the published
tarball alongside `dist/`, `README.md`, and `LICENSE`.

### Internal

- 11 + 8 = 19 new tests. 143 tests across 20 files, all green.
  Typecheck + build clean. No breaking API changes.

## [0.8.0] — 2026-05-15

### Added — `secret-in-config` lint

`checkPerEnvCompleteness` now runs a design-time lint pass that
flags secret-looking keys placed in `perEnv`. This is the trap from
the previous release: a value the operator is supposed to inject
ends up in `perEnv` instead of `envSchema`, and the operator's
`process.env.X` cannot reach it.

- **New `PerEnvIssue` kind**: `'secret-in-config'` (severity:
  `warning`). The message points users to `envSchema` so CI / Vault
  / Secrets Manager can override the value.
- **New `CheckPerEnvOptions` fields**:
  - `lint?: boolean` (default `true`) — toggle the pass.
  - `secretKeyPatterns?: readonly RegExp[]` (defaults to the
    introspector's `DEFAULT_SECRET_PATTERNS`) — customise which
    names trigger.
- **Patterns expanded.** `DEFAULT_SECRET_PATTERNS` now uses optional
  underscores so it matches both SCREAMING_SNAKE env-var names
  (`PRIVATE_KEY`) and camelCase config-key names (`privateKey`):
  `PASSWORD`, `SECRET`, `TOKEN`, `PRIVATE_?KEY`, `API_?KEY`,
  `ACCESS_?KEY`, `CREDENTIAL`, `PASSPHRASE`, `DSN`.
- **CLI**: `node-settings check` surfaces these as warnings (does
  not exit non-zero by default — use `--no-allow-warnings` to fail).
- **Help text + AGENTS.md** updated to reflect the new lint.

### Added — "Injecting secrets from infra" guide

`docs/DEPLOYMENT.md` gets a comprehensive new section covering the
infra channels users actually use:

- GitHub Actions secrets → `env:` block
- HashiCorp Vault (Agent / Sidecar / CSI volume)
- AWS Secrets Manager + ECS / Fargate
- AWS Lambda + Secrets Manager
- Kubernetes External Secrets Operator / Sealed Secrets
- Doppler / Infisical / 1Password CLI wrappers
- Operator-supplied `.env.<mode>.local` (cascade integration)

All paths converge on `process.env`, which is the only safe
override channel — reinforces the design rationale for the lint.

### Internal

- 6 new tests in `src/check-lint.test.ts`. 124 tests across 18
  files, all green. Typecheck + build clean. No API breaking changes.

## [0.7.1] — 2026-05-15

### Fixed — sample conflated two distinct value patterns

The 0.7.0 sample used `todo(...)` on `sentryDsn` inside `perEnv`,
suggesting `todo()` was a way to mark "CI will fill this in". It
isn't — `process.env` and `perEnv` are different layers, and
setting an env var does NOT implicitly fill a perEnv slot.

- **Moved `SENTRY_DSN` out of `perEnv` and into `envSchema`** in
  `sample/settings.ts`. It's a CI-injected secret; the right place
  is the env schema, where zod's required check enforces that CI
  set it. `build()` now reads `env.SENTRY_DSN` directly.
- **Replaced the `todo()` demo target** with a clearly committed
  per-env value — `cdnDomain` — so `sample/config/prod.ts` still
  demonstrates the `PER_ENV_TODO` failure path without mixing the
  pattern up with secrets.
- Sample `.env.<mode>.sample` files now list `SENTRY_DSN` in the
  secrets section.

### Added — "Which pattern for which value?" docs

- New decision-table section in `docs/CONFIGURATION.md` covering:
  - `envSchema` (CI-injected) → `ENV_VALIDATION_FAILED`
  - `perEnv` (committed) → `PER_ENV_TODO`
  - `overrideEnvKey` JSON (runtime override)
- Explicit "⚠ `todo(...)` is not a way to require an env var" call-out.
- `sample/README.md` rewritten with a two-pattern comparison table.
- `AGENTS.md` gets the same disambiguation, plus a hint for the most
  common user question ("I set the env var but `todo()` is still
  throwing").

### Changed — `PER_ENV_TODO` error hint

The thrown error now includes guidance pointing users to either
`envSchema` (for CI-injected values) or the JSON override layer
(for ad-hoc operational overrides), instead of just saying "fill in
perEnv".

### Internal

- No API changes. 118 tests still passing. Sample CLI smoke-tested.

## [0.7.0] — 2026-05-15

### Added — `todo(reason)` sentinel for unfilled config values

Type-safe replacement for the old "match `TODO-…` strings via regex"
approach. Declares "this slot must be filled in before the env that
contains it can be loaded" in a way the loader, the deep-merge, the
`check` CLI, and the `inspect` CLI all understand.

- **`todo(reason?: string): never`** — exported from the package
  root. Returns `never` so the result is assignable to any field
  type; at runtime returns a sentinel object marked with
  `Symbol.for("@env-kit/node-settings:todo")`.
- **`isTodo(value): value is TodoSentinel`** and
  **`findTodos(value): { path, reason }[]`** helpers.
- **`deepMerge` skips sentinels.** A sentinel is opaque — child
  branches that supply a real value cleanly replace it; nested
  merging never descends into a sentinel.
- **Loader integration.** After the deep-merge but before calling
  `build()`, the loader scans the resolved config and throws
  `NodeSettingsError` with the new code `PER_ENV_TODO` if any
  sentinel survives, listing every unfilled path and its reason.
- **`check` CLI integration.** Reports each sentinel as a
  `kind: "todo"` error across every perEnv branch — catches "I
  scaffolded prod but forgot to fill it in" at CI time.
- **`inspect` CLI integration.** Prints sentinels as `<TODO: "...">`
  instead of dumping the marker object.

### Changed — sample/ demonstrates the pattern

- `sample/config/defaults.ts` declares `region` and `sentryDsn` as
  `todo(...)` — every per-env branch must supply a real value.
- `sample/config/{local,dev,stage}.ts` all fill them in.
- `sample/config/prod.ts` deliberately leaves `sentryDsn` as
  `todo(...)` to demonstrate the loud failure path:
  - `inspect --env=prod` prints `sentryDsn: <TODO: "...">`
  - `check` reports `kind:'todo'` error for prod
  - loading APP_ENV=prod throws `PER_ENV_TODO`
- `sample/README.md` walks through this end-to-end.

### Internal

- 12 new tests covering the sentinel, deepMerge interaction, loader
  throw, multi-path error reporting, `check` integration, and JSON
  override filling in a sentinel. 118 tests across 17 files,
  typecheck + build clean.

## [0.6.0] — 2026-05-15

### Added — platform presets

Opt-in adapters that map well-known platform env vars to `APP_ENV`.
Users compose them explicitly — no magic auto-detection.

- **`presets.*`** factory namespace, exporting:
  - `presets.vercel({ production?, preview?, development? })`
  - `presets.netlify({ production?, 'deploy-preview'?, 'branch-deploy'?, dev? })`
  - `presets.cloudflarePages({ productionBranch?, productionMode?, defaultMode? })`
  - `presets.githubActions({ branchToMode?, default? })`
  - `presets.railway({ production?, staging?, development? })`
  - `presets.render({ production?, preview? })`
  - `presets.nodeEnv({ production?, development?, test? })`
- **`inferAppEnv({ source?, presets?, default?, envKey? })`** — runs
  presets in priority order, returns the resolved mode.
- **`inferAppEnvDetailed(...)`** — returns `{ value, source, presetName }`
  for debugging "why does my app think it's local in production?" cases.
- **`loadDotenvCascade({ appEnvPresets })`** — presets integrate into
  the existing cascade. Resolution order: `source[APP_ENV]` → `.env`
  file → presets → default.
- **Build tools intentionally excluded.** No Vite / Turbo / Webpack
  presets — those are build tools, not deployment platforms; they
  don't expose a deployment-env signal. Documented in the deployment
  guide.

### Changed — sample reorganization

Consolidated `examples/env-samples/` + `examples/multi-file/` into
a single canonical example at `sample/`:

```
sample/
├── settings.ts             # the canonical entry point
├── env/                    # .env.<mode>.sample templates
└── config/                 # split TS config layers
```

`sample/README.md` explains the layout, the wiring, and how to drop
the templates into your own project. All doc references updated.

### Changed — README slimmed; detailed docs moved to `docs/`

The main README was getting long. Heavy content has moved to dedicated
guides; the README is now badges + TL;DR + features + CLI + links.

- **`docs/CONFIGURATION.md`** — the two "base" axes, file-layout
  patterns (single / split / monorepo), `extends`, `mergePerEnv`, the
  layering model, CLI walk-up.
- **`docs/DEPLOYMENT.md`** — setting `APP_ENV` per platform (Docker,
  K8s, GH Actions, Vercel, Heroku, ECS, Lambda, Render / Railway / Fly),
  the new `presets.*` system, the `.env.<mode>` cascade.
- **`docs/ERRORS.md`** — full `NodeSettingsError.code` reference.
- **`AGENTS.md`** updated with the presets section and a "no Vite /
  Turbo" note so AI assistants stop suggesting those.

### Internal

- 19 new tests covering presets + cascade integration. 106 tests
  across 16 files. Typecheck + build clean.

## [0.5.0] — 2026-05-15

### Added — config organization guidance

The package previously documented how to layer *env vars* (defaults
vs perEnv, plus the `.env.<mode>` cascade) but said nothing about how
to *organise the config itself* — and there were two unrelated "base"
concepts (`defaults` and `extends`) that looked the same from a
distance. This release addresses both.

- **`inspect [--env <name>]` CLI subcommand**. Dry-run inspection
  that prints the env schema *contract* plus the layered config
  (`defaults` deep-merged with `perEnv[mode]`) for each branch.
  Doesn't call your `build()` so no env values / secrets are needed.
  Answers "what does my prod config actually look like?" without
  prod credentials.
- **`examples/multi-file/`** — a worked-out example showing the
  split-file pattern: `settings.config.ts` at the root holds the
  schema + `build()`, while `config/defaults.ts`, `config/local.ts`,
  `config/dev.ts`, `config/stage.ts`, `config/prod.ts` each hold
  one slice. Same generators, same CLI, same runtime — just
  better git-blame.
- **README "Where your config lives" section**. Disambiguates the
  two "base" axes (intra-loader `defaults` vs inter-loader
  `extends`) with a table and a decision matrix. Three file-layout
  patterns documented: single-file, split-file, monorepo.
- **AGENTS.md** gets a matching "two base axes" section and a
  file-layout patterns list so AI assistants give consistent advice.

### Internal

- 87 tests across 15 files (no test changes; `inspect` is exercised
  by smoke runs against the bundled examples). Typecheck + build
  clean.

## [0.4.0] — 2026-05-15

### Added — `loadDotenvCascade()` helper

Adopt the file-naming convention every other Node tool already uses
(Next.js, Vite, dotenv-flow, Create React App). The library previously
left env-loading entirely to the host app; this opt-in helper closes
the gap so users can drop `.env.local` / `.env.<mode>` files at the
project root and have them load in the right order.

- **`loadDotenvCascade({ cwd?, appEnvKey?, defaultMode?, skipLocalFor?, source? })`**
  exported from the package root and `./loaders`. Returns `{ env,
  mode, loaded, skipped }`.
- Load order (later wins, `process.env` always tops):
  1. `.env`                  — base, committed
  2. `.env.local`            — personal overrides, gitignored
  3. `.env.<mode>`           — env-specific
  4. `.env.<mode>.local`     — env-specific local, gitignored
  5. `process.env`           — always wins
- Mode resolves from `process.env[appEnvKey]`, then `.env`'s value,
  then `defaultMode` (default `'local'`).
- `.local` files are skipped in `'test'` mode by default (same as Vite
  / Next). Customise via `skipLocalFor`.
- The existing committed templates in `examples/env-samples/` plug
  straight in: drop the `.sample` suffix and the cascade picks them up.

### Updated

- README — new "Local development — the `.env.<mode>` cascade"
  subsection, plus a feature-grid bullet.
- AGENTS.md — new section documenting the cascade for AI assistants.

### Internal

- 9 cascade tests covering load order, `process.env` precedence,
  mode discovery from `.env`, `skipLocalFor`, custom `appEnvKey`,
  empty cwd. 87 tests across 15 files.

## [0.3.0] — 2026-05-15

### Added — per-env env samples + platform documentation

- **`generate envs` CLI subcommand**. Emits one
  `.env.<branch>.example` file per `perEnv` branch into `--out-dir`,
  with the loader's `envKey` (e.g. `APP_ENV`) pre-filled and a comment
  block summarising the layered config that branch resolves to.
- **`generatePerEnvExamples(loader, options?)`** — programmatic helper
  exported from `@env-kit/node-settings/generators`. Returns a
  `Record<envName, string>` of generated `.env` contents.
- **`generateEnvExample(fields, { values, ... })`** — the existing
  helper now accepts a `values` map for pre-filling specific keys.
- **Hand-written samples** in `examples/env-samples/` —
  `.env.local.sample`, `.env.dev.sample`, `.env.stage.sample`,
  `.env.prod.sample`, plus a README. The `.gitignore` no longer
  ignores `*.sample` / `.env.*.example`.
- **README — "Setting `APP_ENV` across deployments" section**. Concrete
  patterns for Docker, Docker Compose, Kubernetes, GitHub Actions,
  Vercel, Heroku, AWS ECS / Lambda, Render / Railway / Fly. Plus an
  `APP_ENV` vs `NODE_ENV` clarification table.
- **AGENTS.md** updated with the platform table and the new generator.

### Internal

- 6 new tests covering the values option and per-env helper. 78 tests
  across 14 files. Typecheck + build clean.

## [0.2.0] — 2026-05-15

### Added — monorepo support

- **`extends`** on `defineSettings`. Modeled after
  [`@t3-oss/env-core`](https://github.com/t3-oss/t3-env). Pass an array
  of parent loaders; their `envSchema`, `defaults`, and `perEnv` merge
  into the child's at runtime, and the `build(env, config)` callback
  receives the merged type via the new `MergedEnv` / `MergedConfig`
  helper types.
- **`SettingsLoader.resolved`** — frozen view of the merged
  `{ envSchema, defaults, perEnv, envKey, overrideEnvKey }`. Generators
  and `checkPerEnvCompleteness` now read from this view so inherited
  config participates in every output.
- **`mergePerEnv`** — public helper for composing per-env config maps
  outside of `defineSettings`.
- **CLI walk-up auto-discovery**. `loadUserConfig` walks parent
  directories until a `node-settings.config.*` / `settings.config.*` is
  found or it hits a workspace marker (`.git`, `pnpm-workspace.yaml`,
  `turbo.json`, `nx.json`, `lerna.json`, `rush.json`). Same convention
  as `tsc`, `eslint`, and the rest of the cosmiconfig family.

### Added — defensive validations

- **`NodeSettingsError`** — every thrown error now carries a stable
  string `code` plus an optional `hint`. Codes:
  `INVALID_ENV_SCHEMA`, `MISSING_ENV_KEY`, `INVALID_ENV_KEY_TYPE`,
  `INVALID_OVERRIDE_KEY`, `PER_ENV_EMPTY`, `PER_ENV_KEY_NOT_IN_ENUM`,
  `PER_ENV_BRANCH_MISSING`, `INVALID_EXTENDS_ITEM`,
  `OVERRIDE_JSON_PARSE`, `ENV_VALIDATION_FAILED`.
- **Definition-time validation**. `defineSettings(...)` now rejects:
  - `envSchema` that is not a `z.object({...})`,
  - an `envKey` that does not exist in the (merged) schema,
  - an `envKey` whose underlying type is not `z.string()` or `z.enum(...)`,
  - a `perEnv` with no branches at all,
  - `perEnv` keys that are not values of the `envKey` enum (typo guard),
  - an `overrideEnvKey` that does not exist in the schema,
  - `extends` entries that are not `defineSettings(...)` return values.
- Zod env validation errors at load time are now wrapped as
  `ENV_VALIDATION_FAILED` with a path-by-path summary, preserving the
  original `ZodError` as `.cause`.
- `OVERRIDE_JSON_PARSE` errors include a hint on the expected format.

### Added — docs and tooling

- **`AGENTS.md`** at repo root — a concise context document for AI
  coding assistants (Claude, Copilot, Cursor, etc.).
- **README polish** — feature grid, badge cluster (npm, CI, license,
  Node, install size, bundle size), TOC, and a new "Errors" section.

### Internal

- 72 tests across 13 files, all passing. Typecheck and build clean.

## [0.1.0] — 2026-05-15

Initial release.

- `defineSettings({ envSchema, envKey, defaults, perEnv, build, ... })`
  — zod env validation + per-env config layering + optional JSON
  override + frozen result.
- `introspectEnvSchema` with auto secret detection.
- Generators: `.env.example`, Markdown docs, Kubernetes
  ConfigMap/Secret manifests.
- `checkPerEnvCompleteness` — placeholder / missing-env scanner.
- CLI `node-settings` with `validate`, `check`, `generate` subcommands.
- GitHub Actions CI matrix (Node 18 / 20 / 22) + release workflow.
- MIT license.
