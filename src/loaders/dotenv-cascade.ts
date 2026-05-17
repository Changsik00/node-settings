import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseDotenv, readDotenvSafe } from "./dotenv-file.js";
import type { AppEnvPreset } from "../presets.js";

export interface LoadDotenvCascadeOptions {
  /** Directory the cascade reads from. Default: `process.cwd()`. */
  cwd?: string;
  /**
   * Name of the env var that selects the mode (drives `.env.<mode>`
   * lookup). Default: `'APP_ENV'`.
   */
  appEnvKey?: string;
  /**
   * Mode used when `appEnvKey` is not set anywhere. Default: `'local'`.
   */
  defaultMode?: string;
  /**
   * Modes for which the `.env.local` and `.env.<mode>.local` files
   * are skipped. The Vite / Next.js / dotenv-flow convention is to
   * skip these in `'test'` so CI runs aren't affected by a developer's
   * local overrides. Default: `['test']`.
   */
  skipLocalFor?: readonly string[];
  /**
   * Explicit env source applied on top of every file (typically
   * `process.env`). Variables set here always win over file values.
   * Default: `process.env`.
   */
  source?: Record<string, string | undefined>;
  /**
   * Opt-in platform presets consulted when neither `source[appEnvKey]`
   * nor the base `.env` file supply a value. See `presets.*` in the
   * package root (e.g. `presets.vercel()`, `presets.netlify()`).
   *
   * Resolution order for `mode`:
   *   1. `source[appEnvKey]` (explicit override)
   *   2. `.env`'s value
   *   3. each preset's `detect(source)`, in array order
   *   4. `defaultMode`
   */
  appEnvPresets?: readonly AppEnvPreset[];
}

export interface DotenvCascadeResult {
  /** Merged env map (files first, then `source` on top). */
  env: Record<string, string | undefined>;
  /** Resolved mode after the cascade. */
  mode: string;
  /** Files that existed and were loaded, in load order. */
  loaded: string[];
  /** Files that were checked but did not exist. */
  skipped: string[];
}

/**
 * Cascade-load `.env` files following the Vite / Next.js / dotenv-flow
 * convention. Each subsequent file overrides earlier ones; `source`
 * (typically `process.env`) wins over every file.
 *
 * Load order:
 *
 *   1. `.env`                     — base, committed
 *   2. `.env.local`               — local overrides, *gitignored*
 *   3. `.env.<mode>`              — env-specific (e.g. `.env.prod`)
 *   4. `.env.<mode>.local`        — env-specific local, *gitignored*
 *   5. `source` (process.env)     — always wins
 *
 * `mode` resolves to: `source[appEnvKey]` ?? `.env`'s value ??
 * `defaultMode`. The two `.local` files are skipped when `mode` is in
 * `skipLocalFor` (default `['test']`).
 *
 * @example
 * ```ts
 * import { defineSettings, loadDotenvCascade } from "@env-kit/node-settings";
 *
 * const settings = defineSettings({ ... });
 * const { env, mode } = loadDotenvCascade();
 * console.log(`Booting in ${mode} mode.`);
 * const cfg = settings(env);
 * ```
 */
export function loadDotenvCascade(
  options: LoadDotenvCascadeOptions = {},
): DotenvCascadeResult {
  const cwd = options.cwd ?? process.cwd();
  const appEnvKey = options.appEnvKey ?? "APP_ENV";
  const defaultMode = options.defaultMode ?? "local";
  const skipLocalFor = options.skipLocalFor ?? ["test"];
  const source = options.source ?? process.env;

  const merged: Record<string, string | undefined> = {};
  const loaded: string[] = [];
  const skipped: string[] = [];

  // 1. Load `.env` first so we can read appEnvKey from it (in case
  //    process.env doesn't have it yet — e.g. in tooling scripts).
  const basePath = resolve(cwd, ".env");
  let baseParsed: Record<string, string> = {};
  if (existsSync(basePath)) {
    baseParsed = parseDotenv(readDotenvSafe(basePath));
    Object.assign(merged, baseParsed);
    loaded.push(basePath);
  } else {
    skipped.push(basePath);
  }

  // 2. Determine mode. Priority: source -> .env file -> presets -> default.
  let mode = source[appEnvKey] ?? baseParsed[appEnvKey];
  if (!mode && options.appEnvPresets) {
    for (const preset of options.appEnvPresets) {
      const detected = preset.detect(source);
      if (typeof detected === "string" && detected.length > 0) {
        mode = detected;
        break;
      }
    }
  }
  if (!mode) mode = defaultMode;
  const skipLocal = skipLocalFor.includes(mode);

  // 3. Remaining cascade. `load: false` entries are still reported in
  //    `skipped` so callers can see "we deliberately ignored this".
  const cascade: Array<{ path: string; load: boolean }> = [
    { path: resolve(cwd, ".env.local"), load: !skipLocal },
    { path: resolve(cwd, `.env.${mode}`), load: true },
    { path: resolve(cwd, `.env.${mode}.local`), load: !skipLocal },
  ];

  for (const { path, load } of cascade) {
    if (!load) {
      skipped.push(path);
      continue;
    }
    if (existsSync(path)) {
      const parsed = parseDotenv(readDotenvSafe(path));
      Object.assign(merged, parsed);
      loaded.push(path);
    } else {
      skipped.push(path);
    }
  }

  // 4. Source (process.env) wins over every file.
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) merged[key] = value;
  }
  // Also make sure appEnvKey lands in the result even if source didn't have it.
  if (merged[appEnvKey] === undefined) merged[appEnvKey] = mode;

  return { env: merged, mode, loaded, skipped };
}
