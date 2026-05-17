# Testing strategy

How `@env-kit/node-settings` is tested, why it's organised the way it
is, and how to decide where a new test belongs.

The short version: tests are split into the standard
**unit / contract / integration / e2e** taxonomy plus a build-time
verify chain. Each category answers a different question and runs at a
different speed, so the dev loop and CI can pick the right subset for
the situation.

## Categories

| Category    | Question it answers                                | Files                                                                                  | Count | Speed     | Script                  |
| ----------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- | ----- | --------- | ----------------------- |
| Unit        | Does this single function behave?                  | `src/**/<name>.test.ts` (excluding the categories below)                               | 213   | very fast | `pnpm test:unit`        |
| Contract    | Are the public types and API surface still stable? | `src/types.test.ts` (`expectTypeOf`) + `verify:api` / `verify:dist` / `verify:errors`  | 17 + 3 scripts | fast | `pnpm test:contract` + `verify:*` |
| Integration | Do we play correctly with third-party libraries?   | `src/vite/vite.test.ts`, `src/next/next.test.ts`, `src/esbuild/esbuild.test.ts`        | 27    | medium    | `pnpm test:integ`       |
| E2E         | Does the user-facing CLI flow work?                | `src/cli/cli-e2e.test.ts` + `scripts/verify-sample.mjs`                                | 37 + 1 script  | slow | `pnpm test:e2e`         |

Plus two background mechanisms:

| Mechanism | Where                                       | What it does                                                                          |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Mutation  | `pnpm mutation` (Stryker, nightly schedule) | Surfaces tests that pass even when the mutated code can't have mattered. Excludes CLI. |
| Verify    | `pnpm verify` (9 layers, every PR)          | Composite gate — every category plus the build-time contract checks below.            |

`pnpm test` runs every category in one vitest pass. `pnpm test:coverage`
adds istanbul instrumentation and the threshold check (see below).

## The verify chain (`pnpm verify`)

| Layer | Command                  | Catches                                                                                                  |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1     | `pnpm typecheck`         | Type contracts. Includes the `expectTypeOf` assertions in `src/types.test.ts`.                           |
| 2     | `pnpm test:coverage`     | Unit / integration / e2e + thresholds. Coverage floors: lines 80, stmts 80, branches 80, fns 85.         |
| 3     | `pnpm build`             | `tsc -b tsconfig.build.json`.                                                                            |
| 4     | `pnpm verify:dist`       | Imports built `dist/*`, asserts every public export resolves, round-trips a `defineSettings` call.       |
| 5     | `pnpm verify:sample`     | Runs the **built** CLI binary against `sample/` so packaging regressions surface before publish.         |
| 6     | `pnpm verify:api`        | Diffs `dist/*.d.ts` against the committed `api-surface/*.d.ts` snapshots. Drift fails CI.                |
| 7     | `pnpm verify:docs`       | Extracts code blocks tagged `<!-- doc-test:check -->` from README / docs and compiles them.              |
| 8     | `pnpm verify:errors`     | Every `ERROR_CATALOG` entry has a real `raise(...)` call + matching anchor in `docs/ERRORS.md`.          |
| 9     | `pnpm verify:pack`       | `pnpm pack` + asserts required files are in the tarball and forbidden ones (src, tests, sample) are not. |

When a regression slips through, the first question is *which layer
should have caught it*. If none would have, add coverage there before
fixing the bug.

## Deciding where a new test belongs

```
Is the test invoking the public CLI binary or `runCli([...])`?
  → e2e (src/cli/cli-e2e.test.ts)

Does it construct a real Vite / Next / esbuild instance and drive its
lifecycle?
  → integ (src/vite/, src/next/, src/esbuild/)

Does it assert on the *type* (compile-time shape) of an export, or
on the published API surface?
  → contract (src/types.test.ts, or scripts/verify-*.mjs for runtime
              contract)

Otherwise:
  → unit (next to the source as <name>.test.ts)
```

Trade-off when the test could plausibly live in two categories: prefer
the **fastest** one that still catches the regression. A unit test
that proves the bug is worth more than an e2e test that proves it,
because it runs every dev-loop iteration.

## Conventions

- **One `describe` per public function**, with nested `describe`s for
  sub-cases. Test names start with "returns" / "throws" / "fails when".
- **Test observable behaviour, not implementation.** A refactor that
  doesn't change behaviour must not break a test. If it does, the
  test was asserting on incidentals — rewrite it.
- **Error-path tests assert on `err.code`, never on `err.message`.**
  Codes are part of the public contract (see
  [`ERROR_CATALOG`](../src/errors.ts)); messages may evolve in minor
  versions. `err.severity` is also stable and matchable.
- **Snapshots only for generator output**
  (`src/generators/__snapshots__/`). Everything else uses explicit
  `expect` assertions so reviewers see what's being checked rather
  than a hash to update.
- **Tests live next to source** as `<name>.test.ts`. Don't introduce
  a top-level `tests/` directory — colocation keeps a feature's code
  and its tests in the same diff.
- **Unit tests must not touch the network or wall clock.** Filesystem
  is allowed when scoped under `mkdtempSync(os.tmpdir())`. Integration
  and e2e tests may use any of these but must clean up in `afterEach`.
- **CLI e2e tests capture `console.log/error` and `process.stdout/stderr`
  separately.** Text output goes through console; `--format=json`
  output goes through `process.stdout.write`. Asserting against the
  wrong capture is a common source of false failures.

## Coverage philosophy

The thresholds (lines 80 / stmts 80 / branches 80 / fns 85) are set
*just below* current measured coverage. The goal is two-fold:

1. A small regression in test discipline bothers the PR author —
   the build fails on a 1% drop, not 5%.
2. The floors creep up over time. When the suite measures 89%, a new
   PR adding code that's only 70% covered drags the number down. The
   number itself is uninteresting; the *trend* is what we watch.

Don't lower thresholds without discussion. If a PR's natural coverage
falls below the floor, the right answer is almost always to add
tests, not to relax the limit.

## Mutation testing (Stryker)

`pnpm mutation` runs the full vitest suite against systematically
mutated copies of the source. A surviving mutant means a test was
asserting on something other than the mutated behaviour — i.e. the
test passes even when the code is wrong.

Configuration: `stryker.conf.mjs`. The mutation runner uses its own
`vitest.mutation.config.ts` because CLI tests rely on
`process.chdir`, which throws inside the worker threads Stryker
spawns. Excluded paths:

- `src/cli/**` — `process.chdir` incompatibility
- `src/vite/**`, `src/next/**`, `src/esbuild/**` — integration tests
  rely on real plugin lifecycle; mutation noise is not actionable
- `src/**/__snapshots__/**`

The job runs nightly via `.github/workflows/mutation.yml`. PR-time
runs use `workflow_dispatch` when a substantial test-suite change
lands.

## CI

Every PR runs `pnpm verify` across a 3 × 3 matrix (Ubuntu / macOS /
Windows × Node 18 / 20 / 22). Mutation testing is decoupled — it
runs nightly on Ubuntu / Node 20, because Stryker takes 10–30× as
long as the regular suite.

## When tests don't catch a bug

If a regression ships, treat it as a test-suite gap before fixing the
code:

1. Identify the layer that *should* have caught it.
2. Add the missing test there. It must fail without the fix.
3. Apply the fix. The test now passes.
4. Both commits land together (or the test commit lands first).

This keeps the suite growing in the direction of past mistakes —
fixed bugs don't regress.
