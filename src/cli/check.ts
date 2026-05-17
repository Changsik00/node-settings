import { existsSync } from "node:fs";
import { loadDotenvFile } from "../loaders/dotenv-file.js";
import {
  checkPerEnvCompleteness,
  type PerEnvCompletenessReport,
} from "../check-per-env.js";
import { loadUserConfig } from "./load-user-config.js";
import {
  setupWorkspaceRun,
  printWorkspaceHeader,
  printPackageBanner,
  printPackageError,
} from "./workspace-runner.js";
import type { ParsedArgs } from "./args.js";
import { flagBool, flagString } from "./args.js";
import { emitJson, isJson } from "./format.js";

export interface CheckResult {
  ok: boolean;
  config: string;
  report: PerEnvCompletenessReport;
}

interface WorkspaceCheckResult {
  ok: boolean;
  workspaceRoot: string;
  packages: Array<{
    name: string;
    configPath: string;
    /** Result for this package, or an error if loading failed. */
    result: CheckResult | { ok: false; error: string };
  }>;
}

/**
 * `node-settings check` — verify per-env branches are complete enough
 * to deploy. With `--workspace`, runs against every discovered package.
 * `--format=json` emits a single structured document.
 */
export async function runCheck(args: ParsedArgs): Promise<number> {
  if (flagBool(args, "workspace")) {
    return runCheckWorkspace(args);
  }
  const configPath = flagString(args, "config");
  return runCheckSinglePrinted(configPath, args);
}

async function runCheckSinglePrinted(
  configPath: string | undefined,
  args: ParsedArgs,
): Promise<number> {
  const json = isJson(args);
  const allowWarnings = flagBool(args, "allow-warnings", true);
  const single = await buildCheckResult(configPath, args);
  if (single === null) return 2; // parsing of --env-file failed; message already printed

  if (json) {
    emitJson(single);
  } else {
    printCheckResultText(single);
  }
  if (!single.ok) return 1;
  if (
    !allowWarnings &&
    single.report.issues.some((i) => i.severity === "warning")
  ) {
    return 1;
  }
  return 0;
}

/**
 * Compute the check result without printing it. Returns `null` if the
 * caller-supplied flags were malformed (a human-readable message is
 * printed to stderr in that case). Used by both the single-package
 * path and the workspace iterator.
 */
export async function buildCheckResult(
  configPath: string | undefined,
  args: ParsedArgs,
): Promise<CheckResult | null> {
  const envFilter = flagString(args, "env");
  const { path: resolvedConfig, loader } = await loadUserConfig(configPath);

  const envValues: Record<string, Record<string, string>> = {};
  const envFileSpec = flagString(args, "env-file");
  if (envFileSpec) {
    for (const pair of envFileSpec.split(",")) {
      const [envName, filePath] = pair.split("=");
      if (!envName || !filePath) {
        console.error(
          `[node-settings] --env-file expects name=path[,name=path...]`,
        );
        return null;
      }
      if (!existsSync(filePath)) {
        console.error(`[node-settings] env file not found: ${filePath}`);
        return null;
      }
      envValues[envName] = loadDotenvFile(filePath);
    }
  }

  const envs = envFilter ? envFilter.split(",") : undefined;
  const report = checkPerEnvCompleteness(loader, {
    ...(envs ? { envs } : {}),
    envValues,
  });

  return { ok: report.ok, config: resolvedConfig, report };
}

export function printCheckResultText(result: CheckResult): void {
  console.log(`config=${result.config}`);
  console.log("");
  for (const [env, counts] of Object.entries(result.report.countsByEnv)) {
    const status =
      counts.errors > 0 ? "FAIL" : counts.warnings > 0 ? "WARN" : "OK  ";
    console.log(
      `${status} ${env}  errors=${counts.errors}  warnings=${counts.warnings}`,
    );
  }
  if (result.report.issues.length > 0) {
    console.log("");
    for (const issue of result.report.issues) {
      const tag = issue.severity === "error" ? "ERR " : "WARN";
      console.log(`${tag} [${issue.env}] ${issue.path}: ${issue.message}`);
    }
  }
}

async function runCheckWorkspace(args: ParsedArgs): Promise<number> {
  const ctx = setupWorkspaceRun(args);
  if (typeof ctx === "number") return ctx;
  const allowWarnings = flagBool(args, "allow-warnings", true);

  const result: WorkspaceCheckResult = {
    ok: true,
    workspaceRoot: ctx.root,
    packages: [],
  };

  let worst = 0;
  for (const pkg of ctx.packages) {
    const single = await buildCheckResult(pkg.configPath, args);
    if (single === null) {
      result.packages.push({
        name: pkg.name,
        configPath: pkg.configPath,
        result: { ok: false, error: "invalid --env-file argument" },
      });
      result.ok = false;
      worst = Math.max(worst, 2);
      continue;
    }
    result.packages.push({
      name: pkg.name,
      configPath: pkg.configPath,
      result: single,
    });
    const hasWarning =
      !allowWarnings &&
      single.report.issues.some((i) => i.severity === "warning");
    if (!single.ok || hasWarning) {
      result.ok = false;
      worst = Math.max(worst, 1);
    }
  }

  if (ctx.json) {
    emitJson(result);
  } else {
    printWorkspaceHeader(ctx.root, ctx.packages.length);
    for (const pkgResult of result.packages) {
      printPackageBanner(ctx.root, pkgResult.name, pkgResult.configPath);
      if ("error" in pkgResult.result) {
        printPackageError(pkgResult.result.error);
      } else {
        printCheckResultText(pkgResult.result);
      }
      console.log("");
    }
  }
  return worst;
}
