import { parseAllDocuments } from "yaml";
import type { EnvField } from "./introspect.js";
import { raise } from "./errors.js";

/**
 * One mismatch between a live K8s manifest and the env schema.
 *
 * Severity:
 *   - `error` — must fix before deploying (missing required key, secret
 *     accidentally placed in a ConfigMap where it's visible to anyone
 *     with cluster read access, etc.).
 *   - `warning` — likely a problem but not blocking (an extra key in
 *     the live manifest that the schema does not declare, a non-secret
 *     placed inside a Secret).
 */
export interface DiffIssue {
  /** Stable identifier for the issue category. */
  kind:
    | "missing-required"
    | "secret-in-configmap"
    | "public-in-secret"
    | "extra-key";
  severity: "error" | "warning";
  /** Env key name (e.g. "DATABASE_URL"). */
  key: string;
  /** Where the key was found in the live manifest, if applicable. */
  foundIn?: "ConfigMap" | "Secret";
  message: string;
}

export interface DiffReport {
  ok: boolean;
  /** Issues grouped by severity make for nicer text output. */
  issues: DiffIssue[];
  /**
   * Summary counts for quick rendering. `extraKeys` are non-fatal
   * leftovers (e.g. an old key no longer in the schema). `missingRequired`
   * and `secretInConfigMap` block deploys.
   */
  counts: {
    errors: number;
    warnings: number;
  };
  /**
   * Echo of what the diff saw, so JSON consumers don't have to re-parse
   * the YAML to render context.
   */
  observed: {
    configMapKeys: string[];
    secretKeys: string[];
  };
}

export interface ParsedK8sInput {
  configMapKeys: string[];
  secretKeys: string[];
}

/**
 * Parse a YAML blob (multi-document supported) and extract the key
 * names that appear under `data:`/`stringData:` of every ConfigMap
 * and Secret. Other document kinds (Deployment, Service, …) are
 * skipped silently — the diff only cares about ConfigMaps and Secrets.
 *
 * Values are not collected — value-level diff (defaults vs live) is a
 * follow-up; the immediate operational win is on the key/kind axis.
 */
export function parseK8sYaml(source: string): ParsedK8sInput {
  const configMapKeys = new Set<string>();
  const secretKeys = new Set<string>();

  let docs: ReturnType<typeof parseAllDocuments>;
  try {
    docs = parseAllDocuments(source);
  } catch (err) {
    raise(
      "K8S_YAML_PARSE_FAILED",
      `failed to parse YAML input: ${err instanceof Error ? err.message : String(err)}`,
      {
        hint: "Run `kubectl get cm,secret -n <ns> -o yaml` to produce a valid multi-doc stream, or pass a file with `node-settings diff <path>`.",
        cause: err,
      },
    );
  }

  for (const doc of docs) {
    if (doc.errors.length > 0) {
      const first = doc.errors[0];
      raise("K8S_YAML_PARSE_FAILED", `invalid YAML: ${first?.message ?? "unknown error"}`, {
        hint: "Validate the manifest with `kubectl apply --dry-run=client -f -` before piping it into `node-settings diff`.",
      });
    }
    const value = doc.toJS() as unknown;
    if (!isObject(value)) continue;
    const kind = value.kind;
    if (kind !== "ConfigMap" && kind !== "Secret") continue;

    // `data` and `stringData` are both maps of name → value.
    const data = value.data;
    if (isObject(data)) {
      for (const k of Object.keys(data)) {
        if (kind === "ConfigMap") configMapKeys.add(k);
        else secretKeys.add(k);
      }
    }
    if (kind === "Secret") {
      const stringData = value.stringData;
      if (isObject(stringData)) {
        for (const k of Object.keys(stringData)) secretKeys.add(k);
      }
    }
  }

  return {
    configMapKeys: [...configMapKeys].sort(),
    secretKeys: [...secretKeys].sort(),
  };
}

/**
 * Compare a parsed K8s manifest's keys against the env schema and
 * return a structured report.
 *
 * The four issue categories:
 *
 *   - `missing-required` (error) — schema says required, manifest has
 *     it nowhere. Deploy will boot-crash on validation.
 *   - `secret-in-configmap` (error) — schema flagged this key as a
 *     secret, but it sits in a ConfigMap. Anyone with cluster `get`
 *     on ConfigMaps can read it. Bad.
 *   - `public-in-secret` (warning) — schema doesn't flag this as a
 *     secret, but it lives in a Secret. Harmless but oddly placed.
 *   - `extra-key` (warning) — key in manifest, not declared in schema.
 *     Could be drift or a future-removed var that wasn't cleaned up.
 */
export function diffAgainstSchema(
  parsed: ParsedK8sInput,
  fields: readonly EnvField[],
): DiffReport {
  const issues: DiffIssue[] = [];

  const fieldByKey = new Map<string, EnvField>();
  for (const f of fields) fieldByKey.set(f.key, f);

  const configMapSet = new Set(parsed.configMapKeys);
  const secretSet = new Set(parsed.secretKeys);

  for (const field of fields) {
    const inConfigMap = configMapSet.has(field.key);
    const inSecret = secretSet.has(field.key);

    if (field.required && !inConfigMap && !inSecret) {
      issues.push({
        kind: "missing-required",
        severity: "error",
        key: field.key,
        message: `required env '${field.key}' is not present in any ConfigMap or Secret`,
      });
      continue;
    }

    if (field.secret && inConfigMap) {
      issues.push({
        kind: "secret-in-configmap",
        severity: "error",
        key: field.key,
        foundIn: "ConfigMap",
        message: `'${field.key}' is marked secret in the schema but lives in a ConfigMap (readable by anyone with cluster get on ConfigMaps)`,
      });
    }

    if (!field.secret && inSecret && !inConfigMap) {
      issues.push({
        kind: "public-in-secret",
        severity: "warning",
        key: field.key,
        foundIn: "Secret",
        message: `'${field.key}' is non-secret in the schema but lives in a Secret (harmless, but oddly placed)`,
      });
    }
  }

  for (const k of [...configMapSet, ...secretSet]) {
    if (!fieldByKey.has(k)) {
      issues.push({
        kind: "extra-key",
        severity: "warning",
        key: k,
        foundIn: configMapSet.has(k) ? "ConfigMap" : "Secret",
        message: `'${k}' appears in the live manifest but is not declared in the env schema`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;

  return {
    ok: errors === 0,
    issues,
    counts: { errors, warnings },
    observed: {
      configMapKeys: [...configMapSet].sort(),
      secretKeys: [...secretSet].sort(),
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
