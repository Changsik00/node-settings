import type { z } from "zod";
import { raise } from "./errors.js";

/**
 * Assert that a value has the runtime shape of a `SettingsLoader`
 * (callable, with the `resolved` / `envFields` / `opts` metadata
 * attached). Used both eagerly inside `defineSettings` (before merging
 * parent schemas) and from {@link validateDefineSettingsOptions}.
 */
export function assertSettingsLoaderShape(
  parent: unknown,
  idx: number,
): void {
  const obj = parent as Record<string, unknown> | null;
  if (
    typeof parent !== "function" ||
    obj === null ||
    !("resolved" in obj) ||
    !("envFields" in obj) ||
    !("opts" in obj)
  ) {
    raise(
      "INVALID_EXTENDS_ITEM",
      `extends[${idx}] is not a valid SettingsLoader.`,
      {
        hint: "Every extends[] entry must be the return value of defineSettings(...).",
      },
    );
  }
}

interface ZodDefSnapshot {
  typeName?: string;
}

/**
 * Strip `ZodOptional` / `ZodDefault` / `ZodNullable` layers and return
 * the innermost schema's typeName plus the unwrapped schema. Bounded
 * loop guards against cyclic wrappers.
 */
function unwrapWrappers(schema: z.ZodTypeAny): {
  typeName: string;
  inner: z.ZodTypeAny;
} {
  let inner = schema;
  for (let i = 0; i < 16; i += 1) {
    const typeName = (inner._def as ZodDefSnapshot).typeName;
    if (typeName === "ZodOptional") {
      inner = (inner as z.ZodOptional<z.ZodTypeAny>).unwrap();
    } else if (typeName === "ZodDefault") {
      inner = (inner as z.ZodDefault<z.ZodTypeAny>).removeDefault();
    } else if (typeName === "ZodNullable") {
      inner = (inner as z.ZodNullable<z.ZodTypeAny>).unwrap();
    } else {
      return { typeName: typeName ?? "unknown", inner };
    }
  }
  return { typeName: "unknown", inner };
}

interface ValidatedOptionsInput {
  ownEnvSchema: z.ZodTypeAny;
  resolvedEnvSchema: z.ZodObject<z.ZodRawShape>;
  envKey: string;
  overrideEnvKey: string | undefined;
  resolvedPerEnv: Record<string, unknown>;
  extendsList: ReadonlyArray<unknown>;
}

/**
 * Run all definition-time validations. Throws {@link NodeSettingsError}
 * with a stable `code` on the first problem. Catching problems here —
 * instead of waiting for the first `loader(env)` call — gives clearer
 * stack traces and prevents misconfiguration from shipping to prod.
 */
export function validateDefineSettingsOptions(
  input: ValidatedOptionsInput,
): void {
  const ownTypeName = (input.ownEnvSchema._def as ZodDefSnapshot).typeName;
  if (ownTypeName !== "ZodObject") {
    raise(
      "INVALID_ENV_SCHEMA",
      `envSchema must be a z.object({...}). Got ${ownTypeName ?? "unknown"}.`,
      {
        hint: "Refinements / transforms on the outer schema break introspection. Apply them at the field level instead.",
      },
    );
  }

  const shape = input.resolvedEnvSchema.shape;
  const knownKeys = Object.keys(shape);
  if (!(input.envKey in shape)) {
    raise(
      "MISSING_ENV_KEY",
      `envKey '${input.envKey}' is not defined in the envSchema.`,
      { hint: `Known keys: ${knownKeys.join(", ") || "(none)"}.` },
    );
  }

  const envKeyField = shape[input.envKey] as z.ZodTypeAny;
  const { typeName: envKeyType, inner: envKeyInner } = unwrapWrappers(envKeyField);
  if (
    envKeyType !== "ZodString" &&
    envKeyType !== "ZodEnum" &&
    envKeyType !== "ZodNativeEnum"
  ) {
    raise(
      "INVALID_ENV_KEY_TYPE",
      `envKey '${input.envKey}' must resolve to z.string() or z.enum(...) (got ${envKeyType}).`,
      {
        hint: "perEnv looks up branches by envKey's value, so it must be a discrete string.",
      },
    );
  }

  const branchKeys = Object.keys(input.resolvedPerEnv);
  if (branchKeys.length === 0) {
    raise(
      "PER_ENV_EMPTY",
      "perEnv must define at least one environment branch.",
      {
        hint: "Add a branch for every value envKey can take, e.g. perEnv: { local: {...}, prod: {...} }.",
      },
    );
  }

  // perEnv keys must be a subset of the enum values, not the full set:
  // missing branches are caught at runtime, and `node-settings check`
  // is the dedicated place to enforce completeness.
  const allowedEnumValues = enumValuesOf(envKeyType, envKeyInner);
  if (allowedEnumValues) {
    for (const key of branchKeys) {
      if (!allowedEnumValues.includes(key)) {
        const label = envKeyType === "ZodNativeEnum" ? "native enum" : "enum";
        raise(
          "PER_ENV_KEY_NOT_IN_ENUM",
          `perEnv has branch '${key}', but envKey '${input.envKey}' ${label} only allows: ${allowedEnumValues.join(", ")}.`,
          {
            hint: `Either add '${key}' to the enum or remove the perEnv branch (likely a typo).`,
          },
        );
      }
    }
  }

  if (input.overrideEnvKey !== undefined && !(input.overrideEnvKey in shape)) {
    raise(
      "INVALID_OVERRIDE_KEY",
      `overrideEnvKey '${input.overrideEnvKey}' is not defined in the envSchema.`,
      { hint: `Known keys: ${knownKeys.join(", ") || "(none)"}.` },
    );
  }

  // Eager extends validation: defineSettings's merge step reaches into
  // `.resolved`, so catching bad inputs here produces a clearer error
  // than the "Cannot read 'resolved'" we'd otherwise get.
  input.extendsList.forEach(assertSettingsLoaderShape);
}

/**
 * Return the allowed string values for an enum-shaped zod type, or
 * `undefined` when the type isn't an enum at all (so callers can
 * short-circuit). Hides the ZodEnum / ZodNativeEnum branching.
 */
function enumValuesOf(
  typeName: string,
  inner: z.ZodTypeAny,
): readonly string[] | undefined {
  if (typeName === "ZodEnum") {
    return (inner as z.ZodEnum<[string, ...string[]]>).options;
  }
  if (typeName === "ZodNativeEnum") {
    const values = Object.values(
      (inner._def as { values?: Record<string, string | number> }).values ?? {},
    ).filter((v): v is string => typeof v === "string");
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}
