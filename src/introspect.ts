import { z } from "zod";

/**
 * Field metadata extracted from a zod env schema. Used by the generators
 * (`.env.example`, Markdown docs, Kubernetes manifests) and the CLI.
 */
export interface EnvField {
  /** The env variable name. */
  key: string;
  /** Coarse-grained primitive type. */
  type: "string" | "number" | "boolean" | "enum" | "unknown";
  /** False when the schema is `.optional()`, `.default(...)`, or `.nullable()`. */
  required: boolean;
  /** Value supplied via `.default(...)`, if any. */
  defaultValue?: unknown;
  /** Allowed values for an enum field. */
  enumValues?: readonly string[];
  /** `.describe(...)` text, with the `@secret` / `@public` tags stripped. */
  description?: string;
  /**
   * True when this field looks like a secret. Determined by:
   *   - An explicit `@secret` tag in the description, or
   *   - A name pattern match (PASSWORD / TOKEN / SECRET / API_KEY / ...).
   *
   * Override by tagging the description with `@public`, or by passing a
   * custom `secretPatterns` array to {@link introspectEnvSchema}.
   */
  secret: boolean;
}

export interface IntrospectOptions {
  /**
   * Regular expressions matched against the env var name. Any match marks
   * the field as a secret unless its description contains `@public`.
   * Defaults to a sensible set covering common secret naming conventions.
   */
  secretPatterns?: RegExp[];
}

/**
 * Patterns that flag a name as secret-looking. Used in two places:
 *
 *   1. {@link introspectEnvSchema} — to auto-tag env vars as secrets
 *      for the K8s Secret manifest generator and `.env.example` masking.
 *   2. The `secret-in-config` lint in {@link checkPerEnvCompleteness}
 *      — to warn when a key lives in `perEnv` (project-controlled)
 *      where operator env vars cannot override it.
 *
 * Patterns use an optional `_?` between words so they match both the
 * SCREAMING_SNAKE convention used for env vars (`PRIVATE_KEY`, `API_KEY`)
 * and the camelCase convention used for config keys (`privateKey`,
 * `apiKey`, `stripeApiKey`).
 */
export const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  /PASSWORD/i,
  /SECRET/i,
  /TOKEN/i,
  /PRIVATE_?KEY/i,
  /API_?KEY/i,
  /ACCESS_?KEY/i,
  /CREDENTIAL/i,
  /PASSPHRASE/i,
  /DSN/i,
];

/**
 * Walk a `z.object({...})` schema and produce {@link EnvField} metadata
 * for every top-level key. Optional / default / nullable wrappers are
 * unwrapped to find the inner primitive.
 *
 * The schema must be a {@link z.ZodObject}. Refinements, transforms,
 * intersections, etc. on the *outer* schema are not introspected; wrap
 * those at the field level instead.
 */
export function introspectEnvSchema(
  schema: z.ZodObject<z.ZodRawShape>,
  options?: IntrospectOptions,
): EnvField[] {
  const patterns = options?.secretPatterns ?? DEFAULT_SECRET_PATTERNS;
  const shape = schema.shape;
  return Object.entries(shape).map(([key, def]) =>
    introspectField(key, def as z.ZodTypeAny, patterns),
  );
}

interface ZodInnerDef {
  type?: string;
  // zod 3 stored defaults as `() => unknown`; zod 4 stores them as direct values.
  defaultValue?: unknown | (() => unknown);
  values?: Record<string, string | number>;
  schema?: z.ZodTypeAny;
  in?: z.ZodTypeAny;
}

function introspectField(
  key: string,
  schema: z.ZodTypeAny,
  patterns: readonly RegExp[],
): EnvField {
  let required = true;
  let defaultValue: unknown = undefined;
  let inner: z.ZodTypeAny = schema;
  let description: string | undefined = inner.description;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (description === undefined) description = inner.description;
    const def = inner._def as ZodInnerDef;
    const typeName = def.type;
    if (typeName === "optional") {
      required = false;
      inner = (inner as z.ZodOptional<z.ZodTypeAny>).unwrap();
    } else if (typeName === "default") {
      required = false;
      // zod 4 stores direct value; zod 3 stored a factory function. Support both.
      if (typeof def.defaultValue === "function") {
        defaultValue = (def.defaultValue as () => unknown)();
      } else if (def.defaultValue !== undefined) {
        defaultValue = def.defaultValue;
      }
      inner = (inner as z.ZodDefault<z.ZodTypeAny>).removeDefault();
    } else if (typeName === "nullable") {
      required = false;
      inner = (inner as z.ZodNullable<z.ZodTypeAny>).unwrap();
    } else if (typeName === "pipe") {
      // zod 4: transform() and pipe() both produce ZodPipe with `in` / `out`.
      // Follow the input side to expose the upstream schema.
      const sourceType = def.in;
      if (sourceType) inner = sourceType;
      else break;
    } else {
      break;
    }
  }

  const { type, enumValues } = primitiveTypeOf(inner);

  const tag = parseSecretTag(description);
  const matchedByName = patterns.some((p) => p.test(key));
  const secret =
    tag === "secret" ? true : tag === "public" ? false : matchedByName;
  const cleanedDescription = stripTags(description);

  const field: EnvField = {
    key,
    type,
    required,
    secret,
  };
  if (defaultValue !== undefined) field.defaultValue = defaultValue;
  if (enumValues) field.enumValues = enumValues;
  if (cleanedDescription) field.description = cleanedDescription;
  return field;
}

interface PrimitiveTypeInfo {
  type: EnvField["type"];
  enumValues?: readonly string[];
}

/**
 * Map a fully-unwrapped zod schema to its primitive {@link EnvField} type.
 * Unknown shapes (objects, arrays, unions, ...) collapse to `"unknown"`;
 * callers can refine downstream.
 */
// zod 4: lower-case `_def.type` discriminator (was `_def.typeName` in zod 3).
// ZodEnum and ZodNativeEnum are unified under "enum" — both expose `.options`
// (zod 4 normalizes native enums into the same option list).
const PRIMITIVE_TYPE_RESOLVERS: Record<
  string,
  (inner: z.ZodTypeAny, def: ZodInnerDef) => PrimitiveTypeInfo
> = {
  string: () => ({ type: "string" }),
  number: () => ({ type: "number" }),
  boolean: () => ({ type: "boolean" }),
  enum: (inner) => {
    const enumLike = inner as { options?: readonly unknown[] };
    if (!enumLike.options) return { type: "unknown" };
    const values = enumLike.options.filter(
      (v): v is string => typeof v === "string",
    );
    return values.length > 0
      ? { type: "enum", enumValues: values }
      : { type: "unknown" };
  },
};

function primitiveTypeOf(inner: z.ZodTypeAny): PrimitiveTypeInfo {
  const def = inner._def as ZodInnerDef;
  const resolve = def.type ? PRIMITIVE_TYPE_RESOLVERS[def.type] : undefined;
  return resolve ? resolve(inner, def) : { type: "unknown" };
}

function parseSecretTag(
  description: string | undefined,
): "secret" | "public" | undefined {
  if (!description) return undefined;
  if (/@secret\b/i.test(description)) return "secret";
  if (/@public\b/i.test(description)) return "public";
  return undefined;
}

function stripTags(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const cleaned = description.replace(/@(secret|public)\b/gi, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}
