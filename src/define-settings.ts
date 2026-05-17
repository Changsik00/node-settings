import { z } from "zod";
import { deepMerge, type DeepPartial } from "./utils/deep-merge.js";
import { mergePerEnv } from "./utils/merge-per-env.js";
import {
  introspectEnvSchema,
  type EnvField,
  type IntrospectOptions,
} from "./introspect.js";
import { raise } from "./errors.js";
import { formatZodIssues } from "./utils/zod-issues.js";
import {
  validateDefineSettingsOptions,
  assertSettingsLoaderShape,
} from "./validate-options.js";
import { findTodos } from "./todo.js";

/**
 * A {@link SettingsLoader} whose generics are erased to broad bounds,
 * suitable for the `extends` array.
 */
export type AnySettingsLoader = SettingsLoader<
  z.ZodObject<z.ZodRawShape>,
  object,
  object
>;

type UnionToIntersection<U> = (
  U extends unknown ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never;

type ExtractEnv<L> = L extends SettingsLoader<infer S, object, object>
  ? z.infer<S>
  : never;
type ExtractConfig<L> = L extends SettingsLoader<
  z.ZodObject<z.ZodRawShape>,
  infer C,
  object
>
  ? C
  : never;

/**
 * Type-level merge of every parent loader's env type with the child's
 * own env type. Falls back to the child's env type alone when the
 * extends list is empty.
 */
export type MergedEnv<
  TExtends extends readonly AnySettingsLoader[],
  TSelfEnv,
> = TExtends extends readonly []
  ? TSelfEnv
  : UnionToIntersection<ExtractEnv<TExtends[number]>> & TSelfEnv;

/**
 * Type-level merge of every parent loader's config type with the
 * child's own config type. Mirrors the runtime `deepMerge` semantics.
 */
export type MergedConfig<
  TExtends extends readonly AnySettingsLoader[],
  TSelfConfig,
> = TExtends extends readonly []
  ? TSelfConfig
  : UnionToIntersection<ExtractConfig<TExtends[number]>> & TSelfConfig;

/**
 * Options for {@link defineSettings}.
 *
 * @typeParam TSchema   - The zod env schema (must be a `z.object({...})`).
 * @typeParam TConfig   - Shape of the layered, non-env "config" object.
 * @typeParam TSettings - Final settings shape returned by `build`.
 * @typeParam TExtends  - Tuple of parent loaders this one extends.
 */
export interface DefineSettingsOptions<
  TSchema extends z.ZodObject<z.ZodRawShape>,
  TConfig extends object,
  TSettings extends object,
  TExtends extends readonly AnySettingsLoader[] = readonly [],
> {
  /**
   * Parent loaders whose env schema, defaults, and perEnv are inherited.
   * The merge order is `extends[0]`, `extends[1]`, ..., then this loader's
   * own values on top — later layers win on key collisions.
   *
   * Modeled after `t3-oss/env`'s `extends` field. Use for monorepo
   * composition where multiple packages share a common base.
   */
  extends?: TExtends;
  /** Zod schema that validates `process.env`. Must be a `z.object({...})`. */
  envSchema: TSchema;
  /**
   * The env key whose value selects the `perEnv` branch to apply.
   * Typical choice: `'APP_ENV'` or `'NODE_ENV'`. May reference a key
   * supplied by a parent in `extends`.
   */
  envKey: keyof MergedEnv<TExtends, z.infer<TSchema>> & string;
  /**
   * Optional env key that, when set, contains a JSON-encoded partial
   * config used as the highest-priority override layer.
   */
  overrideEnvKey?: keyof MergedEnv<TExtends, z.infer<TSchema>> & string;
  /** Defaults applied first (layer A). */
  defaults: TConfig;
  /** Per-env overrides keyed by the value of `envKey` (layer B). */
  perEnv: Record<string, DeepPartial<NoInfer<TConfig>>>;
  /**
   * Optional validator for the JSON override layer.
   */
  validateOverride?: (
    parsed: unknown,
  ) => DeepPartial<NoInfer<MergedConfig<TExtends, TConfig>>>;
  /**
   * Map the validated env and the final layered config into the public
   * settings object that the application consumes. With `extends`, the
   * `env` and `config` parameters contain the merged shape (parent +
   * child).
   */
  build: (
    env: MergedEnv<TExtends, z.infer<TSchema>>,
    config: NoInfer<MergedConfig<TExtends, TConfig>>,
  ) => TSettings;
  /**
   * Called once when a JSON override is applied. Useful for emitting an
   * operational audit log without giving this package a logger dep.
   */
  onOverride?: (
    overrides: DeepPartial<NoInfer<MergedConfig<TExtends, TConfig>>>,
    envValue: string,
  ) => void;
  /**
   * Customise which fields are flagged as secrets. See
   * {@link IntrospectOptions} for the defaults.
   */
  secretPatterns?: IntrospectOptions["secretPatterns"];
}

/**
 * Resolved view of a loader's effective options after merging any
 * `extends` parents. Generators and the CLI's check command read these
 * values rather than the user-supplied `opts`.
 */
export interface ResolvedSettings {
  /** Merged zod schema (parent schemas combined via `.merge(...)`). */
  envSchema: z.ZodObject<z.ZodRawShape>;
  /** The selected env key (child wins if both parent and child set it). */
  envKey: string;
  /** Optional override env key. */
  overrideEnvKey: string | undefined;
  /** Merged defaults across the extends chain. */
  defaults: Record<string, unknown>;
  /** Merged per-env overrides across the extends chain. */
  perEnv: Record<string, Record<string, unknown>>;
}

/**
 * A settings loader function with tooling metadata attached.
 */
export interface SettingsLoader<
  TSchema extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
  TConfig extends object = object,
  TSettings extends object = object,
> {
  (rawEnv: Record<string, string | undefined>): TSettings;
  /** The options this loader was defined with (not the merged values). */
  readonly opts: Readonly<DefineSettingsOptions<TSchema, TConfig, TSettings>>;
  /** Introspected env fields for the *resolved* schema (parents + self). */
  readonly envFields: readonly EnvField[];
  /** The effective merged schema / defaults / perEnv used at runtime. */
  readonly resolved: Readonly<ResolvedSettings>;
}

/**
 * Define a settings loader.
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { defineSettings } from '@env-kit/node-settings';
 *
 * export const settings = defineSettings({
 *   envSchema: z.object({
 *     APP_ENV: z.enum(['local', 'dev', 'prod']).default('local'),
 *     DB_HOST: z.string(),
 *   }),
 *   envKey: 'APP_ENV',
 *   defaults: { bucket: '' },
 *   perEnv: {
 *     local: { bucket: 'local-bucket' },
 *     dev:   { bucket: 'dev-bucket' },
 *     prod:  { bucket: 'prod-bucket' },
 *   },
 *   build: (env, config) => ({
 *     dbHost: env.DB_HOST,
 *     bucket: config.bucket,
 *   }),
 * });
 * ```
 *
 * @example Monorepo composition with `extends`:
 * ```ts
 * // packages/shared/settings.base.ts
 * export const base = defineSettings({
 *   envSchema: z.object({ DB_HOST: z.string(), APP_ENV: z.enum(['local','prod']).default('local') }),
 *   envKey: 'APP_ENV',
 *   defaults: { region: 'us-east-1', logLevel: 'info' },
 *   perEnv: { local: { logLevel: 'debug' }, prod: {} },
 *   build: (env, config) => ({ dbHost: env.DB_HOST, ...config }),
 * });
 *
 * // packages/content-api/settings.config.ts
 * export default defineSettings({
 *   extends: [base],
 *   envSchema: z.object({ CONTENT_BUCKET: z.string() }),
 *   envKey: 'APP_ENV',
 *   defaults: { bucket: '' },
 *   perEnv: {
 *     local: { bucket: 'local-content' },
 *     prod:  { bucket: 'prod-content' },
 *   },
 *   build: (env, config) => ({
 *     contentBucket: env.CONTENT_BUCKET,
 *     dbHost: env.DB_HOST,        // inherited from base
 *     bucket: config.bucket,
 *     region: config.region,       // inherited from base
 *   }),
 * });
 * ```
 */
export function defineSettings<
  TSchema extends z.ZodObject<z.ZodRawShape>,
  TConfig extends object,
  TSettings extends object,
  const TExtends extends readonly AnySettingsLoader[] = readonly [],
>(
  opts: DefineSettingsOptions<TSchema, TConfig, TSettings, TExtends>,
): SettingsLoader<TSchema, TConfig, TSettings> {
  const extendsList = (opts.extends ?? []) as readonly AnySettingsLoader[];

  // Validate extends first so that downstream resolve* don't blow up on
  // garbage values with a less-helpful runtime error.
  if (extendsList.length > 0) {
    validateExtendsList(extendsList);
  }

  const resolvedSchema = resolveEnvSchema(extendsList, opts.envSchema);
  const resolvedDefaults = resolveDefaults(
    extendsList,
    opts.defaults as Record<string, unknown>,
  );
  const resolvedPerEnv = resolvePerEnv(
    extendsList,
    opts.perEnv as Record<string, Record<string, unknown>>,
  );
  const resolvedOverrideEnvKey =
    opts.overrideEnvKey ?? findInheritedOverrideEnvKey(extendsList);

  validateDefineSettingsOptions({
    ownEnvSchema: opts.envSchema,
    resolvedEnvSchema: resolvedSchema,
    envKey: opts.envKey as string,
    overrideEnvKey: opts.overrideEnvKey as string | undefined,
    resolvedPerEnv: resolvedPerEnv,
    extendsList: extendsList,
  });

  const resolved: ResolvedSettings = Object.freeze({
    envSchema: resolvedSchema,
    envKey: opts.envKey as string,
    overrideEnvKey: resolvedOverrideEnvKey,
    defaults: Object.freeze(resolvedDefaults),
    perEnv: Object.freeze(resolvedPerEnv),
  });

  const envFields = Object.freeze(
    introspectEnvSchema(resolvedSchema, {
      ...(opts.secretPatterns
        ? { secretPatterns: opts.secretPatterns }
        : {}),
    }),
  );
  const frozenOpts = Object.freeze({ ...opts });

  const load = ((rawEnv: Record<string, string | undefined>) => {
    let env: Record<string, unknown>;
    try {
      env = resolvedSchema.parse(rawEnv) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof z.ZodError) {
        raise(
          "ENV_VALIDATION_FAILED",
          `env validation failed:\n${formatZodIssues(err)}`,
          {
            hint: "Check that every required env var is set and matches the schema.",
            cause: err,
          },
        );
      }
      throw err;
    }

    const envValue = env[resolved.envKey];
    if (typeof envValue !== "string") {
      raise(
        "INVALID_ENV_KEY_TYPE",
        `env['${resolved.envKey}'] is not a string at runtime (got ${typeof envValue}).`,
        {
          hint: "The schema for envKey must produce a string. Check for transforms that change its type.",
        },
      );
    }
    const envSpecific = resolvedPerEnv[envValue];
    if (!envSpecific) {
      const keys = Object.keys(resolvedPerEnv).join(", ");
      raise(
        "PER_ENV_BRANCH_MISSING",
        `perEnv has no branch for '${envValue}'. Known branches: ${keys}`,
        {
          hint: `Add perEnv['${envValue}'] = {...} or fix the value of env['${resolved.envKey}'].`,
        },
      );
    }

    const baseConfig = deepMerge(
      resolvedDefaults as Record<string, unknown>,
      envSpecific as DeepPartial<Record<string, unknown>>,
    );

    const overrides = resolvedOverrideEnvKey
      ? parseJsonOverride(
          env[resolvedOverrideEnvKey],
          opts.validateOverride as
            | ((p: unknown) => DeepPartial<Record<string, unknown>>)
            | undefined,
        )
      : undefined;
    const finalConfig = overrides
      ? deepMerge(baseConfig, overrides)
      : baseConfig;

    if (overrides && opts.onOverride) {
      opts.onOverride(
        overrides as DeepPartial<NoInfer<MergedConfig<TExtends, TConfig>>>,
        envValue,
      );
    }

    // Catch unfilled todo() sentinels before they reach build().
    // We only check the branch that's actually being loaded — sentinels
    // in OTHER perEnv branches are intentional placeholders that the
    // `node-settings check` CLI is responsible for surfacing.
    const todos = findTodos(finalConfig);
    if (todos.length > 0) {
      const list = todos
        .map((t) => `  - ${t.path}: ${t.reason}`)
        .join("\n");
      raise(
        "PER_ENV_TODO",
        `unfilled todo() value(s) for ${resolved.envKey}=${envValue}:\n${list}`,
        {
          hint:
            `Provide a value in perEnv['${envValue}'] (or defaults) for the listed paths. ` +
            `Note: setting process.env does NOT fill perEnv slots — if these values come from CI/infra at deploy time, ` +
            `move them to envSchema (so zod enforces them as required env vars) or override via the JSON override env var.`,
        },
      );
    }

    return Object.freeze(
      opts.build(
        env as MergedEnv<TExtends, z.infer<TSchema>>,
        finalConfig as NoInfer<MergedConfig<TExtends, TConfig>>,
      ),
    );
  }) as SettingsLoader<TSchema, TConfig, TSettings>;

  Object.defineProperty(load, "opts", {
    value: frozenOpts,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  Object.defineProperty(load, "envFields", {
    value: envFields,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  Object.defineProperty(load, "resolved", {
    value: resolved,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  return load;
}

function validateExtendsList(
  extendsList: readonly unknown[],
): asserts extendsList is readonly AnySettingsLoader[] {
  extendsList.forEach(assertSettingsLoaderShape);
}

function resolveEnvSchema(
  extendsList: readonly AnySettingsLoader[],
  ownSchema: z.ZodObject<z.ZodRawShape>,
): z.ZodObject<z.ZodRawShape> {
  let result: z.ZodObject<z.ZodRawShape> = z.object({});
  for (const parent of extendsList) {
    result = result.merge(parent.resolved.envSchema);
  }
  return result.merge(ownSchema);
}

function resolveDefaults(
  extendsList: readonly AnySettingsLoader[],
  own: Record<string, unknown>,
): Record<string, unknown> {
  let result: Record<string, unknown> = {};
  for (const parent of extendsList) {
    result = deepMerge(result, parent.resolved.defaults);
  }
  return deepMerge(result, own);
}

function resolvePerEnv(
  extendsList: readonly AnySettingsLoader[],
  own: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const sources: Array<Record<string, Record<string, unknown>>> = [];
  for (const parent of extendsList) sources.push(parent.resolved.perEnv);
  sources.push(own);
  if (sources.length === 0) return {};
  const [first, ...rest] = sources;
  return mergePerEnv(
    first as Record<string, Record<string, unknown>>,
    ...(rest as Array<Record<string, Record<string, unknown>>>),
  ) as Record<string, Record<string, unknown>>;
}

function findInheritedOverrideEnvKey(
  extendsList: readonly AnySettingsLoader[],
): string | undefined {
  for (let i = extendsList.length - 1; i >= 0; i -= 1) {
    const parent = extendsList[i];
    if (parent && parent.resolved.overrideEnvKey) {
      return parent.resolved.overrideEnvKey;
    }
  }
  return undefined;
}

function parseJsonOverride(
  raw: unknown,
  validate?: (parsed: unknown) => DeepPartial<Record<string, unknown>>,
): DeepPartial<Record<string, unknown>> | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    raise(
      "OVERRIDE_JSON_PARSE",
      `override JSON parse failed: ${(err as Error).message}`,
      {
        hint: "Set the override env var to a valid JSON object string, e.g. '{\"bucket\":\"x\"}'.",
        cause: err,
      },
    );
  }
  return validate
    ? validate(parsed)
    : (parsed as DeepPartial<Record<string, unknown>>);
}
