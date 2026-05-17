import { relative } from "node:path";
import type { ParsedArgs } from "./args.js";
import { emitJson, isJson } from "./format.js";
import {
  discoverWorkspacePackages,
  findWorkspaceRoot,
  type DiscoveredPackage,
} from "./workspace.js";

export interface WorkspaceContext {
  /** `--format=json` was requested. */
  json: boolean;
  /** Absolute path of the workspace root (or `cwd` if no marker was found). */
  root: string;
  /** Packages discovered under `root` that contain a settings config. */
  packages: readonly DiscoveredPackage[];
}

/**
 * Resolve workspace context for a `--workspace` subcommand. Returns the
 * discovered packages, or an exit code when nothing was found (caller
 * should `return` that code; the user-facing message has already been
 * printed).
 *
 * Standardises the "no packages" message across `check`, `inspect`,
 * and `preflight` so a single fix touches every subcommand.
 */
export function setupWorkspaceRun(args: ParsedArgs): WorkspaceContext | number {
  const json = isJson(args);
  const cwd = process.cwd();
  const root = findWorkspaceRoot(cwd) ?? cwd;
  const packages = discoverWorkspacePackages(root);
  if (packages.length === 0) {
    const error = `--workspace: no packages with a settings config found under ${root}`;
    if (json) {
      emitJson({ ok: false, workspaceRoot: root, packages: [], error });
    } else {
      console.error(`[node-settings] ${error}`);
    }
    return 2;
  }
  return { json, root, packages };
}

/** Print the header text shown above per-package output. */
export function printWorkspaceHeader(root: string, packageCount: number): void {
  console.log(`workspace root: ${root}`);
  console.log(`packages: ${packageCount}`);
  console.log("");
}

/** Print the `=== name (relative/path) ===` banner for a single package. */
export function printPackageBanner(
  workspaceRoot: string,
  name: string,
  configPath: string,
): void {
  console.log(`=== ${name} (${relative(workspaceRoot, configPath)}) ===`);
}

/** Print an error line for a package whose result couldn't be computed. */
export function printPackageError(error: string): void {
  console.error(`  [node-settings] ${error}`);
}
