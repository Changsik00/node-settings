# AGENTS.md

Context for AI coding assistants (Claude, Copilot, Cursor, etc.) working
with this codebase. Humans should read [README.md](./README.md) first.

## What this package is

`@env-kit/node-settings` — a schema-first settings library for Node
apps. One `z.object({...})` schema is the source of truth for:

- typed runtime config (validates `process.env`, layers per-env config,
  applies optional JSON override, freezes the result),
- generated `.env.example` files,
- generated Markdown env documentation,
- generated Kubernetes ConfigMap + Secret manifests,
- a CLI (`node-settings`) that validates env files and runs a per-env
  completeness check in CI.

It targets monorepos via a t3-oss/env-style `extends` field on
`defineSettings(...)`, and the CLI walks up parent directories to find
the config (cosmiconfig-style).

## Public API surface

Import map:

```ts
// Library
import {
  defineSettings,
  defineClientEnv,
  mergePerEnv,
  deepMerge,
  introspectEnvSchema,
  loadNodeEnv,
  loadDotenvFile,
  loadDotenvCascade,
  checkPerEnvCompleteness,
  NodeSettingsError,
} from "@env-kit/node-settings";

// Generators (used by the CLI; importable directly for custom scripts)
import {
  generateEnvExample,
  generateMarkdownDocs,
  generateK8sManifests,
} from "@env-kit/node-settings/generators";

// Vite plugin — validates env at config-resolve time, fails build / dev fast
import { nodeSettings } from "@env-kit/node-settings/vite";

// Next.js plugin — validates env during next.config evaluation
import { withNodeSettings } from "@env-kit/node-settings/next";
```

CLI binary: `node-settings`

Subcommands:

| Command                                 | Purpose                                |
| --------------------------------------- | -------------------------------------- |
| `node-settings validate [env-file]`     | Run the schema against env (CI gate).      |
| `node-settings check [--env name]`      | Per-env placeholder / required check.      |
| `node-settings inspect [--env name]`    | Dry-run: show schema + layered config.     |
| `node-settings preflight [env-file]`    | One-shot: validate + check + inspect.      |
| `node-settings diff [file\|-]`          | Compare live K8s manifest to the schema.   |
| `node-settings generate env-example`    | Write a single `.env.example`.             |
| `node-settings generate envs --out-dir` | One `.env.<branch>.example` per perEnv.    |
| `node-settings generate docs`           | Write Markdown env documentation.          |
| `node-settings generate k8s --name X`   | Write ConfigMap + Secret YAML.             |
| `node-settings generate json-schema`    | Draft 2020-12 JSON Schema for the env.     |
| `node-settings generate tfvars`         | Terraform `.tfvars` file from the schema.  |
| `node-settings generate compose`        | docker-compose snippet (service \| env-file). |

`validate` / `check` / `inspect` / `preflight` / `diff` accept
`--format json` to emit a single structured document on stdout (in
place of human text). `todo()` sentinels serialise as
`{ "$todo": "reason" }`. Use this for CI dashboards and for AI
agents that read CLI output directly.

`diff` reads a multi-doc YAML blob (file path or stdin via `-`) and
compares its ConfigMap / Secret keys to the env schema. Four issue
kinds: `missing-required` (error), `secret-in-configmap` (error),
`public-in-secret` (warning), `extra-key` (warning). The `--strict`
flag promotes warnings to non-zero exit. Typical use: pipe
`kubectl get cm,secret -n prod -o yaml` into it during a CI gate
that verifies the live cluster still matches the schema you ship.

The CLI auto-discovers `node-settings.config.{ts,mts,js,mjs,cjs}` or
`settings.config.{...}`, walking up to the nearest workspace boundary
(`.git`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`,
`rush.json`).

`check`, `inspect`, and `preflight` accept `--workspace`: walks up
to the workspace root and discovers packages in priority order:

1. **`pnpm-workspace.yaml`** `packages:` globs (authoritative when
   present; supports `!`-prefixed exclusions and `**` recursion).
2. **`package.json` `workspaces`** field (npm / yarn / Bun
   convention; both array and `{ packages: [...] }` shapes).
3. **Heuristic fallback** — scans `packages/`, `apps/`, `services/`,
   `libs/` one level deep, for casual single-app repos without a
   declared workspace config.

The discovered directories are filtered to those containing a
`node-settings.config.*` (or `settings.config.*`) file. Exit code
aggregates the worst result across packages. Glob expansion uses
`picomatch`; `node_modules` and dotfile dirs are always skipped.

A GitHub Action is shipped at `action.yml` (composite action). Users
invoke it as `uses: Changsik00/node-settings@v1` with inputs
`command`, `config`, `args`, `version`, `node-version`.

`llms.txt` at the repo root follows the [llmstxt.org](https://llmstxt.org/)
convention so other AI assistants can crawl the doc index directly.

### Build-time validation plugins (Vite + Next.js)

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { nodeSettings } from "@env-kit/node-settings/vite";
export default defineConfig({ plugins: [nodeSettings()] });
```

```ts
// next.config.mjs
import { withNodeSettings } from "@env-kit/node-settings/next";
export default await withNodeSettings({ reactStrictMode: true });
```

Both plugins reuse the same loader the runtime code uses. They run
*before* bundling — Vite in `buildStart`, Next.js during
`next.config` evaluation. `vite build` / `next build` always throw
on validation failure; `vite serve` / `next dev` throw too unless
`failOnDev: false`. Options shape is identical: `config`, `mode`,
`envDir`, `appEnvKey`, `failOnDev`. Vite and Next.js are *optional*
peer deps — only consumers that import the respective entry need
them installed. Next.js phase is read from `process.env.NEXT_PHASE`
(`phase-production-build` / `phase-export` → fail; everything else
respects `failOnDev`).

### Server / client env split (`defineClientEnv`)

`defineSettings` covers the *server*: full env + perEnv + secrets.
For code that ships to the *browser*, use `defineClientEnv` instead —
it's a small, separate factory that enforces a prefix
(`NEXT_PUBLIC_` / `VITE_` / `PUBLIC_`) so server-only secrets can't
leak in. Prefix is checked at definition time (throws
`CLIENT_ENV_PREFIX_VIOLATION`) and non-prefixed keys are filtered
out of the runtime source before zod sees them. Opt-in
`strict: true` flags extra prefixed keys not declared in the schema.

```ts
import { z } from "zod";
import { defineClientEnv } from "@env-kit/node-settings";

export const clientEnv = defineClientEnv({
  prefix: "VITE_",
  schema: z.object({
    VITE_API_URL: z.string().url(),
  }),
});
```

## Core mental model

```
rawEnv (process.env)
  ↓ resolvedSchema.parse(rawEnv)          (zod)
env                                        ←  every parent's schema merged in
  ↓ resolvedPerEnv[env[envKey]]            (lookup)
envSpecific
  ↓ deepMerge(resolvedDefaults, envSpecific)
baseConfig
  ↓ JSON.parse(env[overrideEnvKey])        (optional)
  ↓ validateOverride? + deepMerge
finalConfig
  ↓ build(env, finalConfig)
Settings → Object.freeze
```

The loader returned by `defineSettings(...)` carries three frozen
tooling properties:

- `loader.opts` — the options the caller passed (not the merged view).
- `loader.envFields` — `EnvField[]` introspected from the *merged*
  schema. Used by all generators.
- `loader.resolved` — `{ envSchema, defaults, perEnv, envKey,
  overrideEnvKey }` after all `extends` layers have been merged in.
  Used by `checkPerEnvCompleteness` and the CLI.

## The two "base" axes (often confused)

`defineSettings` has two distinct kinds of base:

| Axis             | "Base" means                                | Override mechanism                          |
| ---------------- | ------------------------------------------- | ------------------------------------------- |
| **Env axis**     | `defaults` — shared across every env        | `perEnv[mode]` (deepMerged on top)          |
| **Package axis** | `extends: [baseLoader]` — another loader    | Child's own `envSchema` / `defaults` / `perEnv` |

Both can be used together. `defaults` is intra-loader; `extends` is
inter-loader.

A third "base" is the `.env.<mode>` file cascade (`loadDotenvCascade`)
— but that layers *env var inputs*, not config values. Don't conflate.

## Three places a value can live (frequently confused)

| Layer                       | Filled by                        | When             | Failure if missing               |
| --------------------------- | -------------------------------- | ---------------- | -------------------------------- |
| `envSchema` field (zod)     | CI / infra / deploy platform     | runtime (boot)   | `ENV_VALIDATION_FAILED`          |
| `perEnv` map (in source)    | developer editing source         | commit time      | `PER_ENV_TODO` (with `todo(...)`)|
| `overrideEnvKey` JSON       | deploy-time tooling / operator   | runtime (boot)   | none (override is optional)      |

**Critical rule.** `todo(...)` is *not* a way to require an env var.
`process.env` does not implicitly fill `perEnv` slots. CI-injected
secrets (`SENTRY_DSN`, `DB_PASSWORD`, ...) belong in `envSchema`. The
`overrideEnvKey` JSON layer is the only runtime path that can fill a
perEnv slot — and even then, secrets should prefer `envSchema`.

When the user asks "I set the env var but `todo()` is still throwing",
that's the symptom of using the wrong layer. See
`docs/CONFIGURATION.md` "Which pattern for which value?".

The `check` CLI runs a **`secret-in-config` lint** that automatically
flags this mistake — any `perEnv` key whose name matches the default
secret patterns (`PASSWORD`, `SECRET`, `TOKEN`, `PRIVATE_?KEY`,
`API_?KEY`, `ACCESS_?KEY`, `CREDENTIAL`, `PASSPHRASE`, `DSN`) raises
a `secret-in-config` warning suggesting it be moved to `envSchema`.
Disable with `lint: false`; customise with `secretKeyPatterns`.

For the actual infra channels operators use (GitHub Actions secrets,
Vault, AWS / GCP Secrets Manager, External Secrets, Doppler, Infisical,
operator-supplied `.env.<mode>.local`), see `docs/DEPLOYMENT.md`
"Injecting secrets from infra". They all converge on `process.env`.

## `todo(...)` sentinels for unfilled values

```ts
import { defineSettings, todo } from "@env-kit/node-settings";

defineSettings({
  // ...
  defaults: { sentryDsn: todo("each env must provide a Sentry DSN") },
  perEnv: {
    local: { sentryDsn: "" },
    prod:  { sentryDsn: todo("set before first deploy") },
  },
});
```

- `todo()` returns `never` (assignable to any field type) and at
  runtime an object marked with `Symbol.for("@env-kit/node-settings:todo")`.
- `deepMerge` treats sentinels as opaque — child values cleanly
  replace parent sentinels; sentinels don't corrupt other values.
- Loader scans the resolved config before `build()`; if any sentinel
  remains for the env being loaded, throws `PER_ENV_TODO` listing
  every unfilled path.
- `checkPerEnvCompleteness` reports each sentinel as a `kind: "todo"`
  error.
- `inspect` CLI prints sentinels as `<TODO: "reason">`.

## File-layout patterns for config

1. **Single file** — everything in `settings.config.ts`. Default.
2. **Split** — `settings.ts` keeps the schema + `build()`,
   `config/{defaults,local,dev,prod}.ts` hold the per-env overrides.
   `env/` holds `.env.<mode>.sample` templates. See `sample/`.
3. **Monorepo** — `packages/shared/settings.base.ts` exports a loader,
   each app does `defineSettings({ extends: [base], ... })`.

## Common patterns

### Single app

```ts
import { z } from "zod";
import { defineSettings } from "@env-kit/node-settings";

const settings = defineSettings({
  envSchema: z.object({
    APP_ENV: z.enum(["local", "dev", "prod"]).default("local"),
    DB_HOST: z.string(),
    DB_PASSWORD: z.string(),       // auto-flagged as secret
  }),
  envKey: "APP_ENV",
  defaults: { bucket: "" },
  perEnv: {
    local: { bucket: "local-b" },
    dev:   { bucket: "dev-b" },
    prod:  { bucket: "prod-b" },
  },
  build: (env, config) => ({
    dbHost: env.DB_HOST,
    bucket: config.bucket,
  }),
});

export default settings;
export type Settings = ReturnType<typeof settings>;
```

### Monorepo composition (extends)

```ts
// packages/shared/settings.base.ts
export const base = defineSettings({ envSchema, envKey, defaults, perEnv, build });

// packages/foo/node-settings.config.ts
export default defineSettings({
  extends: [base],
  envSchema: z.object({ FOO_BUCKET: z.string() }),
  envKey: "APP_ENV",
  defaults: { bucket: "" },
  perEnv: { local: {}, dev: {}, prod: {} },
  build: (env, config) => ({ /* env+config have merged shape */ }),
});
```

`extends` accepts a tuple. Merge order: parents (in array order) then
the child's own. Child wins on collisions. Multiple parents work.

### NestJS

```ts
ConfigModule.forRoot({
  isGlobal: true,
  validate: (raw) => settings(raw),
});
```

### Secret detection

Default name patterns: `PASSWORD`, `SECRET`, `TOKEN`, `PRIVATE_KEY`,
`API_KEY`, `CREDENTIAL`, `PASSPHRASE` (case-insensitive).

Override per field:
- `.describe("... @secret")` — force secret.
- `.describe("... @public")` — force not secret.

Override globally:
- `defineSettings({ secretPatterns: [/MY_THING/], ... })`.

## Error handling

Every error this package throws is a `NodeSettingsError` carrying a
stable `code` plus an optional `hint`. Match on `code`, not `message`.

| `code`                     | When it happens                                              |
| -------------------------- | ------------------------------------------------------------ |
| `INVALID_ENV_SCHEMA`       | `envSchema` is not a `z.object({...})`.                      |
| `MISSING_ENV_KEY`          | `envKey` not in the (merged) schema.                         |
| `INVALID_ENV_KEY_TYPE`     | `envKey` is not `z.string()` / `z.enum(...)`.                |
| `INVALID_OVERRIDE_KEY`     | `overrideEnvKey` not in the (merged) schema.                 |
| `PER_ENV_EMPTY`            | `perEnv` has no branches at all.                             |
| `PER_ENV_KEY_NOT_IN_ENUM`  | `perEnv` branch is not a value of the `envKey` enum (typo).  |
| `PER_ENV_BRANCH_MISSING`   | Runtime: no `perEnv` branch matches the parsed envKey value. |
| `PER_ENV_TODO`             | Loaded branch still has unfilled `todo(...)` sentinels.      |
| `INVALID_EXTENDS_ITEM`     | `extends[i]` is not a `defineSettings(...)` return value.    |
| `OVERRIDE_JSON_PARSE`      | `overrideEnvKey` env var is not valid JSON.                  |
| `ENV_VALIDATION_FAILED`    | Zod env validation failed at runtime.                        |
| `CLIENT_ENV_PREFIX_VIOLATION` | `defineClientEnv` schema key missing the declared prefix. |
| `CLIENT_ENV_UNDECLARED`    | `strict: true` saw a prefixed key not in the client schema.  |
| `CLIENT_ENV_VALIDATION_FAILED` | Zod validation of the client-side env failed.            |

The first six (plus `CLIENT_ENV_PREFIX_VIOLATION`) are raised at
factory call time. The rest surface when the loader is invoked.

## File map

```
src/
  define-settings.ts     # defineSettings(), SettingsLoader, extends merge
  client-env.ts          # defineClientEnv() — prefix-gated browser-safe env
  diff-k8s.ts            # parseK8sYaml() + diffAgainstSchema()
  introspect.ts          # zod schema -> EnvField[], secret detection
  errors.ts              # NodeSettingsError + codes
  validate-options.ts    # defensive checks run at defineSettings time
  check-per-env.ts       # placeholder + missing-env scanner
  index.ts               # public exports

  generators/
    env-example.ts       # generateEnvExample(fields)
    markdown.ts          # generateMarkdownDocs(fields)
    k8s.ts               # generateK8sManifests(fields, { name, ... })

  utils/
    deep-merge.ts        # deepMerge / DeepPartial
    merge-per-env.ts     # mergePerEnv helper
    zod-issues.ts        # ZodError → {path, message}[] / formatted string

  loaders/
    node-env.ts          # loadNodeEnv()
    dotenv-file.ts       # parseDotenv / loadDotenvFile / readDotenvSafe
    dotenv-cascade.ts    # loadDotenvCascade — Vite/Next-style .env layering

  cli/
    bin.ts               # #!/usr/bin/env node entrypoint
    index.ts             # subcommand dispatch
    args.ts              # parseArgs (no external dep)
    load-user-config.ts  # cosmiconfig-style walk-up + jiti loader
    validate.ts          # validate subcommand
    check.ts             # check subcommand
    inspect.ts           # inspect subcommand
    preflight.ts         # composite validate + check + inspect
    diff.ts              # diff subcommand (live K8s manifest vs schema)
    generate.ts          # generate subcommand
    format.ts            # --format text|json helpers
    workspace.ts         # workspace discovery
    help.ts              # help text

  vite/
    index.ts             # nodeSettings() Vite plugin
  next/
    index.ts             # withNodeSettings() Next.js plugin (HOF)
```

## Verification layers (running `pnpm verify`)

Seven layers in order, used to ship to npm with confidence:

1. **`pnpm typecheck`** — `tsc --noEmit`. Includes the type tests
   (`src/types.test.ts`) which guard TypeScript-level contracts via
   `expectTypeOf` (extends merging, `todo(): never`, `NodeSettingsErrorCode`
   union, etc.).
2. **`pnpm test:coverage`** — vitest with `@vitest/coverage-v8`.
   Floors: lines 80, statements 80, functions 85, branches 80. Includes
   unit tests, CLI e2e (`src/cli/cli-e2e.test.ts`), generator snapshots
   (`src/generators/snapshots.test.ts`), and type tests.
3. **`pnpm build`** — `tsc -b tsconfig.build.json`.
4. **`pnpm verify:dist`** — `scripts/verify-dist.mjs`. Imports built
   `dist/index.js`, `dist/generators/index.js`, `dist/cli/index.js`,
   round-trips a `defineSettings` call, asserts the
   `NodeSettingsError(PER_ENV_TODO)` contract.
5. **`pnpm verify:sample`** — runs the CLI binary against
   `sample/settings.ts` to catch packaging regressions.
6. **`pnpm verify:api`** — `scripts/verify-api.mjs`. Compares each
   built entry-point `.d.ts` (root / generators / cli) against the
   committed snapshots in `api-surface/`. Drift fails CI; accept via
   `node scripts/verify-api.mjs --update`.
7. **`pnpm verify:pack`** — `scripts/verify-pack.mjs`. Runs
   `pnpm pack`, asserts required files present and forbidden files
   (src, sample, api-surface, tests, snapshots, docs, scripts,
   coverage, lockfile, tsconfig) are NOT in the tarball.

CI runs all of these on every push / PR across Node 18 / 20 / 22.
`prepublishOnly` runs verify:dist + verify:api + verify:pack so a
broken bundle cannot ship.

When the user reports a regression, the first question is: which
layer would have caught it? If none would have, add coverage there.

## Conventions in this codebase

- **ESM only** (`"type": "module"`). All imports use `.js` suffix even
  for `.ts` source — that's how NodeNext resolution wants them.
- **No emojis** in source, README, or commit messages.
- **No Claude / generated-by attribution** in commits. Author is
  Changsik00 / lowmans00@gmail.com.
- **Tests live next to source** as `*.test.ts`. They're the canonical
  documentation for the public API; reading them is the fastest way to
  learn a feature.
- **Comments explain *why*, not *what***. Public functions have JSDoc
  with at least one runnable `@example`.
- **`peerDependencies: { zod }`** — never bundle zod, never pin it.

## Platform presets (`inferAppEnv`, `presets.*`)

Opt-in adapters that map well-known platform env vars to `APP_ENV`.
Each preset is a factory; pass it to `inferAppEnv()` or to
`loadDotenvCascade({ appEnvPresets: [...] })`.

```ts
import { inferAppEnv, presets } from "@env-kit/node-settings";
const APP_ENV = inferAppEnv({
  presets: [presets.vercel(), presets.githubActions({ branchToMode: { main: "prod" } })],
});
```

Resolution order: `source[APP_ENV]` → `.env` file → presets → default.

| Preset                       | Signal env vars                                  | Default mapping                                                       |
| ---------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| `presets.vercel()`           | `VERCEL_ENV`                                     | production→prod, preview→stage, development→local                     |
| `presets.netlify()`          | `CONTEXT`                                        | production→prod, deploy-preview→stage, branch-deploy→dev, dev→local   |
| `presets.cloudflarePages()`  | `CF_PAGES`, `CF_PAGES_BRANCH`                    | main→prod, others→dev                                                 |
| `presets.githubActions()`    | `GITHUB_ACTIONS`, `GITHUB_REF_NAME`/`GITHUB_REF` | configurable per branch                                               |
| `presets.railway()`          | `RAILWAY_ENVIRONMENT_NAME`                       | production→prod, staging→stage, development→local                     |
| `presets.render()`           | `RENDER`, `IS_PULL_REQUEST`                      | normal→prod, PR→stage                                                 |
| `presets.nodeEnv()`          | `NODE_ENV`                                       | production→prod, development→local, test→test                         |

**No Vite/Turbo presets** — those are build tools, not deployment
platforms; they don't expose a deployment-env signal. Users behind
Vite or Turbo set `APP_ENV` from the actual deploy host or shell.

## The `.env.<mode>` cascade (`loadDotenvCascade`)

Opt-in helper that follows the Vite / Next.js / dotenv-flow naming
convention. Load order (later wins; `process.env` always wins on top):

1. `.env`                — base, committed
2. `.env.local`          — personal overrides, gitignored
3. `.env.<mode>`         — env-specific
4. `.env.<mode>.local`   — env-specific local, gitignored
5. `process.env`         — always wins

`mode` resolves from `process.env[appEnvKey]`, then `.env`'s value,
then `defaultMode` (`'local'` by default). `.local` files are skipped
in `'test'` mode by default.

```ts
import { loadDotenvCascade } from "@env-kit/node-settings";
const { env, mode, loaded, skipped } = loadDotenvCascade({
  cwd: process.cwd(),
  appEnvKey: "APP_ENV",
  defaultMode: "local",
});
```

The library does *not* call this automatically. Users opt in by
calling it explicitly at boot and passing the result to the loader.

## How `APP_ENV` gets set

The library reads `APP_ENV` (or whatever `envKey` is named) from
`process.env`. It does not auto-detect — the deployment platform is
responsible for setting the value. Default `envKey` in the schema
gives a local-dev fallback.

| Platform          | Set `APP_ENV` via                                                  |
| ----------------- | ------------------------------------------------------------------ |
| Local             | `.env` file + dotenv, or shell export                              |
| Docker            | `docker run -e APP_ENV=dev`                                        |
| Docker Compose    | `environment:` or `env_file:` in `docker-compose.yml`              |
| Kubernetes        | ConfigMap from `node-settings generate k8s`                        |
| GitHub Actions    | `env: APP_ENV: ${{ ... }}` on job/step                             |
| Vercel            | Project Settings → Environment Variables, or map from `VERCEL_ENV` |
| Heroku            | `heroku config:set APP_ENV=prod`                                   |
| AWS ECS / Fargate | Task definition `environment` block                                |
| AWS Lambda        | Function env vars (one stack per env)                              |
| Render / Railway  | Dashboard env vars panel or `railway variables set`                |

`APP_ENV` and `NODE_ENV` are orthogonal: `NODE_ENV` is the Node.js
convention (development/production/test) and affects npm install,
framework behavior. `APP_ENV` is this library's per-environment label
and drives `perEnv` lookup.

## When the user asks…

- **"How do I use this in my monorepo?"** → Point to README's "Monorepo
  support" section. Use `extends: [base]`.
- **"My CLI can't find the config."** → It walks up to the nearest
  workspace marker. They can use `--config <path>` explicitly.
- **"How do I add a generator for Terraform / Helm / Pulumi?"** →
  Generators are pure functions over `EnvField[]`. Add a file under
  `src/generators/`, export from `generators/index.ts`, wire into
  `cli/generate.ts`. Tests pattern in `src/generators/k8s.test.ts`.
- **"Why is my zod refinement not introspected?"** → Refinements on the
  outer schema are rejected at `defineSettings(...)` time
  (`INVALID_ENV_SCHEMA`). Apply refinements at the field level instead.

## Out of scope

This package deliberately does not:

- Load `.env` files (host app's responsibility — use `dotenv`, `dotenv-flow`, etc.).
- Provide a logger (`onOverride` hook lets the app inject one).
- Cache env values (env is read once at boot; settings is frozen).
- Talk to Vault / AWS Secrets Manager / etc. (the app loads them into
  the env first, then passes to `loader(env)`).
