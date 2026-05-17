/**
 * Catalog of every error this package can raise, with severity bucket,
 * human-readable title, and the anchor in `docs/ERRORS.md` that
 * documents it in long form.
 *
 * This is the **single source of truth** for error codes:
 *
 *   - {@link NodeSettingsErrorCode} is derived from its keys.
 *   - {@link NodeSettingsError.severity} and `.docsUrl` read from it
 *     at runtime.
 *   - `docs/ERRORS.md` is regenerated from it by
 *     `scripts/generate-errors-doc.mjs`.
 *   - `scripts/verify-errors.mjs` (part of `pnpm verify`) enforces
 *     that every entry has an actual `raise(...)` call somewhere in
 *     `src/` and a matching `<a id="...">` in the doc.
 *
 * Adding an error code: add an entry here and one `raise(...)` call
 * site — the rest follows.
 */
export const ERROR_CATALOG = {
  // -------- config: developer misconfigured defineSettings/defineClientEnv
  INVALID_ENV_SCHEMA: {
    severity: "config",
    title: "envSchema is not a z.object",
    docsAnchor: "invalid_env_schema",
  },
  MISSING_ENV_KEY: {
    severity: "config",
    title: "envKey not found in envSchema",
    docsAnchor: "missing_env_key",
  },
  INVALID_ENV_KEY_TYPE: {
    severity: "config",
    title: "envKey is not a string / enum",
    docsAnchor: "invalid_env_key_type",
  },
  INVALID_OVERRIDE_KEY: {
    severity: "config",
    title: "overrideEnvKey not found in envSchema",
    docsAnchor: "invalid_override_key",
  },
  PER_ENV_EMPTY: {
    severity: "config",
    title: "perEnv has no branches",
    docsAnchor: "per_env_empty",
  },
  PER_ENV_KEY_NOT_IN_ENUM: {
    severity: "config",
    title: "perEnv branch not in envKey enum",
    docsAnchor: "per_env_key_not_in_enum",
  },
  CLIENT_ENV_PREFIX_VIOLATION: {
    severity: "config",
    title: "defineClientEnv schema key missing required prefix",
    docsAnchor: "client_env_prefix_violation",
  },

  // -------- runtime: bad env at boot (operator / CI surface)
  ENV_VALIDATION_FAILED: {
    severity: "runtime",
    title: "Zod env validation failed",
    docsAnchor: "env_validation_failed",
  },
  PER_ENV_BRANCH_MISSING: {
    severity: "runtime",
    title: "No perEnv branch matches the runtime envKey value",
    docsAnchor: "per_env_branch_missing",
  },
  PER_ENV_TODO: {
    severity: "runtime",
    title: "Loaded perEnv branch still has unfilled todo() sentinels",
    docsAnchor: "per_env_todo",
  },
  OVERRIDE_JSON_PARSE: {
    severity: "runtime",
    title: "Override env var is not valid JSON",
    docsAnchor: "override_json_parse",
  },
  CLIENT_ENV_UNDECLARED: {
    severity: "runtime",
    title: "Prefixed key present at runtime but not declared in the client schema",
    docsAnchor: "client_env_undeclared",
  },
  CLIENT_ENV_VALIDATION_FAILED: {
    severity: "runtime",
    title: "Zod validation of the client-side env failed",
    docsAnchor: "client_env_validation_failed",
  },

  // -------- io: filesystem / parse failures from CLI and loaders
  CONFIG_NOT_FOUND: {
    severity: "io",
    title: "Settings config file not found",
    docsAnchor: "config_not_found",
  },
  CONFIG_LOAD_FAILED: {
    severity: "io",
    title: "Settings config file failed to load",
    docsAnchor: "config_load_failed",
  },
  CONFIG_INVALID_EXPORT: {
    severity: "io",
    title: "Settings config did not export a defineSettings(...) loader",
    docsAnchor: "config_invalid_export",
  },
  FILE_READ_FAILED: {
    severity: "io",
    title: "Could not read a dotenv file or K8s manifest",
    docsAnchor: "file_read_failed",
  },
  K8S_YAML_PARSE_FAILED: {
    severity: "io",
    title: "YAML input to `diff` did not parse",
    docsAnchor: "k8s_yaml_parse_failed",
  },

  // -------- usage: caller used the API incorrectly
  INVALID_EXTENDS_ITEM: {
    severity: "usage",
    title: "extends[i] is not a defineSettings(...) loader",
    docsAnchor: "invalid_extends_item",
  },
} as const;

/**
 * Stable error codes thrown by `@env-kit/node-settings`. Match on
 * `.code`, not `.message` — messages may evolve across minor versions.
 *
 * The union is derived from {@link ERROR_CATALOG}, so adding a code
 * there extends this type automatically.
 */
export type NodeSettingsErrorCode = keyof typeof ERROR_CATALOG;

/**
 * Buckets that classify *who* is responsible for fixing the error and
 * *when* it surfaces. Consumers wire these to alarms / log levels:
 *
 *   - `config`   misconfiguration in `defineSettings(...)` source —
 *                CI / build alarm; the developer must fix the code.
 *   - `runtime`  bad env values at boot — on-call alarm; the
 *                operator fixes the deploy environment.
 *   - `io`       file system / parse failures from CLI or loaders —
 *                operator or CI alarm depending on context.
 *   - `usage`    the caller used the public API incorrectly (rare; a
 *                code-review-time bug).
 */
export type ErrorSeverity = "config" | "runtime" | "io" | "usage";

/** Default base URL for `err.docsUrl`. Overridable via `reportError(err, { docsBase })`. */
export const DEFAULT_DOCS_BASE =
  "https://github.com/Changsik00/node-settings/blob/main/docs/ERRORS.md";

/**
 * Single error class for every problem this package can raise. Carries
 * a stable `code` plus an optional `hint` with a remediation tip.
 *
 * @example
 * ```ts
 * try {
 *   const cfg = settings(process.env);
 * } catch (err) {
 *   if (err instanceof NodeSettingsError && err.code === 'ENV_VALIDATION_FAILED') {
 *     console.error('Bad env:', err.message);
 *   } else {
 *     throw err;
 *   }
 * }
 * ```
 */
export class NodeSettingsError extends Error {
  readonly code: NodeSettingsErrorCode;
  readonly hint: string | undefined;
  /** Original error if this wraps another (e.g. a zod ZodError). */
  readonly cause?: unknown;

  constructor(
    code: NodeSettingsErrorCode,
    message: string,
    options?: { hint?: string; cause?: unknown },
  ) {
    const fullMessage = options?.hint
      ? `${message}\n  hint: ${options.hint}`
      : message;
    super(fullMessage);
    this.name = "NodeSettingsError";
    this.code = code;
    this.hint = options?.hint;
    if (options && "cause" in options) this.cause = options.cause;
  }

  /** Severity bucket from {@link ERROR_CATALOG}. */
  get severity(): ErrorSeverity {
    return ERROR_CATALOG[this.code].severity;
  }

  /** Short human title for dashboards and log subjects. */
  get title(): string {
    return ERROR_CATALOG[this.code].title;
  }

  /** Direct link to the long-form doc entry for this code. */
  get docsUrl(): string {
    return `${DEFAULT_DOCS_BASE}#${ERROR_CATALOG[this.code].docsAnchor}`;
  }
}

/**
 * Throw a {@link NodeSettingsError}. Returns `never` so call sites
 * don't need an unreachable `throw` and TypeScript can narrow types
 * after the call.
 *
 * @example
 * ```ts
 * if (!(key in shape)) {
 *   raise("MISSING_ENV_KEY", `envKey '${key}' is not defined.`, {
 *     hint: `Known: ${keys.join(", ")}`,
 *   });
 * }
 * ```
 */
export function raise(
  code: NodeSettingsErrorCode,
  message: string,
  options?: { hint?: string; cause?: unknown },
): never {
  throw new NodeSettingsError(code, message, options);
}
