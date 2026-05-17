import type { ParsedArgs } from "./args.js";
import { flagBool, flagString } from "./args.js";
import {
  setupWorkspaceRun,
  printWorkspaceHeader,
  printPackageBanner,
  printPackageError,
} from "./workspace-runner.js";
import {
  buildValidateResult,
  printValidateResultText,
  type ValidateResult,
} from "./validate.js";
import {
  buildCheckResult,
  printCheckResultText,
  type CheckResult,
} from "./check.js";
import { buildInspectResult, type InspectResult } from "./inspect.js";
import { emitJson, isJson } from "./format.js";

interface PreflightResult {
  ok: boolean;
  config: string;
  validate: ValidateResult;
  /** Null when --env-file flag is malformed (mirrors check). */
  check: CheckResult | { ok: false; error: string };
  inspect: InspectResult | { ok: false; error: string };
}

interface WorkspacePreflightResult {
  ok: boolean;
  workspaceRoot: string;
  packages: Array<{
    name: string;
    configPath: string;
    result: PreflightResult | { ok: false; error: string };
  }>;
}

/**
 * `node-settings preflight` — one-shot CI gate that combines
 * `validate`, `check`, and `inspect` (dry) for the configured envs.
 *
 * Exit codes:
 *   0   everything passed
 *   1   validation or completeness check failed
 *   2   caller-supplied flags were malformed (e.g. bad --env-file)
 */
export async function runPreflight(args: ParsedArgs): Promise<number> {
  if (flagBool(args, "workspace")) {
    return runPreflightWorkspace(args);
  }
  const configPath = flagString(args, "config");
  const json = isJson(args);
  const envFileArg = args.positionals[1] ?? flagString(args, "env-file");
  const allowWarnings = flagBool(args, "allow-warnings", true);

  const built = await runPreflightSingle(configPath, envFileArg, args);
  if (built.envFileMissing) {
    if (json) {
      emitJson(built.result);
    } else {
      console.error(`[node-settings] env file not found: ${envFileArg}`);
    }
    return 2;
  }
  if (built.checkArgsInvalid) {
    if (json) {
      emitJson(built.result);
    } else {
      console.error(`[node-settings] invalid --env-file argument`);
    }
    return 2;
  }

  if (json) {
    emitJson(built.result);
  } else {
    printPreflightResultText(built.result);
  }

  if (!built.result.ok) return 1;
  if (
    !allowWarnings &&
    "report" in built.result.check &&
    built.result.check.report.issues.some((i) => i.severity === "warning")
  ) {
    return 1;
  }
  return 0;
}

async function runPreflightSingle(
  configPath: string | undefined,
  envFileArg: string | undefined,
  args: ParsedArgs,
): Promise<{
  result: PreflightResult;
  envFileMissing?: true;
  checkArgsInvalid?: true;
}> {
  const validateBuilt = await buildValidateResult(configPath, envFileArg);
  if (validateBuilt.envFileMissing) {
    return {
      envFileMissing: true,
      result: {
        ok: false,
        config: validateBuilt.result.config,
        validate: validateBuilt.result,
        check: { ok: false, error: "skipped: env file not found" },
        inspect: { ok: false, error: "skipped: env file not found" },
      },
    };
  }

  const checkResult = await buildCheckResult(configPath, args);
  if (checkResult === null) {
    return {
      checkArgsInvalid: true,
      result: {
        ok: false,
        config: validateBuilt.result.config,
        validate: validateBuilt.result,
        check: { ok: false, error: "invalid --env-file argument" },
        inspect: { ok: false, error: "skipped" },
      },
    };
  }

  let inspect: InspectResult | { ok: false; error: string };
  try {
    inspect = await buildInspectResult(configPath, args);
  } catch (err) {
    inspect = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const ok =
    validateBuilt.result.ok &&
    checkResult.ok &&
    "ok" in inspect &&
    inspect.ok;

  return {
    result: {
      ok,
      config: validateBuilt.result.config,
      validate: validateBuilt.result,
      check: checkResult,
      inspect,
    },
  };
}

function printPreflightResultText(result: PreflightResult): void {
  console.log(`=== preflight: ${result.config} ===`);
  console.log("");
  console.log("[1/3] validate");
  printValidateResultText(result.validate);
  console.log("");
  console.log("[2/3] check");
  if ("error" in result.check) {
    console.error(`  [node-settings] ${result.check.error}`);
  } else {
    printCheckResultText(result.check);
  }
  console.log("");
  console.log("[3/3] inspect");
  if ("error" in result.inspect) {
    console.error(`  [node-settings] ${result.inspect.error}`);
  } else {
    for (const branch of result.inspect.branches) {
      if (branch.missing) {
        console.error(`  ! ${branch.env}: no perEnv branch defined`);
      } else {
        console.log(`  ${result.inspect.envKey}=${branch.env}: ok`);
      }
    }
  }
  console.log("");
  console.log(result.ok ? "preflight: OK" : "preflight: FAIL");
}

async function runPreflightWorkspace(args: ParsedArgs): Promise<number> {
  const ctx = setupWorkspaceRun(args);
  if (typeof ctx === "number") return ctx;
  const allowWarnings = flagBool(args, "allow-warnings", true);
  const envFileArg = args.positionals[1] ?? flagString(args, "env-file");

  const workspaceResult: WorkspacePreflightResult = {
    ok: true,
    workspaceRoot: ctx.root,
    packages: [],
  };
  let worst = 0;
  for (const pkg of ctx.packages) {
    const built = await runPreflightSingle(pkg.configPath, envFileArg, args);
    if (built.envFileMissing || built.checkArgsInvalid) {
      workspaceResult.packages.push({
        name: pkg.name,
        configPath: pkg.configPath,
        result: {
          ok: false,
          error: built.envFileMissing
            ? "env file not found"
            : "invalid --env-file argument",
        },
      });
      workspaceResult.ok = false;
      worst = Math.max(worst, 2);
      continue;
    }
    workspaceResult.packages.push({
      name: pkg.name,
      configPath: pkg.configPath,
      result: built.result,
    });
    const hasWarning =
      !allowWarnings &&
      "report" in built.result.check &&
      built.result.check.report.issues.some((i) => i.severity === "warning");
    if (!built.result.ok || hasWarning) {
      workspaceResult.ok = false;
      worst = Math.max(worst, 1);
    }
  }

  if (ctx.json) {
    emitJson(workspaceResult);
  } else {
    printWorkspaceHeader(ctx.root, ctx.packages.length);
    for (const pkgResult of workspaceResult.packages) {
      printPackageBanner(ctx.root, pkgResult.name, pkgResult.configPath);
      if ("error" in pkgResult.result) {
        printPackageError(pkgResult.result.error);
      } else {
        printPreflightResultText(pkgResult.result);
      }
      console.log("");
    }
  }
  return worst;
}

export type { PreflightResult, WorkspacePreflightResult };
