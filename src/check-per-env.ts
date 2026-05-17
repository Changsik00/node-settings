import type { z } from "zod";
import type { SettingsLoader } from "./define-settings.js";
import { deepMerge, type DeepPartial } from "./utils/deep-merge.js";
import { isTodo } from "./todo.js";
import { DEFAULT_SECRET_PATTERNS } from "./introspect.js";

export interface PerEnvIssue {
  /** Which `perEnv` branch the issue belongs to (e.g. `"prod"`). */
  env: string;
  /** Dot-separated path inside the config object, or env key for env issues. */
  path: string;
  /** Severity of the issue. */
  severity: "error" | "warning";
  /** Human-readable message. */
  message: string;
  /** Internal kind, useful for filtering in custom reporters. */
  kind:
    | "placeholder"
    | "empty-string"
    | "missing-required-env"
    | "missing-branch"
    | "todo"
    | "secret-in-config";
}

export interface CheckPerEnvOptions {
  /**
   * Restrict the check to a subset of environments. Defaults to every key
   * in `perEnv`.
   */
  envs?: readonly string[];
  /**
   * Required environment variables that must be supplied by the runtime
   * (typically secrets that don't have schema defaults). The checker
   * reports them as `missing-required-env` for environments where they
   * aren't present in the supplied `envValues` map.
   *
   * Defaults to every required field in the env schema that has no
   * `.default(...)`.
   */
  requiredEnvKeys?: readonly string[];
  /**
   * Runtime env values per branch (e.g. from CI secrets or `.env.<env>`
   * files), used to satisfy `requiredEnvKeys`. Pass an empty map to flag
   * every required env key as missing.
   */
  envValues?: Record<string, Record<string, string | undefined>>;
  /**
   * Regexes that match placeholder values in the layered config (e.g.
   * `TODO`, `FIXME`, `REPLACE_ME`). Defaults cover common conventions.
   */
  placeholderPatterns?: readonly RegExp[];
  /**
   * When true, flag empty strings in the layered config as warnings.
   * Defaults to true.
   */
  flagEmptyStrings?: boolean;
  /**
   * Run the design-time lint pass that catches values placed in the
   * wrong layer (e.g. a secret-looking key inside `perEnv` where
   * operator env vars cannot override it). Defaults to true.
   */
  lint?: boolean;
  /**
   * Regexes matched against perEnv key paths during lint. A match
   * raises a `secret-in-config` warning suggesting the value belongs
   * in `envSchema`. Defaults to the same patterns the introspector
   * uses for secret detection.
   */
  secretKeyPatterns?: readonly RegExp[];
}

export interface PerEnvCompletenessReport {
  /** True iff there are no `severity: "error"` issues. */
  ok: boolean;
  /** Every issue discovered, in deterministic order. */
  issues: PerEnvIssue[];
  /** Convenience: issue count grouped by env. */
  countsByEnv: Record<string, { errors: number; warnings: number }>;
}

const DEFAULT_PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^TODO[-:_ ]/i,
  /^FIXME[-:_ ]/i,
  /^REPLACE[-:_ ]?ME/i,
  /^CHANGE[-:_ ]?ME/i,
  /^<.+>$/, // angle-bracket placeholders like <fill-me-in>
];

/**
 * Verify that every per-env branch of a settings loader is filled in
 * enough to actually run that environment. Use this as a CI gate
 * ("don't deploy if `perEnv.prod.bucket` is still `TODO-prod-bucket`").
 *
 * The check covers two classes of issues:
 *   1. **Config placeholders** — values in the layered `defaults + perEnv`
 *      output that match a placeholder pattern, or are empty strings.
 *   2. **Missing required env** — env vars required by the schema (no
 *      default, not `.optional()`) that aren't present in `envValues[env]`.
 */
export function checkPerEnvCompleteness<
  TSchema extends z.ZodObject<z.ZodRawShape>,
  TConfig extends object,
  TSettings extends object,
>(
  loader: SettingsLoader<TSchema, TConfig, TSettings>,
  options: CheckPerEnvOptions = {},
): PerEnvCompletenessReport {
  const { resolved } = loader;
  const allEnvs = Object.keys(resolved.perEnv);
  const targetEnvs = options.envs ?? allEnvs;

  const placeholders =
    options.placeholderPatterns ?? DEFAULT_PLACEHOLDER_PATTERNS;
  const flagEmptyStrings = options.flagEmptyStrings ?? true;
  const lintEnabled = options.lint ?? true;
  const secretKeyPatterns =
    options.secretKeyPatterns ?? DEFAULT_SECRET_PATTERNS;

  const requiredEnvKeys =
    options.requiredEnvKeys ??
    loader.envFields
      .filter((f) => f.required && f.defaultValue === undefined)
      .map((f) => f.key);

  const issues: PerEnvIssue[] = [];

  for (const env of targetEnvs) {
    const branch = resolved.perEnv[env];
    if (!branch) {
      issues.push({
        env,
        path: "(branch)",
        severity: "error",
        kind: "missing-branch",
        message: `perEnv branch '${env}' is not defined.`,
      });
      continue;
    }

    const layered = deepMerge(
      resolved.defaults as Record<string, unknown>,
      branch as DeepPartial<Record<string, unknown>>,
    );
    scanConfig(layered, "", env, placeholders, flagEmptyStrings, issues);

    if (lintEnabled) {
      lintSecretKeys(branch, "", env, secretKeyPatterns, issues);
    }

    const runtimeEnv = options.envValues?.[env] ?? {};
    for (const key of requiredEnvKeys) {
      const value = runtimeEnv[key];
      if (value === undefined || value === "") {
        issues.push({
          env,
          path: key,
          severity: "error",
          kind: "missing-required-env",
          message: `required env var '${key}' is not provided for '${env}'.`,
        });
      }
    }
  }

  const countsByEnv: Record<string, { errors: number; warnings: number }> = {};
  for (const env of targetEnvs) {
    countsByEnv[env] = { errors: 0, warnings: 0 };
  }
  for (const issue of issues) {
    const entry = countsByEnv[issue.env] ?? { errors: 0, warnings: 0 };
    if (issue.severity === "error") entry.errors += 1;
    else entry.warnings += 1;
    countsByEnv[issue.env] = entry;
  }

  return {
    ok: issues.every((i) => i.severity !== "error"),
    issues,
    countsByEnv,
  };
}

function scanConfig(
  value: unknown,
  path: string,
  env: string,
  placeholders: readonly RegExp[],
  flagEmptyStrings: boolean,
  issues: PerEnvIssue[],
): void {
  if (isTodo(value)) {
    issues.push({
      env,
      path: path || "(root)",
      severity: "error",
      kind: "todo",
      message: `unfilled todo() at '${path || "(root)"}': ${value.reason}`,
    });
    return;
  }
  if (typeof value === "string") {
    if (placeholders.some((p) => p.test(value))) {
      issues.push({
        env,
        path,
        severity: "error",
        kind: "placeholder",
        message: `placeholder value at '${path}': ${JSON.stringify(value)}`,
      });
    } else if (flagEmptyStrings && value === "") {
      issues.push({
        env,
        path,
        severity: "warning",
        kind: "empty-string",
        message: `empty string at '${path}'.`,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) =>
      scanConfig(
        item,
        `${path}[${idx}]`,
        env,
        placeholders,
        flagEmptyStrings,
        issues,
      ),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      scanConfig(child, childPath, env, placeholders, flagEmptyStrings, issues);
    }
  }
}

/**
 * Lint pass: surface keys inside `perEnv` whose names look like secrets.
 *
 * Why this matters: `perEnv` values are not overridable by operator env
 * vars at runtime — only `envSchema` fields are. If a secret-looking
 * key ends up in `perEnv`, the operator (CI / Vault / Secrets Manager)
 * has no way to inject its real value short of `CONFIG_OVERRIDE_JSON`
 * or a code change. Catching this at design time prevents the trap.
 *
 * Only paths *inside `perEnv`* are linted — `defaults` keys are also
 * project-controlled but the lint runs on each branch, which already
 * exercises the same key names if they appear in defaults.
 */
function lintSecretKeys(
  value: unknown,
  path: string,
  env: string,
  patterns: readonly RegExp[],
  issues: PerEnvIssue[],
): void {
  if (value === null || typeof value !== "object" || isTodo(value)) {
    if (path && patterns.some((p) => p.test(path))) {
      issues.push({
        env,
        path,
        severity: "warning",
        kind: "secret-in-config",
        message:
          `key '${path}' looks like a secret (matches a secret pattern) ` +
          `but lives in perEnv where operator env vars cannot override it. ` +
          `Move to envSchema so CI / Vault / Secrets Manager can inject this value.`,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) =>
      lintSecretKeys(item, `${path}[${idx}]`, env, patterns, issues),
    );
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    lintSecretKeys(child, childPath, env, patterns, issues);
  }
}
