# Configuration guide

How `defineSettings` is structured, what the two "base" concepts mean,
and how to lay out config in a project of any size.

## Two "base" axes (often confused)

There are *two* separate bases in this library. They sit on different
axes.

| Axis              | "Base" means                                        | Override mechanism                              |
| ----------------- | --------------------------------------------------- | ----------------------------------------------- |
| **Env axis**      | `defaults` — values shared across every environment | `perEnv[mode]` (deepMerged on top)              |
| **Package axis**  | `extends: [baseLoader]` — another loader's whole shape | child's own `envSchema` / `defaults` / `perEnv` |

You can use both at once. `defaults` is your *intra-loader* base
(applies to every env), `extends` is your *inter-loader* base (shared
across packages in a monorepo).

There's also a third "base" outside the loader: the `.env.<mode>` file
cascade. That layers **env-var inputs**, not config values. See the
[deployment guide](./DEPLOYMENT.md) for that.

### Quick recap — which "base" do I want?

| Question                                                              | Use                |
| --------------------------------------------------------------------- | ------------------ |
| "Some values are the same across local/dev/prod"                      | `defaults`         |
| "Some values differ per environment"                                  | `perEnv[mode]`     |
| "Some env vars come from `.env` files at the project root"            | `loadDotenvCascade` |
| "Many apps in this monorepo share the same env vars and defaults"     | `extends: [base]`  |

## File-layout patterns

### Single-file (default)

Everything in one `settings.config.ts`. Best for small/medium apps.

<!-- doc-test:check -->
```ts
import { z } from "zod";
import { defineSettings } from "@env-kit/node-settings";

export default defineSettings({
  envSchema: z.object({
    APP_ENV: z.enum(["local", "dev", "prod"]).default("local"),
    DB_HOST: z.string(),
  }),
  envKey: "APP_ENV",
  defaults: { bucket: "", workerConcurrency: 1 },
  perEnv: {
    local: { bucket: "local-bucket" },
    dev:   { bucket: "dev-bucket" },
    prod:  { bucket: "prod-bucket", workerConcurrency: 8 },
  },
  build: (env, config) => ({
    dbHost: env.DB_HOST,
    bucket: config.bucket,
    workerConcurrency: config.workerConcurrency,
  }),
});
```

### Split-file

When `perEnv` outgrows a single screen: keep the schema and `build()`
in `settings.ts`, put each env's overrides in its own file.

```
settings.ts                  # envSchema + build()
config/
  defaults.ts                # exports AppConfig type + defaults
  local.ts                   # DeepPartial<AppConfig> for local
  dev.ts
  prod.ts
```

See [`sample/`](../sample) for a worked example. Per-env files import
`AppConfig` from `defaults.ts` and export `DeepPartial<AppConfig>`, so
typos and removed fields fail compilation.

### Monorepo (with `extends`)

Shared base loader in one package; child loaders in each app.
Modeled after `@t3-oss/env-core`'s `extends`.

```
packages/
  shared/
    settings.base.ts         # exports `base` from defineSettings(...)
  content-api/
    settings.config.ts       # defineSettings({ extends: [base], ... })
  worker/
    settings.config.ts       # defineSettings({ extends: [base], ... })
```

```ts
// packages/shared/settings.base.ts
import { z } from "zod";
import { defineSettings } from "@env-kit/node-settings";

export const base = defineSettings({
  envSchema: z.object({
    APP_ENV: z.enum(["local", "dev", "prod"]).default("local"),
    DB_HOST: z.string(),
    DB_PASSWORD: z.string(),
  }),
  envKey: "APP_ENV",
  defaults: { region: "us-east-1", logLevel: "info" },
  perEnv: {
    local: { logLevel: "debug" },
    dev: {},
    prod: {},
  },
  build: (env, config) => ({
    dbHost: env.DB_HOST,
    region: config.region,
    logLevel: config.logLevel,
  }),
});
```

```ts
// packages/content-api/settings.config.ts
import { z } from "zod";
import { defineSettings } from "@env-kit/node-settings";
import { base } from "../shared/settings.base.js";

export default defineSettings({
  extends: [base],
  envSchema: z.object({ CONTENT_BUCKET: z.string() }),
  envKey: "APP_ENV",
  defaults: { bucket: "" },
  perEnv: {
    local: { bucket: "local-content" },
    dev:   { bucket: "dev-content" },
    prod:  { bucket: "prod-content" },
  },
  build: (env, config) => ({
    contentBucket: env.CONTENT_BUCKET, // child env
    dbHost: env.DB_HOST,                // from base
    bucket: config.bucket,              // child config
    region: config.region,              // from base
  }),
});
```

Merge rules:

| Field            | Behavior                                                              |
| ---------------- | --------------------------------------------------------------------- |
| `envSchema`      | `parent.merge(child)` via zod's built-in object merge (child wins).   |
| `defaults`       | `deepMerge(parent, child)` (child wins, nested objects merged).       |
| `perEnv`         | Per env key, `deepMerge(parent, child)`.                              |
| `envKey`         | Child wins.                                                           |
| `overrideEnvKey` | Child wins; if omitted, inherited from the last parent that sets one. |
| `envOverrides`   | Shallow-merged across parents then child (`{ ...parents, ...child }`). |
| `build`          | Child's only — but `env` / `config` parameters have the merged shape. |

Multiple parents are supported (merged in array order, later wins):

```ts
defineSettings({ extends: [base, logging, metrics], /* ... */ });
```

### CLI walk-up auto-discovery

When you run the CLI from a package subdirectory, it walks up the
directory tree to find a `node-settings.config.*` (or
`settings.config.*`) in any ancestor — the same convention `tsc`,
`eslint`, and other cosmiconfig-based tools use.

```
my-monorepo/
├── .git/                              ← walk stops here
├── pnpm-workspace.yaml
├── node-settings.config.ts            ← (optional) root config
└── packages/
    └── content-api/
        ├── node-settings.config.ts    ← found first if present
        └── src/
```

Stop markers: `.git`, `pnpm-workspace.yaml`, `lerna.json`, `turbo.json`,
`nx.json`, `rush.json`.

### `mergePerEnv` — programmatic composition helper

If you compose `perEnv` outside of `defineSettings`:

```ts
import { mergePerEnv } from "@env-kit/node-settings";

const perEnv = mergePerEnv(basePerEnv, {
  local: { bucket: "local-content" },
  prod:  { bucket: "prod-content" },
});
```

## Layering model

```
rawEnv (process.env or loadDotenvCascade output)
  ↓ resolvedSchema.parse(rawEnv)         (zod, with all `extends` merged)
env
  ↓ resolvedPerEnv[env[envKey]]          (perEnv branch lookup)
envSpecific
  ↓ deepMerge(resolvedDefaults, envSpecific)
baseConfig
  ↓ envOverrides: write env[VAR] into config path (optional, per-field)
configWithEnvOverrides
  ↓ JSON.parse(env[overrideEnvKey])      (optional, top-priority layer)
  ↓ validateOverride? + deepMerge
finalConfig
  ↓ build(env, finalConfig)
Settings → Object.freeze
```

## Which pattern for which value?

Three places a value can live, and they're filled in at three different
times. **Picking the wrong place is the most common source of "but I
set the env var, why doesn't it work?" confusion.**

| Where it lives                  | Filled by                              | At                | Failure mode if missing                  |
| ------------------------------- | -------------------------------------- | ----------------- | ---------------------------------------- |
| **`envSchema`** field (zod)     | CI / infra / deploy platform / shell   | runtime (boot)    | `ENV_VALIDATION_FAILED` (zod)            |
| **`perEnv`** map (in source)    | a developer editing source             | commit time       | `PER_ENV_TODO` (with `todo(...)`)        |
| **`envOverrides`** (env→config) | deploy-time tooling, per-field tuning   | runtime (boot)    | nothing — skipped when the env var is unset |
| **`overrideEnvKey` JSON** (env) | deploy-time tooling, ad-hoc operator   | runtime (boot)    | nothing — override is optional by design |

### Use `envSchema` for…

- **CI-injected secrets** (`SENTRY_DSN`, `DB_PASSWORD`, `STRIPE_KEY`, …).
  Anything the infra team / secret manager supplies.
- **Per-deployment values** that vary even within the same `APP_ENV`
  (think: pod IP, replica index).
- Values you don't want committed to the repo.

```ts
envSchema: z.object({
  SENTRY_DSN: z.string().describe("Sentry DSN @secret"),  // required at boot
}),
build: (env, config) => ({ sentryDsn: env.SENTRY_DSN }),
```

If CI forgets to set `SENTRY_DSN`, the loader throws
`ENV_VALIDATION_FAILED` with the missing key.

### Use `perEnv` for…

- **Values that are static per environment** and committed to source
  (bucket name, region, CDN domain, feature flag defaults).
- Values that everyone reviewing the PR should see change.
- Values that can be different for `local` / `dev` / `prod` without
  needing to coordinate with infra.

```ts
perEnv: {
  prod: { bucket: "prod-bucket" },
}
```

If you scaffold a slot but don't fill it yet, use `todo(...)`:

```ts
perEnv: {
  prod: { cdnDomain: todo("set prod CDN domain before deploy") },
}
```

The loader throws `PER_ENV_TODO` for *that* env until you replace it.

### Use `overrideEnvKey` JSON for…

- One-off operational overrides without a code change
  (`CONFIG_OVERRIDE_JSON='{"workerConcurrency":16}'`).
- Per-deployment knobs the infra team controls separately from the
  schema.

### Use `envOverrides` for…

- A **single env var that should override one config field** at deploy
  time — the typed, per-field alternative to the `overrideEnvKey` JSON
  blob. CI sets the env var; if it's present, its (zod-validated) value
  replaces the config value at the declared path. If it's unset, the
  config value stands.

```ts
defineSettings({
  envSchema: z.object({
    APP_ENV: z.enum(["local", "prod"]),
    TIMEOUT: z.coerce.number().optional(),  // also a config concept
  }),
  envKey: "APP_ENV",
  defaults: { http: { timeout: 3000 } },
  perEnv: { local: {}, prod: { http: { timeout: 5000 } } },
  // Declares the intent: env TIMEOUT overrides config.http.timeout.
  envOverrides: { TIMEOUT: "http.timeout" },
  build: (_env, config) => config,
});
```

The map key is an env var name (must exist in `envSchema`); the value is
a dot-path into the config. Absent / `undefined` env values are skipped,
so an unset override never clobbers a configured value. The
`overrideEnvKey` JSON blob, if also set, still wins over `envOverrides`.

**Why a first-class option instead of `{ ...config, ...env }` in
`build()`?** When the same key lives in both `envSchema` and the config
layers, spreading env over config inside `build()` silently overwrites
one with the other, and the precedence is invisible to anyone reading
the schema. `envOverrides` makes that contract explicit and validated:
the override is declared in one place, the env var is checked against
the schema at definition time, and tooling can read it from
`loader.resolved.envOverrides`.

### ⚠ `todo(...)` is *not* a way to require an env var

A common mistake: putting `todo(...)` on a value you intend CI to
inject. **That does not work.**

```ts
// ✗ WRONG — CI cannot fill this; loader always throws PER_ENV_TODO
perEnv: {
  prod: { sentryDsn: todo("CI will provide") },
}
```

`process.env` and `perEnv` are *different layers* and the library does
**not** silently copy env-var values into perEnv slots. To require a
value from CI, put it in `envSchema`:

```ts
// ✓ RIGHT — CI sets process.env.SENTRY_DSN; zod enforces it
envSchema: z.object({ SENTRY_DSN: z.string() }),
build: (env, config) => ({ sentryDsn: env.SENTRY_DSN }),
```

The only way to fill a perEnv slot at runtime is the
`overrideEnvKey` JSON layer:

```ts
overrideEnvKey: "CONFIG_OVERRIDE_JSON",
// process.env.CONFIG_OVERRIDE_JSON='{"sentryDsn":"https://..."}'
```

…but for secrets, prefer `envSchema` — it's typed, narrower in
scope, and integrates with the K8s Secret generator.

## Mark unfilled values with `todo(...)`

When you scaffold a per-env file ahead of having the real values, mark
the placeholders with `todo(reason)`. The loader scans the final
config before calling `build()` and throws if any sentinel survives.

```ts
import { defineSettings, todo } from "@env-kit/node-settings";

defineSettings({
  envSchema,
  envKey: "APP_ENV",
  defaults: {
    bucket: "",
    sentryDsn: todo("each per-env branch must set its Sentry DSN"),
  },
  perEnv: {
    local: { bucket: "local-b", sentryDsn: "" }, // disabled locally
    dev:   { bucket: "dev-b",   sentryDsn: "https://...@sentry.io/..." },
    prod:  { bucket: "prod-b",  sentryDsn: todo("set before first deploy") },
  },
  build: (env, config) => ({ ... }),
});
```

Behavior:

- **Type-safe at compile time.** `todo()` returns `never`, which is
  assignable to any field. Your `DeepPartial<AppConfig>` types stay
  honest.
- **Opaque to deepMerge.** A child branch's real value cleanly
  replaces a parent's sentinel. A child sentinel does *not* corrupt
  the parent's value.
- **Loud at boot.** Loading an env that still has sentinels throws
  `NodeSettingsError` with code `PER_ENV_TODO`, listing every unfilled
  path and its reason.
- **CI gate.** `node-settings check` reports every sentinel across
  every perEnv branch as a `kind: "todo"` error, so you catch them
  before deploy.
- **Clear in `inspect`.** `node-settings inspect --env=prod` prints
  sentinels as `<TODO: "...">` rather than dumping the marker object.

Use `todo()` in `defaults` to declare a field that *every* per-env
branch must fill in. Use it in a specific per-env branch to flag
"this env exists but isn't ready yet".

See [`sample/`](../sample) for a worked example.

## See what your config resolves to

When in doubt, dry-run it with the CLI:

```bash
node-settings inspect --env=prod
```

Prints the env schema (the contract) plus the layered config
(`defaults` deep-merged with `perEnv.prod`) without calling your
`build()` function — no env values required. Great for "what does prod
look like?" without prod secrets.
