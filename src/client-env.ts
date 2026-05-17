import { z } from "zod";
import { raise } from "./errors.js";
import { formatZodIssues } from "./utils/zod-issues.js";

export interface DefineClientEnvOptions<
  TSchema extends z.ZodObject<z.ZodRawShape>,
> {
  /**
   * zod schema describing the public, browser-bundled env vars.
   * Every key MUST start with `prefix` — enforced at definition time
   * so the mistake is caught long before a secret reaches the bundle.
   */
  schema: TSchema;
  /**
   * Required prefix for every key in the schema. Conventional values:
   *   - `"NEXT_PUBLIC_"` (Next.js)
   *   - `"VITE_"`        (Vite)
   *   - `"PUBLIC_"`      (Astro, SvelteKit, etc.)
   *
   * Pick the prefix your build tool already enforces; the helper is a
   * second line of defence so a misnamed key fails fast instead of
   * being silently dropped at build time.
   */
  prefix: string;
  /**
   * When `true`, throw `CLIENT_ENV_UNDECLARED` if the runtime source
   * contains a `prefix`-starting key that is not in the schema. Catches
   * typos and forgotten-to-declare drift. Default: `false` (extra
   * prefixed keys are silently ignored).
   */
  strict?: boolean;
}

/**
 * Type-safe loader for *client-bundled* env. Pair this with
 * `defineSettings` for the server side: secrets stay in the server
 * loader, public values live in the client loader, and the prefix
 * makes any mix-up a compile-time *and* runtime error.
 *
 * @example
 * ```ts
 * // settings.client.ts
 * import { z } from "zod";
 * import { defineClientEnv } from "@env-kit/node-settings";
 *
 * export const clientEnv = defineClientEnv({
 *   prefix: "VITE_",
 *   schema: z.object({
 *     VITE_API_URL: z.string().url(),
 *     VITE_SENTRY_DSN: z.string().optional(),
 *   }),
 * });
 *
 * // app code (browser)
 * const env = clientEnv(import.meta.env);
 * fetch(env.VITE_API_URL);
 * ```
 *
 * The returned function:
 *   1. Filters `source` to keys starting with `prefix` (server-only
 *      keys are dropped before zod ever sees them).
 *   2. Runs `schema.parse` on the filtered map.
 *   3. (optional) Fails if `strict` is set and a prefixed key wasn't
 *      declared in the schema.
 *
 * Failures throw `NodeSettingsError` with a stable `code`:
 *   - `CLIENT_ENV_PREFIX_VIOLATION` — thrown immediately from
 *     `defineClientEnv` if any schema key omits the prefix.
 *   - `CLIENT_ENV_UNDECLARED` — thrown at runtime under `strict: true`.
 *   - `CLIENT_ENV_VALIDATION_FAILED` — wraps a zod ZodError.
 */
export function defineClientEnv<TSchema extends z.ZodObject<z.ZodRawShape>>(
  options: DefineClientEnvOptions<TSchema>,
): (source: Record<string, string | undefined>) => z.infer<TSchema> {
  const { schema, prefix } = options;
  const strict = options.strict ?? false;

  if (typeof prefix !== "string" || prefix.length === 0) {
    raise(
      "CLIENT_ENV_PREFIX_VIOLATION",
      `defineClientEnv: prefix must be a non-empty string (got ${JSON.stringify(prefix)}).`,
      {
        hint: "Use 'NEXT_PUBLIC_' for Next.js, 'VITE_' for Vite, 'PUBLIC_' for Astro / SvelteKit.",
      },
    );
  }

  const declared = Object.keys(schema.shape);
  const offenders = declared.filter((k) => !k.startsWith(prefix));
  if (offenders.length > 0) {
    raise(
      "CLIENT_ENV_PREFIX_VIOLATION",
      `defineClientEnv: schema key(s) do not start with prefix '${prefix}': ${offenders
        .map((k) => `'${k}'`)
        .join(", ")}.`,
      {
        hint: `Rename the key(s) to start with '${prefix}', or move them to the server-side defineSettings() — public env vars must wear the prefix so build tools can ship them safely.`,
      },
    );
  }

  return (source) => {
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(source)) {
      if (k.startsWith(prefix) && v !== undefined) {
        filtered[k] = String(v);
      }
    }

    if (strict) {
      const declaredSet = new Set(declared);
      const extras = Object.keys(filtered).filter((k) => !declaredSet.has(k));
      if (extras.length > 0) {
        raise(
          "CLIENT_ENV_UNDECLARED",
          `Public env key(s) present at runtime but not declared in the client schema: ${extras
            .map((k) => `'${k}'`)
            .join(", ")}.`,
          {
            hint: `Add the key(s) to defineClientEnv's schema, or remove them from the runtime source. Strict mode catches typos before they ship to the browser silently.`,
          },
        );
      }
    }

    try {
      return schema.parse(filtered) as z.infer<TSchema>;
    } catch (err) {
      if (err instanceof z.ZodError) {
        raise("CLIENT_ENV_VALIDATION_FAILED", formatZodIssues(err), {
          cause: err,
        });
      }
      throw err;
    }
  };
}
