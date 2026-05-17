import { existsSync } from "node:fs";
import { loadDotenvFile } from "../loaders/dotenv-file.js";
import { NodeSettingsError } from "../errors.js";
import { reportError, type ErrorReport } from "../report-error.js";
import { loadUserConfig } from "./load-user-config.js";
import type { ParsedArgs } from "./args.js";
import { flagString } from "./args.js";
import { emitJson, isJson } from "./format.js";

export interface ValidateResult {
  ok: boolean;
  config: string;
  source: string;
  /** Structured error report — present only on failure. See {@link ErrorReport}. */
  error?: ErrorReport;
}

/**
 * `node-settings validate [env-file]` — load the user's config, build
 * settings against the supplied env file (or `process.env` if none),
 * and exit non-zero if validation fails.
 *
 * `--format=json` emits a single `ValidateResult` document on stdout
 * for machine consumers (CI dashboards, AI agents).
 */
export async function runValidate(args: ParsedArgs): Promise<number> {
  const json = isJson(args);
  const configPath = flagString(args, "config");
  const envFileArg = args.positionals[1] ?? flagString(args, "env-file");

  const built = await buildValidateResult(configPath, envFileArg);
  if (built.envFileMissing) {
    if (json) {
      emitJson(built.result);
    } else {
      console.error(`[node-settings] env file not found: ${envFileArg}`);
    }
    return 2;
  }

  const result = built.result;
  if (json) {
    emitJson(result);
  } else {
    printValidateResultText(result);
  }
  return result.ok ? 0 : 1;
}

/**
 * Compute a ValidateResult without printing it. `envFileMissing` is
 * set when the caller supplied an env-file path that doesn't exist;
 * callers translate that into exit code 2.
 */
export async function buildValidateResult(
  configPath: string | undefined,
  envFileArg: string | undefined,
): Promise<{ result: ValidateResult; envFileMissing?: true }> {
  let result: ValidateResult;
  try {
    const { path: resolvedConfig, loader } = await loadUserConfig(configPath);

    let rawEnv: Record<string, string | undefined>;
    let source: string;
    if (envFileArg) {
      if (!existsSync(envFileArg)) {
        return {
          envFileMissing: true,
          result: {
            ok: false,
            config: resolvedConfig,
            source: envFileArg,
            error: reportError(
              new NodeSettingsError(
                "FILE_READ_FAILED",
                `env file not found: ${envFileArg}.`,
                {
                  hint: "Pass an existing path to --env-file, or omit the flag to use process.env.",
                },
              ),
            ),
          },
        };
      }
      rawEnv = loadDotenvFile(envFileArg);
      source = envFileArg;
    } else {
      rawEnv = process.env;
      source = "process.env";
    }

    try {
      loader(rawEnv);
      result = { ok: true, config: resolvedConfig, source };
    } catch (err) {
      result = {
        ok: false,
        config: resolvedConfig,
        source,
        error: reportError(err),
      };
    }
  } catch (err) {
    result = {
      ok: false,
      config: configPath ?? "(auto-discover)",
      source: envFileArg ?? "process.env",
      error: reportError(err),
    };
  }

  return { result };
}

export function printValidateResultText(result: ValidateResult): void {
  if (result.ok) {
    console.log(`OK   config=${result.config}`);
    console.log(`     env=${result.source}`);
  } else {
    console.error(`FAIL config=${result.config}`);
    console.error(`     env=${result.source}`);
    if (result.error) console.error(result.error.message);
  }
}

