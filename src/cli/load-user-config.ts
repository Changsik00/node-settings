import { existsSync } from "node:fs";
import { resolve, isAbsolute, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import type { z } from "zod";
import type { SettingsLoader } from "../define-settings.js";
import { raise } from "../errors.js";

const CANDIDATE_FILES = [
  "node-settings.config.ts",
  "node-settings.config.mts",
  "node-settings.config.js",
  "node-settings.config.mjs",
  "node-settings.config.cjs",
  "settings.config.ts",
  "settings.config.mts",
  "settings.config.js",
  "settings.config.mjs",
  "settings.config.cjs",
];

/**
 * Filesystem markers that bound the upward search for a config file.
 * The search stops if any of these is found in a directory *without*
 * also finding a config — the directory is the repo/workspace root and
 * going further would leak outside the project.
 */
const STOP_MARKERS = [
  ".git",
  "pnpm-workspace.yaml",
  "lerna.json",
  "turbo.json",
  "nx.json",
  "rush.json",
];

export interface LoadedUserConfig {
  /** Absolute path of the loaded config file. */
  path: string;
  /** The settings loader exported as `default` (or `settings`). */
  loader: SettingsLoader<
    z.ZodObject<z.ZodRawShape>,
    Record<string, unknown>,
    Record<string, unknown>
  >;
}

/**
 * Resolve and load the user's settings loader. Three strategies, tried
 * in order:
 *
 *   1. `--config <path>` (or the `path` argument here) — load that file
 *      directly.
 *   2. Auto-discover one of {@link CANDIDATE_FILES} in `cwd`.
 *   3. Walk up the directory tree, checking each parent for the same
 *      candidate files, stopping at a workspace/repo marker (`.git`,
 *      `pnpm-workspace.yaml`, `turbo.json`, etc.) or the filesystem
 *      root. This matches the behavior of `tsc`, `eslint`, and other
 *      cosmiconfig-based tools.
 *
 * The loaded module must expose either a default export or a `settings`
 * named export that is a {@link SettingsLoader} (i.e. the return value
 * of `defineSettings({...})`).
 */
export async function loadUserConfig(
  explicitPath?: string,
  cwd: string = process.cwd(),
): Promise<LoadedUserConfig> {
  const resolved = explicitPath
    ? resolve(cwd, explicitPath)
    : findConfigUpwards(cwd);

  if (!resolved) {
    raise(
      "CONFIG_NOT_FOUND",
      `no settings config found searching upward from ${cwd}.`,
      {
        hint: `Expected one of ${CANDIDATE_FILES.join(", ")}. Pass --config <path> to point at one explicitly.`,
      },
    );
  }
  if (!existsSync(resolved)) {
    raise("CONFIG_NOT_FOUND", `config file not found: ${resolved}.`, {
      hint: "Check the path passed to --config (or the auto-discovered candidate). Relative paths resolve from the cwd.",
    });
  }

  let mod: Record<string, unknown>;
  try {
    mod = await importModule(resolved);
  } catch (err) {
    raise(
      "CONFIG_LOAD_FAILED",
      `failed to load config ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
      {
        hint: "Most often a syntax error in the config file or a missing dependency it imports. The underlying error is attached as `cause`.",
        cause: err,
      },
    );
  }

  const candidate =
    (mod && (mod.default ?? (mod as Record<string, unknown>).settings)) ?? null;

  if (!isSettingsLoader(candidate)) {
    raise(
      "CONFIG_INVALID_EXPORT",
      `${resolved} must export a defineSettings(...) loader.`,
      {
        hint: "Provide either `export default defineSettings({...})` or `export const settings = defineSettings({...})`.",
      },
    );
  }

  return { path: resolved, loader: candidate };
}

/**
 * Walk from `start` toward the filesystem root, returning the first
 * candidate config file found. Halts when a STOP_MARKER appears in the
 * current directory without a matching config — the marker signals a
 * workspace/repo boundary.
 *
 * Exported for testing.
 */
export function findConfigUpwards(start: string): string | undefined {
  let dir = resolve(start);
  // Track visited dirs to guard against pathological symlink loops.
  const visited = new Set<string>();
  while (!visited.has(dir)) {
    visited.add(dir);

    for (const candidate of CANDIDATE_FILES) {
      const full = resolve(dir, candidate);
      if (existsSync(full)) return full;
    }

    if (STOP_MARKERS.some((m) => existsSync(resolve(dir, m)))) {
      return undefined;
    }

    const parent = dirname(dir);
    if (parent === dir) return undefined; // filesystem root
    dir = parent;
  }
  return undefined;
}

async function importModule(filePath: string): Promise<Record<string, unknown>> {
  const abs = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  if (abs.endsWith(".ts") || abs.endsWith(".mts") || abs.endsWith(".cts")) {
    const jiti = createJiti(import.meta.url, {
      interopDefault: true,
      moduleCache: false,
    });
    return (await jiti.import(abs)) as Record<string, unknown>;
  }
  const url = pathToFileURL(abs).href;
  return (await import(url)) as Record<string, unknown>;
}

function isSettingsLoader(value: unknown): value is LoadedUserConfig["loader"] {
  if (typeof value !== "function") return false;
  const opts = (value as { opts?: unknown }).opts;
  const envFields = (value as { envFields?: unknown }).envFields;
  const resolvedView = (value as { resolved?: unknown }).resolved;
  return Boolean(opts) && Array.isArray(envFields) && Boolean(resolvedView);
}
