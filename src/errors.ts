/**
 * Stable error codes thrown by `@env-kit/node-settings`. Use these
 * for programmatic handling rather than matching on `message`, which
 * may evolve across minor versions.
 */
export type NodeSettingsErrorCode =
  /** `envSchema` is not a `z.object({...})`. */
  | "INVALID_ENV_SCHEMA"
  /** `envKey` does not exist in the (merged) envSchema. */
  | "MISSING_ENV_KEY"
  /** `envKey` exists but does not resolve to a string / enum field. */
  | "INVALID_ENV_KEY_TYPE"
  /** `overrideEnvKey` does not exist in the (merged) envSchema. */
  | "INVALID_OVERRIDE_KEY"
  /** A `perEnv` branch key is not one of the `envKey` enum's values. */
  | "PER_ENV_KEY_NOT_IN_ENUM"
  /** `perEnv` has no branches at all. */
  | "PER_ENV_EMPTY"
  /** At runtime, the resolved `envKey` value has no matching `perEnv` branch. */
  | "PER_ENV_BRANCH_MISSING"
  /** The loaded perEnv branch still contains unfilled `todo(...)` sentinels. */
  | "PER_ENV_TODO"
  /** An item in `extends` is not a `defineSettings(...)` loader. */
  | "INVALID_EXTENDS_ITEM"
  /** The `overrideEnvKey` env var is not parseable JSON. */
  | "OVERRIDE_JSON_PARSE"
  /** Zod env validation failed at runtime. */
  | "ENV_VALIDATION_FAILED"
  /**
   * `defineClientEnv` was given a schema key that does not start with the
   * declared `prefix`. The whole point of the helper is to keep
   * server-only secrets out of the client bundle, so this is fatal —
   * either rename the key, or move it to the server-side `defineSettings()`.
   */
  | "CLIENT_ENV_PREFIX_VIOLATION"
  /**
   * `strict: true` was set on `defineClientEnv` and the runtime source
   * contained a key starting with `prefix` that is NOT declared in the
   * client schema. Catches typos and forgotten-to-declare drift.
   */
  | "CLIENT_ENV_UNDECLARED"
  /** Zod validation of the client-side env failed. */
  | "CLIENT_ENV_VALIDATION_FAILED";

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
