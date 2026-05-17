import type { ParsedArgs } from "./args.js";
import { flagBool, flagString } from "./args.js";
import { loadUserConfig } from "./load-user-config.js";
import {
  setupWorkspaceRun,
  printWorkspaceHeader,
  printPackageBanner,
  printPackageError,
} from "./workspace-runner.js";
import { deepMerge } from "../utils/deep-merge.js";
import { isTodo } from "../todo.js";
import type { EnvField } from "../introspect.js";
import { emitJson, isJson } from "./format.js";

interface InspectEnvBranch {
  env: string;
  /** Missing if no branch is defined for the requested env. */
  missing?: true;
  /** Merged defaults + perEnv[env]. Todo sentinels serialise as `{ "$todo": reason }`. */
  config?: unknown;
}

interface InspectResult {
  ok: boolean;
  config: string;
  envKey: string;
  overrideEnvKey?: string;
  envSchema: readonly EnvField[];
  branches: InspectEnvBranch[];
}

interface WorkspaceInspectResult {
  ok: boolean;
  workspaceRoot: string;
  packages: Array<{
    name: string;
    configPath: string;
    result: InspectResult | { ok: false; error: string };
  }>;
}

/**
 * `node-settings inspect [--env <name>]` — show what env contract and
 * layered config (defaults + perEnv[mode]) resolve to at a given env.
 *
 * Runs in *dry mode*: it does not call the loader, so no env values
 * (and no secrets) are required. Useful for answering "what does my
 * prod config actually look like?" without needing prod credentials.
 */
export async function runInspect(args: ParsedArgs): Promise<number> {
  if (flagBool(args, "workspace")) {
    return runInspectWorkspace(args);
  }
  const configPath = flagString(args, "config");
  const json = isJson(args);
  const result = await buildInspectResult(configPath, args);
  if (json) {
    emitJson(result);
  } else {
    printInspectResultText(result);
  }
  return result.ok ? 0 : 1;
}

async function buildInspectResult(
  configPath: string | undefined,
  args: ParsedArgs,
): Promise<InspectResult> {
  const { path: resolvedPath, loader } = await loadUserConfig(configPath);
  const branches = Object.keys(loader.resolved.perEnv);
  const requestedEnvs = flagString(args, "env")?.split(",");
  const targetEnvs = requestedEnvs ?? branches;

  const result: InspectResult = {
    ok: true,
    config: resolvedPath,
    envKey: loader.resolved.envKey,
    envSchema: loader.envFields,
    branches: [],
  };
  if (loader.resolved.overrideEnvKey) {
    result.overrideEnvKey = loader.resolved.overrideEnvKey;
  }

  for (const env of targetEnvs) {
    const branch = loader.resolved.perEnv[env];
    if (!branch) {
      result.branches.push({ env, missing: true });
      result.ok = false;
      continue;
    }
    const layered = deepMerge(
      loader.resolved.defaults as Record<string, unknown>,
      branch as Record<string, unknown>,
    );
    result.branches.push({ env, config: layered });
  }

  return result;
}

function printInspectResultText(result: InspectResult): void {
  console.log(`config=${result.config}`);
  console.log(`envKey=${result.envKey}`);
  if (result.overrideEnvKey) {
    console.log(`overrideEnvKey=${result.overrideEnvKey}`);
  }
  console.log("");

  console.log("env schema (the contract):");
  for (const field of result.envSchema) {
    console.log(`  ${formatEnvField(field)}`);
  }
  console.log("");

  for (const branch of result.branches) {
    if (branch.missing) {
      console.error(`! ${branch.env}: no perEnv branch defined`);
      continue;
    }
    console.log(`layered config for ${result.envKey}=${branch.env}:`);
    printConfig(branch.config, "  ");
    console.log("");
  }
}

async function runInspectWorkspace(args: ParsedArgs): Promise<number> {
  const ctx = setupWorkspaceRun(args);
  if (typeof ctx === "number") return ctx;

  const workspaceResult: WorkspaceInspectResult = {
    ok: true,
    workspaceRoot: ctx.root,
    packages: [],
  };
  let worst = 0;
  for (const pkg of ctx.packages) {
    try {
      const single = await buildInspectResult(pkg.configPath, args);
      workspaceResult.packages.push({
        name: pkg.name,
        configPath: pkg.configPath,
        result: single,
      });
      if (!single.ok) {
        workspaceResult.ok = false;
        worst = Math.max(worst, 1);
      }
    } catch (err) {
      workspaceResult.packages.push({
        name: pkg.name,
        configPath: pkg.configPath,
        result: {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });
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
        printInspectResultText(pkgResult.result);
      }
      console.log("");
    }
  }
  return worst;
}

function formatEnvField(field: EnvField): string {
  const tags: string[] = [field.type];
  if (field.required) tags.push("required");
  else tags.push("optional");
  if (field.enumValues) tags.push(`enum: ${field.enumValues.join("|")}`);
  if (field.defaultValue !== undefined && !field.secret) {
    tags.push(`default: ${JSON.stringify(field.defaultValue)}`);
  }
  if (field.secret) tags.push("secret");
  const desc = field.description ? ` — ${field.description}` : "";
  return `${field.key} (${tags.join(", ")})${desc}`;
}

function printConfig(value: unknown, indent: string): void {
  if (isTodo(value)) {
    console.log(`${indent}<TODO: ${JSON.stringify(value.reason)}>`);
    return;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    console.log(`${indent}${JSON.stringify(value)}`);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isTodo(child)) {
      console.log(`${indent}${key}: <TODO: ${JSON.stringify(child.reason)}>`);
      continue;
    }
    if (
      child !== null &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      Object.keys(child as Record<string, unknown>).length > 0
    ) {
      console.log(`${indent}${key}:`);
      printConfig(child, indent + "  ");
    } else {
      console.log(`${indent}${key}: ${JSON.stringify(child)}`);
    }
  }
}

export { buildInspectResult };
export type { InspectResult, InspectEnvBranch, WorkspaceInspectResult };
