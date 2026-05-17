# Architecture

Code-level reference for contributors. Complements:

- [README.md](../README.md) — what this library does (users).
- [AGENTS.md](../AGENTS.md) — concepts, public API, mental model, error codes.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — dev loop, verify chain, commit style.

This document covers code organization, layering, and the patterns a new
contributor must follow to keep changes consistent.

## Layering

Source modules form a strict DAG. Higher layers may import from lower
layers; never the other way.

```
┌──────────────────────────────────────────────┐
│ entry  vite/  next/  esbuild/  cli/          │   adapters
├──────────────────────────────────────────────┤
│ core   define-settings  client-env           │   public factories
│        check-per-env    diff-k8s             │
├──────────────────────────────────────────────┤
│ tools  introspect  todo  presets             │   pure helpers
│        validate-options  generators/         │
├──────────────────────────────────────────────┤
│ infra  loaders/  utils/  errors              │   leaves
└──────────────────────────────────────────────┘
```

Rules:

1. `errors.ts` and `utils/*` are leaves — they import only from `zod` /
   `node:*`. Never the reverse direction.
2. `generators/*` are pure functions over `EnvField[]`. They must not
   import `define-settings.ts`, `cli/*`, `loaders/*`, or any adapter.
3. `cli/*` may import anything in core/tools/infra but no adapter.
4. Adapters (`vite/`, `next/`, `esbuild/`) import only the public API
   surface — same way an external consumer would.
5. Tests live next to source as `<name>.test.ts`. They may break layer
   rules (read internal helpers) — production code may not.

If you find yourself wanting to import "up" the diagram, the abstraction
belongs in a lower layer.

## Directory & file naming

| Path                         | Contains                                              |
| ---------------------------- | ----------------------------------------------------- |
| `src/<name>.ts`              | Top-level public module. One concept per file.        |
| `src/<name>.test.ts`         | Unit tests for the sibling file. Same name + `.test`. |
| `src/<dir>/index.ts`         | Barrel — re-exports the dir's public surface only.    |
| `src/<dir>/<name>.ts`        | Internal module under the dir.                        |
| `src/generators/__snapshots__/` | Vitest snapshot files. Committed.                  |
| `api-surface/*.d.ts`         | Frozen public-API snapshots. Diffs fail CI.           |
| `sample/`                    | Worked example. Verified by `verify:sample`.          |
| `scripts/*.mjs`              | Verify and release scripts. Plain ESM, no TS.         |
| `docs/*.md`                  | User-facing docs. Code blocks tagged `doc-test:check` |
|                              | are compiled by `verify:docs`.                        |

Naming:

- **kebab-case** for files and directories (`check-per-env.ts`, never
  `checkPerEnv.ts`).
- **PascalCase** for types and classes (`NodeSettingsError`,
  `ValidateResult`).
- **camelCase** for functions and variables.
- **SCREAMING_SNAKE** for constants exported as values
  (`TODO_SYMBOL`, `DEFAULT_SECRET_PATTERNS`).
- Function names match their verb-form purpose: `runValidate`,
  `buildValidateResult`, `printValidateResultText`,
  `serializeError`, `findInheritedOverrideEnvKey`.

## ESM resolution: the `.js` suffix on TS imports

```ts
import { deepMerge } from "./utils/deep-merge.js";   // ✓ even though source is .ts
import { deepMerge } from "./utils/deep-merge";      // ✗ — fails NodeNext resolution
```

`tsconfig.json` uses `module: "NodeNext"`. Imports always carry the
emitted extension (`.js`), even from `.ts` source. There are no
exceptions; the typechecker rejects bare specifiers.

## Public-API discipline

The published surface is *exactly* what `api-surface/*.d.ts` says it is.
Anything not exported from `src/index.ts`, `src/generators/index.ts`,
`src/cli/index.ts`, `src/vite/index.ts`, `src/next/index.ts`,
`src/esbuild/index.ts` is internal and can change without a major bump.

When adding a public export:

1. Add the export to the relevant `index.ts`.
2. Run `pnpm build && node scripts/verify-api.mjs --update`.
3. Commit the regenerated `api-surface/` files alongside the change.
4. Add a CHANGELOG entry under `### Added`.

When removing or renaming a public export — that's a **breaking change**.
Bump the major. Document the migration in `docs/migration/`.

## Core patterns

### 1. Factory + frozen loader

`defineSettings` and `defineClientEnv` follow the same shape:

```
validate-at-define-time → freeze options → return a function with
attached metadata that the CLI / generators introspect via
Object.defineProperty (non-enumerable, non-writable, non-configurable).
```

The returned loader is *callable* and carries `.opts`, `.envFields`,
`.resolved` — frozen. Generators read those properties; user code
calls the loader.

When adding a new factory, mirror the shape:

```ts
const frozenOpts = Object.freeze({ ...opts });
const load = ((raw) => { /* ... */ }) as LoaderType;
Object.defineProperty(load, "opts", {
  value: frozenOpts,
  writable: false,
  enumerable: false,
  configurable: false,
});
return load;
```

### 2. Validate-at-define-time vs validate-at-load-time

| Phase            | Catches                                  | Error codes raised                                     |
| ---------------- | ---------------------------------------- | ------------------------------------------------------ |
| Define-time      | Misconfigured schema, typos in `perEnv`, | `INVALID_*`, `MISSING_ENV_KEY`, `PER_ENV_EMPTY`,       |
| (`defineSettings`)| invalid extends                          | `PER_ENV_KEY_NOT_IN_ENUM`, `INVALID_EXTENDS_ITEM`      |
| Load-time        | Bad runtime env                          | `ENV_VALIDATION_FAILED`, `INVALID_ENV_KEY_TYPE`,       |
| (`loader(env)`)  |                                          | `PER_ENV_BRANCH_MISSING`, `PER_ENV_TODO`,              |
|                  |                                          | `OVERRIDE_JSON_PARSE`                                  |

All define-time checks live in `validate-options.ts`. Add new ones
there; do not scatter `throw` calls across the factory.

### 3. CLI subcommand triplet: `runX` / `buildXResult` / `printXResultText`

Every CLI subcommand splits into three exports:

```ts
// 1. The thin entry point — flag parsing, IO, exit code.
export async function runValidate(args: ParsedArgs): Promise<number> { ... }

// 2. Pure compute — produces a serializable Result. Reused by preflight.
export async function buildValidateResult(
  configPath: string | undefined,
  envFileArg: string | undefined,
): Promise<{ result: ValidateResult; envFileMissing?: true }> { ... }

// 3. Human-readable rendering — used when --format text.
export function printValidateResultText(result: ValidateResult): void { ... }
```

The Result type is also the wire format for `--format json`. Tests
exercise `buildXResult` directly so they don't need a tty. New
subcommands MUST follow this triplet.

### 4. Generators are pure functions over `EnvField[]`

```ts
export function generateK8sManifests(
  fields: readonly EnvField[],
  opts: { name: string; ... },
): string { ... }
```

No filesystem, no `process.env`, no zod imports. The CLI is responsible
for I/O. To add a new generator:

1. New file under `src/generators/<format>.ts`.
2. Export from `src/generators/index.ts`.
3. Wire into `src/cli/generate.ts`.
4. Snapshot test in `src/generators/snapshots.test.ts` (or sibling).

### 5. Error throwing

Every `throw` in this package goes through `NodeSettingsError` with a
stable `code` and a `hint`. Never throw bare `Error` from library code.

```ts
throw new NodeSettingsError(
  "PER_ENV_BRANCH_MISSING",
  `perEnv has no branch for '${envValue}'. Known: ${keys}`,
  { hint: `Add perEnv['${envValue}'] = {...}.`, cause: err },
);
```

Message structure: `<what failed>: <observed state>`. Hint structure:
`<concrete action the user should take>`. Pass `cause` when wrapping
another error (zod, fs, etc.) so consumers can drill in.

Adding a new error code:

1. Add to the union in `errors.ts` with a JSDoc explaining when it fires.
2. Document in AGENTS.md "Error handling" table.
3. Document in `docs/ERRORS.md` with at least one example.
4. Cover with a test that asserts `err.code === "NEW_CODE"`.

### 6. Preset pattern

A platform preset is `{ name: string, detect(env) => string | undefined }`.
Detect returns the mode, or `undefined` if it doesn't recognise the env.
Presets compose via `inferAppEnv({ presets: [...] })` in priority order.

When adding a preset:

1. Factory function that returns `AppEnvPreset` so callers can pass
   mappings: `presets.foo({ branchToMode: {...} })`.
2. Default mapping documented in JSDoc.
3. Test that covers all detection branches and the "doesn't match"
   path (must return `undefined`, not throw).

### 7. The build-time plugin pattern (Vite / Next / esbuild)

All three plugins:

1. Locate the user's settings config via `loadUserConfig`.
2. Build settings against `process.env` (optionally also `.env.<mode>`).
3. On failure → throw a `NodeSettingsError` with the original code +
   hint preserved. Build tools surface that as a build failure.
4. Differentiate `build` vs `dev`: prod build always throws,
   dev mode respects `failOnDev` (default true).

When adding a new build-tool integration, mirror the existing three
plugins' option shape: `{ config?, mode?, envDir?, appEnvKey?, failOnDev? }`.

## Testing strategy

| Layer            | File                                  | Purpose                                          |
| ---------------- | ------------------------------------- | ------------------------------------------------ |
| Unit             | `src/**/<name>.test.ts`               | One module, isolated. Most coverage lives here.  |
| Type-level       | `src/types.test.ts`                   | `expectTypeOf` assertions for inferred types.    |
| CLI end-to-end   | `src/cli/cli-e2e.test.ts`             | `runCli(['validate', ...])` returns expected exit code. |
| Generator snapshots | `src/generators/snapshots.test.ts` + `__snapshots__/` | Output diffs visible in review. |
| Mutation         | `pnpm mutation` (Stryker, nightly)    | Surfaces tests that pass without the mutated code mattering. |

Conventions:

- One `describe` block per public function. Nested describes for
  sub-cases.
- Test **observable behaviour**, not implementation. If a test breaks
  on a refactor that didn't change behaviour, the test was wrong.
- For error paths: assert on `err.code`, never on `err.message`
  (messages may evolve; codes are part of the API contract).
- For generator changes: regenerate snapshots only when the output
  diff is intentional. Each diff lands in a single commit so the
  before/after is reviewable.

## Adding a new feature: the checklist

1. **Issue first** — see CONTRIBUTING.md.
2. **Pick the layer.** Pure transform → `generators/` or `utils/`.
   New error → `errors.ts` + docs. New CLI command → `cli/` triplet.
   New loader → `loaders/`.
3. **Write the test that *should* catch a regression** (CONTRIBUTING.md
   "Verify chain" — pick the layer that would have caught the bug if
   the feature regressed later).
4. **Implement.** Match the patterns above.
5. **Update docs.** README (if user-visible), AGENTS.md (if API or
   concept), `docs/ERRORS.md` (if new error code).
6. **Refresh API surface** if public: `pnpm build && node
   scripts/verify-api.mjs --update`.
7. **CHANGELOG entry** under `[Unreleased]`.

## Anti-patterns

These have been tried and rejected:

- **Auto-loading `.env` files.** Host app's responsibility. The
  library reads `process.env` only.
- **Logger interface.** Use the `onOverride` hook to inject one.
- **Mutable settings object.** The loader's output is frozen. Don't
  add a mutator method.
- **`any` in public types.** All public types are precise generics.
  Use `unknown` if the value is genuinely untyped at the boundary.
- **String concatenation for error messages with secrets in scope.**
  Never embed env values into error messages — only key names. Zod's
  errors already redact, ours must too.
- **Top-level `await` in source modules.** Breaks the CJS-compat tests
  in older Node. Adapters' factory functions may be async at call time.
