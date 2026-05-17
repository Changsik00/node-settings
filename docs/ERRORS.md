# Error codes

Every error thrown by `@env-kit/node-settings` is a `NodeSettingsError`
carrying a stable `.code`, a severity classification, and an optional
`.hint` with a remediation tip. Match on `.code` (never on `.message`).

```ts
import { NodeSettingsError, reportError } from "@env-kit/node-settings";

try {
  const cfg = settings(process.env);
} catch (err) {
  if (err instanceof NodeSettingsError) {
    // Programmatic handling
    switch (err.code) {
      case "ENV_VALIDATION_FAILED":
        console.error("missing env vars — see schema");
        break;
      case "PER_ENV_BRANCH_MISSING":
        console.error(`unknown APP_ENV value: ${err.message}`);
        break;
      default:
        console.error(err.message);
    }
  }
  // Or feed the structured report to your logger / dashboard
  console.error(JSON.stringify(reportError(err)));
  process.exit(1);
}
```

`NodeSettingsError` exposes:

- `.code` — one of [`NodeSettingsErrorCode`](#catalog). Stable across
  minor versions.
- `.severity` — `"config" | "runtime" | "io" | "usage"`. Use it to
  route to the right alarm channel.
- `.title` — short human title for log subjects / dashboards.
- `.hint` — concrete action the caller should take, if applicable.
- `.docsUrl` — direct link to the relevant section of this document.
- `.cause` — wrapped underlying error (often a `ZodError` or an `fs`
  exception).

`reportError(err)` distills any throw — `NodeSettingsError`, `ZodError`,
or `Error` — into a JSON-serialisable [`ErrorReport`](../README.md)
with all of the above plus an `issues[]` array when the cause was a
zod validation failure.

## Severity buckets

| Severity   | When raised                                              | Who fixes it           |
| ---------- | -------------------------------------------------------- | ---------------------- |
| `config`   | `defineSettings(...)` / `defineClientEnv(...)` call time | **Developer** (source) |
| `runtime`  | Loader called with a bad env at boot                     | **Operator** (env)     |
| `io`       | CLI / loader filesystem / parse failures                 | Operator or CI         |
| `usage`    | Library API called incorrectly                           | **Developer** (source) |

## Catalog

The table below is generated from `ERROR_CATALOG` in `src/errors.ts`.
Run `pnpm gen:errors-doc` after adding a new code; CI fails if the
section drifts.

<!-- BEGIN AUTO-GENERATED:CATALOG -->
### Configuration errors (raised at `defineSettings(...)` time)

Misconfiguration in the developer's source. Surfaces at module-load time so it can never reach production.

| Code | Anchor | Title |
| --- | --- | --- |
| `INVALID_ENV_SCHEMA` | <a id="invalid_env_schema"></a>[#invalid_env_schema](#invalid_env_schema) | envSchema is not a z.object |
| `MISSING_ENV_KEY` | <a id="missing_env_key"></a>[#missing_env_key](#missing_env_key) | envKey not found in envSchema |
| `INVALID_ENV_KEY_TYPE` | <a id="invalid_env_key_type"></a>[#invalid_env_key_type](#invalid_env_key_type) | envKey is not a string / enum |
| `INVALID_OVERRIDE_KEY` | <a id="invalid_override_key"></a>[#invalid_override_key](#invalid_override_key) | overrideEnvKey not found in envSchema |
| `PER_ENV_EMPTY` | <a id="per_env_empty"></a>[#per_env_empty](#per_env_empty) | perEnv has no branches |
| `PER_ENV_KEY_NOT_IN_ENUM` | <a id="per_env_key_not_in_enum"></a>[#per_env_key_not_in_enum](#per_env_key_not_in_enum) | perEnv branch not in envKey enum |
| `CLIENT_ENV_PREFIX_VIOLATION` | <a id="client_env_prefix_violation"></a>[#client_env_prefix_violation](#client_env_prefix_violation) | defineClientEnv schema key missing required prefix |

### Runtime errors (raised when the loader is called)

Bad env values at boot. The deployment environment must provide them; the developer's code is fine.

| Code | Anchor | Title |
| --- | --- | --- |
| `ENV_VALIDATION_FAILED` | <a id="env_validation_failed"></a>[#env_validation_failed](#env_validation_failed) | Zod env validation failed |
| `PER_ENV_BRANCH_MISSING` | <a id="per_env_branch_missing"></a>[#per_env_branch_missing](#per_env_branch_missing) | No perEnv branch matches the runtime envKey value |
| `PER_ENV_TODO` | <a id="per_env_todo"></a>[#per_env_todo](#per_env_todo) | Loaded perEnv branch still has unfilled todo() sentinels |
| `OVERRIDE_JSON_PARSE` | <a id="override_json_parse"></a>[#override_json_parse](#override_json_parse) | Override env var is not valid JSON |
| `CLIENT_ENV_UNDECLARED` | <a id="client_env_undeclared"></a>[#client_env_undeclared](#client_env_undeclared) | Prefixed key present at runtime but not declared in the client schema |
| `CLIENT_ENV_VALIDATION_FAILED` | <a id="client_env_validation_failed"></a>[#client_env_validation_failed](#client_env_validation_failed) | Zod validation of the client-side env failed |

### I/O errors (CLI and filesystem helpers)

Filesystem / parse failures from the CLI or `loadDotenv*`. The original error is preserved on `cause`.

| Code | Anchor | Title |
| --- | --- | --- |
| `CONFIG_NOT_FOUND` | <a id="config_not_found"></a>[#config_not_found](#config_not_found) | Settings config file not found |
| `CONFIG_LOAD_FAILED` | <a id="config_load_failed"></a>[#config_load_failed](#config_load_failed) | Settings config file failed to load |
| `CONFIG_INVALID_EXPORT` | <a id="config_invalid_export"></a>[#config_invalid_export](#config_invalid_export) | Settings config did not export a defineSettings(...) loader |
| `FILE_READ_FAILED` | <a id="file_read_failed"></a>[#file_read_failed](#file_read_failed) | Could not read a dotenv file or K8s manifest |
| `K8S_YAML_PARSE_FAILED` | <a id="k8s_yaml_parse_failed"></a>[#k8s_yaml_parse_failed](#k8s_yaml_parse_failed) | YAML input to `diff` did not parse |

### Usage errors (the API was called incorrectly)

The caller wired up `@env-kit/node-settings` in a way the library can't honour. Code-review-time bugs.

| Code | Anchor | Title |
| --- | --- | --- |
| `INVALID_EXTENDS_ITEM` | <a id="invalid_extends_item"></a>[#invalid_extends_item](#invalid_extends_item) | extends[i] is not a defineSettings(...) loader |
<!-- END AUTO-GENERATED:CATALOG -->
