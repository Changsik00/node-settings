# Error codes

Every error thrown by `@env-kit/node-settings` is a
`NodeSettingsError` carrying a stable `code` plus an optional `hint`.
Match on `.code`, never on `.message`, which can evolve across minor
versions.

```ts
import { NodeSettingsError } from "@env-kit/node-settings";

try {
  const cfg = settings(process.env);
} catch (err) {
  if (err instanceof NodeSettingsError) {
    switch (err.code) {
      case "ENV_VALIDATION_FAILED":
        console.error("missing env vars — see schema for required keys");
        break;
      case "PER_ENV_BRANCH_MISSING":
        console.error(`unknown APP_ENV value: ${err.message}`);
        break;
      default:
        console.error(err.message);
    }
  }
  process.exit(1);
}
```

## Codes

### Raised at `defineSettings(...)` time

These fire when the loader is *defined*, not when it's first called.
Misconfiguration fails fast — before the loader ever runs.

| Code                       | When                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `INVALID_ENV_SCHEMA`       | `envSchema` is not a `z.object({...})`.                       |
| `MISSING_ENV_KEY`          | `envKey` not in the (merged) schema.                          |
| `INVALID_ENV_KEY_TYPE`     | `envKey` is not `z.string()` / `z.enum(...)`.                 |
| `INVALID_OVERRIDE_KEY`     | `overrideEnvKey` not in the (merged) schema.                  |
| `PER_ENV_EMPTY`            | `perEnv` has no branches.                                     |
| `PER_ENV_KEY_NOT_IN_ENUM`  | `perEnv` branch is not a value of the `envKey` enum (typo).   |
| `INVALID_EXTENDS_ITEM`     | `extends[i]` is not a `defineSettings(...)` return value.     |

### Raised at load time

These fire when the loader is called with an env that doesn't satisfy
the schema, or when the runtime mode is unknown.

| Code                       | When                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `PER_ENV_BRANCH_MISSING`   | Runtime: no `perEnv` branch matches the parsed `envKey` value.|
| `PER_ENV_TODO`             | Loaded branch still contains unfilled `todo(...)` sentinels.  |
| `OVERRIDE_JSON_PARSE`      | `overrideEnvKey` env var is not valid JSON.                   |
| `ENV_VALIDATION_FAILED`    | Zod env validation failed at runtime.                         |

Zod errors at load time are wrapped as `ENV_VALIDATION_FAILED` with a
path-by-path summary and the original `ZodError` preserved as `.cause`.

### Raised by the CLI and helper loaders

These fire from the `node-settings` CLI or from filesystem-touching
helpers (`loadDotenvFile`, `loadDotenvCascade`, `parseK8sYaml`). They
surface as exit code 2 from CLI subcommands (caller-supplied input is
malformed) and as a thrown `NodeSettingsError` from library calls.

| Code                       | When                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `CONFIG_NOT_FOUND`         | CLI walked up from `cwd` and found no `node-settings.config.*` etc. |
| `CONFIG_LOAD_FAILED`       | Config file found but failed to import — syntax error or missing dep.|
| `CONFIG_INVALID_EXPORT`    | Config loaded but did not export a `defineSettings(...)` loader.    |
| `FILE_READ_FAILED`         | Dotenv file or K8s manifest could not be read (perms, ENOENT, etc.).|
| `K8S_YAML_PARSE_FAILED`    | YAML stream passed to `node-settings diff` did not parse.           |

### Client env (`defineClientEnv`)

| Code                            | When                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `CLIENT_ENV_PREFIX_VIOLATION`   | A schema key does not start with the declared `prefix`.       |
| `CLIENT_ENV_UNDECLARED`         | `strict: true` and runtime source has a prefixed key not in the schema. |
| `CLIENT_ENV_VALIDATION_FAILED`  | Zod validation of the client-side env failed.                 |
