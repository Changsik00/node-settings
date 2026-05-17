import { existsSync, readFileSync } from "node:fs";
import { introspectEnvSchema, type EnvField } from "../introspect.js";
import {
  diffAgainstSchema,
  parseK8sYaml,
  type DiffReport,
} from "../diff-k8s.js";
import { raise, NodeSettingsError } from "../errors.js";
import { loadUserConfig } from "./load-user-config.js";
import type { ParsedArgs } from "./args.js";
import { flagString } from "./args.js";
import { emitJson, isJson } from "./format.js";

interface DiffCliResult {
  ok: boolean;
  config: string;
  source: string;
  report: DiffReport;
}

/**
 * `node-settings diff [file|-]` — compare a live K8s ConfigMap / Secret
 * (typically piped from `kubectl get -o yaml`) against the env schema.
 * Flags missing required keys, secrets accidentally placed in a
 * ConfigMap, non-secrets in a Secret, and extra undeclared keys.
 *
 * Exit codes:
 *   0   no errors (warnings may still be present; pass --strict to
 *       upgrade warnings to errors)
 *   1   one or more errors
 *   2   caller-supplied flags / inputs malformed
 */
export async function runDiff(args: ParsedArgs): Promise<number> {
  const json = isJson(args);
  const configPath = flagString(args, "config");
  const strict = "strict" in args.flags && args.flags.strict !== false;

  const source = args.positionals[1];
  let yamlText: string | null;
  try {
    yamlText = await readSource(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      emitJson({ ok: false, error: message });
    } else {
      console.error(`[node-settings] diff: ${message}`);
    }
    return 2;
  }
  if (yamlText === null) {
    if (json) {
      emitJson({
        ok: false,
        error:
          "no input — pass a YAML file path or pipe a manifest into stdin",
      });
    } else {
      console.error(
        "[node-settings] diff: no input — pass a YAML file path or pipe a manifest into stdin",
      );
    }
    return 2;
  }

  let fields: readonly EnvField[];
  let resolvedConfig: string;
  try {
    const loaded = await loadUserConfig(configPath);
    resolvedConfig = loaded.path;
    fields = introspectEnvSchema(loaded.loader.opts.envSchema);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      emitJson({ ok: false, error: message });
    } else {
      console.error(`[node-settings] ${message}`);
    }
    return 2;
  }

  let parsed: ReturnType<typeof parseK8sYaml>;
  try {
    parsed = parseK8sYaml(yamlText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      emitJson({ ok: false, error: message });
    } else {
      console.error(`[node-settings] diff: ${message}`);
    }
    return 2;
  }
  const report = diffAgainstSchema(parsed, fields);
  const result: DiffCliResult = {
    ok: report.ok,
    config: resolvedConfig,
    source: source === "-" ? "(stdin)" : (source ?? "(stdin)"),
    report,
  };

  if (json) {
    emitJson(result);
  } else {
    printDiffResultText(result);
  }

  if (!result.ok) return 1;
  if (strict && report.counts.warnings > 0) return 1;
  return 0;
}

async function readSource(source: string | undefined): Promise<string | null> {
  if (!source || source === "-") {
    if (process.stdin.isTTY) return null;
    return await readStdin();
  }
  if (!existsSync(source)) {
    raise("FILE_READ_FAILED", `yaml input not found: ${source}.`, {
      hint: "Pass a readable file path, or pipe a manifest into stdin and use `-` as the argument.",
    });
  }
  try {
    return readFileSync(source, "utf8");
  } catch (err) {
    if (err instanceof NodeSettingsError) throw err;
    raise(
      "FILE_READ_FAILED",
      `failed to read yaml input ${source}: ${err instanceof Error ? err.message : String(err)}`,
      { hint: "Check the file's read permissions.", cause: err },
    );
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk as Buffer));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8")),
    );
    process.stdin.on("error", reject);
  });
}

function printDiffResultText(result: DiffCliResult): void {
  console.log(`config=${result.config}`);
  console.log(`source=${result.source}`);
  console.log(
    `live: ${result.report.observed.configMapKeys.length} ConfigMap key(s), ${result.report.observed.secretKeys.length} Secret key(s)`,
  );
  console.log(
    `issues: ${result.report.counts.errors} error(s), ${result.report.counts.warnings} warning(s)`,
  );
  if (result.report.issues.length === 0) {
    console.log("OK   no drift");
    return;
  }
  console.log("");
  for (const issue of result.report.issues) {
    const tag = issue.severity === "error" ? "ERR " : "WARN";
    console.log(`${tag} [${issue.kind}] ${issue.message}`);
  }
}
