import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import picomatch from "picomatch";

/**
 * Filesystem markers that anchor the workspace root. Found via
 * upward walk from a starting directory.
 */
const WORKSPACE_MARKERS = [
  "pnpm-workspace.yaml",
  "lerna.json",
  "turbo.json",
  "nx.json",
  "rush.json",
];

/**
 * Conventional directories scanned as a *fallback* when neither
 * `pnpm-workspace.yaml` nor `package.json` `workspaces` declares a
 * package layout. Keeps casual single-app repos working without a
 * workspace config.
 */
const HEURISTIC_DIRS = ["packages", "apps", "services", "libs"];

const CONFIG_FILES = [
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

export interface DiscoveredPackage {
  /** Absolute path to the package directory. */
  dir: string;
  /** Absolute path to the package's settings config file. */
  configPath: string;
  /** Short name (basename of the package dir). */
  name: string;
}

/**
 * Walk from `start` toward the filesystem root and return the first
 * directory that looks like a workspace root: it contains one of the
 * `WORKSPACE_MARKERS` or a `.git` directory. Returns `undefined` if
 * no marker is found.
 */
export function findWorkspaceRoot(start: string): string | undefined {
  let dir = resolve(start);
  const visited = new Set<string>();
  while (!visited.has(dir)) {
    visited.add(dir);
    if (WORKSPACE_MARKERS.some((m) => existsSync(resolve(dir, m)))) return dir;
    if (existsSync(resolve(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/**
 * Read `pnpm-workspace.yaml`'s `packages:` glob list. Returns:
 *   - `undefined` if the file doesn't exist
 *   - `[]` if the file exists but declares no packages
 *   - `string[]` otherwise
 *
 * An explicit empty list (`packages: []`) is honoured — the user
 * said "no workspaces", so we don't fall back to the heuristic.
 */
function readPnpmGlobs(root: string): readonly string[] | undefined {
  const path = resolve(root, "pnpm-workspace.yaml");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = parseYaml(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const packages = (parsed as Record<string, unknown>).packages;
    if (!Array.isArray(packages)) return [];
    return packages.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/**
 * Read `package.json`'s `workspaces` field (npm / yarn convention).
 * Supports both shapes:
 *   - `"workspaces": ["packages/*"]`
 *   - `"workspaces": { "packages": ["packages/*"] }`
 */
function readNpmWorkspaces(root: string): readonly string[] | undefined {
  const path = resolve(root, "package.json");
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const ws = (parsed as Record<string, unknown>).workspaces;
  if (Array.isArray(ws)) {
    return ws.filter((x): x is string => typeof x === "string");
  }
  if (ws && typeof ws === "object") {
    const inner = (ws as Record<string, unknown>).packages;
    if (Array.isArray(inner)) {
      return inner.filter((x): x is string => typeof x === "string");
    }
  }
  return undefined;
}

/**
 * Expand a list of workspace globs to absolute directory paths,
 * honouring `!`-prefixed exclusions. Path separator is `/` (POSIX
 * convention used by pnpm + npm + yarn workspace globs).
 *
 * Walks the tree starting at `root`, pruning `node_modules` and
 * dotfile dirs. Each visited directory is matched against every
 * positive pattern; matches are then filtered through the negative
 * patterns.
 */
function expandWorkspaceGlobs(
  root: string,
  patterns: readonly string[],
): string[] {
  const positives: string[] = [];
  const negatives: string[] = [];
  for (const p of patterns) {
    if (p.startsWith("!")) negatives.push(p.slice(1));
    else positives.push(p);
  }
  if (positives.length === 0) return [];

  const isPositive = picomatch(positives, { dot: false });
  const isNegative =
    negatives.length > 0 ? picomatch(negatives, { dot: false }) : null;

  // Estimate a sane depth bound. Most workspace globs are 1-2 levels
  // (`packages/*`, `apps/*/sub`); `**` can go deeper. Cap at 8 to
  // avoid pathological deep trees, but allow patterns to walk past
  // their literal segment count.
  const maxLiteralDepth = positives.reduce(
    (m, p) => Math.max(m, p.split("/").length),
    1,
  );
  const depthCap = Math.min(8, maxLiteralDepth + 3);

  const found = new Set<string>();
  const walk = (dir: string, relPath: string, depth: number) => {
    if (depth > depthCap) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const childDir = resolve(dir, name);
      try {
        if (!statSync(childDir).isDirectory()) continue;
      } catch {
        continue;
      }
      const childRel = relPath ? `${relPath}/${name}` : name;
      if (isPositive(childRel) && !(isNegative && isNegative(childRel))) {
        found.add(childDir);
      }
      walk(childDir, childRel, depth + 1);
    }
  };
  walk(root, "", 0);
  return [...found].sort();
}

/**
 * Heuristic fallback: scan `packages/`, `apps/`, `services/`, `libs/`
 * one level deep. Used only when neither `pnpm-workspace.yaml` nor
 * `package.json` `workspaces` declares a layout.
 */
function heuristicScan(root: string): string[] {
  const dirs: string[] = [];
  for (const wsDir of HEURISTIC_DIRS) {
    const fullDir = resolve(root, wsDir);
    if (!existsSync(fullDir)) continue;
    try {
      if (!statSync(fullDir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const name of readdirSync(fullDir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const pkgDir = resolve(fullDir, name);
      try {
        if (statSync(pkgDir).isDirectory()) dirs.push(pkgDir);
      } catch {
        /* unreadable entry — silently ignore */
      }
    }
  }
  return dirs;
}

/**
 * List the packages under a workspace root that contain a
 * `node-settings.config.*` (or `settings.config.*`) file.
 *
 * Discovery priority:
 *   1. `pnpm-workspace.yaml` `packages:` globs (if present)
 *   2. `package.json` `workspaces` (npm / yarn / Bun)
 *   3. Heuristic: `packages/`, `apps/`, `services/`, `libs/` (legacy
 *      fallback for casual single-app repos)
 *
 * Each candidate directory is then probed for a config file; the
 * ones with a config are returned, sorted by name.
 */
export function discoverWorkspacePackages(root: string): DiscoveredPackage[] {
  let candidateDirs: string[];

  const pnpmGlobs = readPnpmGlobs(root);
  const npmWs = readNpmWorkspaces(root);

  if (pnpmGlobs !== undefined) {
    candidateDirs =
      pnpmGlobs.length > 0 ? expandWorkspaceGlobs(root, pnpmGlobs) : [];
  } else if (npmWs !== undefined) {
    candidateDirs =
      npmWs.length > 0 ? expandWorkspaceGlobs(root, npmWs) : [];
  } else {
    candidateDirs = heuristicScan(root);
  }

  const found: DiscoveredPackage[] = [];
  for (const pkgDir of candidateDirs) {
    const configPath = CONFIG_FILES.map((f) => resolve(pkgDir, f)).find((p) =>
      existsSync(p),
    );
    if (configPath) {
      const name = pkgDir.split(sep).pop() ?? pkgDir;
      found.push({ dir: pkgDir, configPath, name });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
