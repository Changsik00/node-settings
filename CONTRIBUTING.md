# Contributing

Thanks for considering a contribution. This document covers the
mechanics of working on the codebase — issues, dev loop, verify
chain, doc-only changes, releasing.

For high-level context (what this library is, why the abstractions
exist), read [README.md](./README.md) first, then
[AGENTS.md](./AGENTS.md) for the deeper technical view.

## Where to ask

- **Bugs and concrete proposals**: [GitHub Issues](https://github.com/Changsik00/node-settings/issues).
- **Open-ended discussion / "should we support X?"**: same issue
  tracker, prefix the title with `discussion:`.
- **Security issues**: do *not* open a public issue. Email
  lowmans00@gmail.com — see SECURITY.md if present, otherwise the
  contact in `package.json`.

## Local setup

```bash
# Node 18+, pnpm 10+
pnpm install
pnpm verify    # runs the full chain — see "Verify chain" below
```

The repo is ESM (`"type": "module"`), strict TypeScript, vitest for
tests. No additional global tools required.

If you're new to the project, the fastest way to orient yourself:

```bash
node-settings inspect --config sample/settings.ts
node-settings inspect --config sample/settings.ts --env=prod
```

Then read `sample/README.md` — it's the canonical worked example
and shows every concept in one cohesive project.

## Dev loop

```bash
pnpm test:watch         # tests in watch mode
pnpm typecheck          # tsc --noEmit
pnpm test -- --update   # update vitest snapshots after intentional changes
```

### Test categories

Tests are split into four categories. Pick the smallest one that
covers what you changed:

| Script              | Runs                                                      | Speed   |
| ------------------- | --------------------------------------------------------- | ------- |
| `pnpm test:unit`    | Single-module unit tests (most of `src/`)                 | ~1s     |
| `pnpm test:contract`| Type-level assertions (`src/types.test.ts`)               | <1s     |
| `pnpm test:integ`   | Real Vite / Next / esbuild plugin lifecycle               | ~2s     |
| `pnpm test:e2e`     | CLI invocation (`runCli([...])`) end-to-end               | ~5s     |
| `pnpm test`         | All four in one pass                                      | ~6s     |
| `pnpm test:coverage`| Everything + istanbul coverage report                     | ~7s     |

The verify chain (`pnpm verify`) wraps these and adds the build-time
contract checks: `verify:dist`, `verify:api`, `verify:errors`,
`verify:sample`, `verify:docs`, `verify:pack`. See
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md#testing-strategy)
for the full taxonomy and how to decide which category a new test
belongs in.

For a single focused file:

```bash
pnpm vitest run src/cli/cli-e2e.test.ts
```

## Verify chain

`pnpm verify` runs eight layers in order. Each must pass before a
change can land on `main`. They map to specific failure modes:

| Layer | Command | Catches |
| --- | --- | --- |
| 1 | `pnpm typecheck` | Type contracts (incl. `expectTypeOf` tests in `src/types.test.ts`). |
| 2 | `pnpm test:coverage` | Unit / CLI e2e / generator snapshots. Floors: stmts 80, fns 85, branches 80, lines 80. |
| 3 | `pnpm build` | `tsc -b tsconfig.build.json`. |
| 4 | `pnpm verify:dist` | Imports built `dist/*` and asserts every public export resolves. Round-trips `defineSettings` + `defineClientEnv` + asserts the NodeSettingsError contract. |
| 5 | `pnpm verify:sample` | Runs the *built* CLI against `sample/settings.ts` to catch packaging regressions. |
| 6 | `pnpm verify:api` | Diffs `dist/*.d.ts` against committed `api-surface/*.d.ts` snapshots. Drift fails CI; accept intentional changes via `node scripts/verify-api.mjs --update`. |
| 7 | `pnpm verify:docs` | Extracts code blocks tagged with `<!-- doc-test:check -->` from README / AGENTS / docs and compiles them under `tsc --noEmit`. |
| 8 | `pnpm verify:pack` | `pnpm pack` + asserts required files are in the tarball and forbidden files (src, tests, snapshots, scripts, sample, …) are not. |

When you change behaviour, the first question is *which layer should
have caught the regression* — if none would have, add coverage there.

## Conventions

- **ESM only.** All imports use `.js` suffix even for `.ts` source —
  that's how NodeNext resolution wants them.
- **No emojis** in source, README, or commit messages.
- **No AI-attribution** in commits. Author is the human who ran the
  command, not the agent that drafted the diff. (The project's git
  history reflects this — keep it consistent.)
- **English-only documentation.** The library targets a global
  audience.
- **No comments unless they explain *why***. Identifiers explain
  *what*. If you find yourself describing what code does, rename it
  or refactor instead.

## Commit messages

Conventional Commits style, but loosely:

```
feat(cli): new --workspace option
fix(check-per-env): scanConfig recurses through nested arrays
docs(sample): explain env-vs-config split
test: tighten validate-options branch coverage
chore: ...
```

Subject under 70 chars. Body explains the *why* — what changed in
code is visible in the diff. Group related changes; avoid
catch-all commits.

## Doc-only PRs

Doc-only changes still run the full verify chain (so `<!-- doc-test:check -->`
blocks compile, and the api-surface diff doesn't get accidentally
included). To check locally before pushing:

```bash
pnpm verify:docs
```

Doc-only PRs typically land same-day.

## Adding a new feature

1. **Open an issue first** for anything beyond a small bugfix.
   Saves both of us from "this isn't quite the design we want"
   feedback after a PR is written.
2. **Update `AGENTS.md`** if the feature changes the public API or
   adds a new concept. AI assistants and human readers both rely
   on it.
3. **Add tests at the layer that *should* catch the regression.**
   Most features need a unit test + a CLI e2e test (if user-visible)
   + a snapshot test (if generator output changes).
4. **Refresh the API surface** if you added a public export:
   ```bash
   pnpm build
   node scripts/verify-api.mjs --update
   git add api-surface/
   ```
5. **CHANGELOG entry** under `[Unreleased]`. Group by `### Added` /
   `### Changed` / `### Fixed`. The release script promotes
   `[Unreleased]` to a versioned section.

## Releasing

Maintainers only. See [RELEASING.md](./RELEASING.md) for the full
flow. TL;DR:

```bash
pnpm release 0.12.0   # bumps + tags + pushes; CI creates the GitHub Release
npm publish --access public   # manual until Trusted Publishing is fixed
```

## Tracked roadmap

The active backlog lives in [BACKLOG.md](./BACKLOG.md), grouped by
theme. Items there are pre-approved-as-direction — feel free to
pick one up, ideally after a "claiming this" comment on the
matching issue (or open one if it doesn't exist).
