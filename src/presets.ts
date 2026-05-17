/**
 * Platform presets for inferring `APP_ENV` from well-known
 * deployment-platform environment variables.
 *
 * Each preset is *opt-in*. The library never inspects the platform
 * automatically; users compose presets explicitly:
 *
 * ```ts
 * import { inferAppEnv, presets } from "@env-kit/node-settings";
 * const APP_ENV = inferAppEnv({
 *   presets: [presets.vercel(), presets.githubActions({ branchToMode: { main: "prod" } })],
 * });
 * ```
 */

/** A single platform preset — given an env source, returns the inferred mode or `undefined`. */
export interface AppEnvPreset {
  readonly name: string;
  readonly detect: (
    env: Record<string, string | undefined>,
  ) => string | undefined;
}

export interface InferAppEnvOptions {
  /** Env source. Default: `process.env`. */
  source?: Record<string, string | undefined>;
  /** Presets to consult, in priority order. Default: `[]`. */
  presets?: readonly AppEnvPreset[];
  /** Fallback mode when nothing matches. Default: `'local'`. */
  default?: string;
  /** The env var that holds an explicit override. Default: `'APP_ENV'`. */
  envKey?: string;
}

/**
 * Detailed result of {@link inferAppEnv}. Use when you want to log
 * *where* the mode came from (for debugging "why does my app think
 * it's local in production?" issues).
 */
export interface InferAppEnvResult {
  /** The resolved mode value. */
  value: string;
  /** Where the value came from. */
  source: "explicit" | "preset" | "default";
  /** Name of the matching preset, if `source === 'preset'`. */
  presetName: string | undefined;
}

/**
 * Resolve `APP_ENV` (or any chosen env key) from a chain of sources,
 * in priority order:
 *
 *   1. `source[envKey]` if set — always wins (explicit override).
 *   2. Each `preset.detect(source)` in array order — first non-undefined wins.
 *   3. `default` (fallback).
 *
 * `process.env`/explicit-override > platform-signal > default. This
 * matches the intuition that if VERCEL_ENV says "production" but the
 * operator has set APP_ENV manually, the operator wins.
 */
export function inferAppEnv(options: InferAppEnvOptions = {}): string {
  return inferAppEnvDetailed(options).value;
}

/** Same as {@link inferAppEnv} but returns the resolution metadata too. */
export function inferAppEnvDetailed(
  options: InferAppEnvOptions = {},
): InferAppEnvResult {
  const source = options.source ?? process.env;
  const envKey = options.envKey ?? "APP_ENV";
  const explicit = source[envKey];
  if (typeof explicit === "string" && explicit.length > 0) {
    return { value: explicit, source: "explicit", presetName: undefined };
  }
  for (const preset of options.presets ?? []) {
    const value = preset.detect(source);
    if (typeof value === "string" && value.length > 0) {
      return { value, source: "preset", presetName: preset.name };
    }
  }
  return {
    value: options.default ?? "local",
    source: "default",
    presetName: undefined,
  };
}

export interface VercelMapping {
  production?: string;
  preview?: string;
  development?: string;
}

/**
 * Vercel preset — maps `VERCEL_ENV` to a mode.
 * Default mapping: `production` -> `prod`, `preview` -> `stage`,
 * `development` -> `local`.
 */
function vercel(overrides?: VercelMapping): AppEnvPreset {
  const m: Required<VercelMapping> = {
    production: "prod",
    preview: "stage",
    development: "local",
    ...overrides,
  };
  return {
    name: "vercel",
    detect: (env) => {
      const v = env.VERCEL_ENV;
      if (v === "production") return m.production;
      if (v === "preview") return m.preview;
      if (v === "development") return m.development;
      return undefined;
    },
  };
}

export interface NetlifyMapping {
  production?: string;
  "deploy-preview"?: string;
  "branch-deploy"?: string;
  dev?: string;
}

/**
 * Netlify preset — maps `CONTEXT` to a mode.
 * Default: `production` -> `prod`, `deploy-preview` -> `stage`,
 * `branch-deploy` -> `dev`, `dev` -> `local`.
 */
function netlify(overrides?: NetlifyMapping): AppEnvPreset {
  const m: Required<NetlifyMapping> = {
    production: "prod",
    "deploy-preview": "stage",
    "branch-deploy": "dev",
    dev: "local",
    ...overrides,
  };
  return {
    name: "netlify",
    detect: (env) => {
      const v = env.CONTEXT;
      if (v && v in m) return m[v as keyof NetlifyMapping];
      return undefined;
    },
  };
}

export interface CloudflarePagesOptions {
  productionBranch?: string;
  productionMode?: string;
  defaultMode?: string;
}

/**
 * Cloudflare Pages preset — uses `CF_PAGES` + `CF_PAGES_BRANCH`.
 * The production branch (default `'main'`) maps to `prod`; everything
 * else maps to `defaultMode` (default `'dev'`).
 */
function cloudflarePages(options?: CloudflarePagesOptions): AppEnvPreset {
  const productionBranch = options?.productionBranch ?? "main";
  const productionMode = options?.productionMode ?? "prod";
  const defaultMode = options?.defaultMode ?? "dev";
  return {
    name: "cloudflare-pages",
    detect: (env) => {
      if (env.CF_PAGES !== "1") return undefined;
      if (env.CF_PAGES_BRANCH === productionBranch) return productionMode;
      return defaultMode;
    },
  };
}

export interface GithubActionsOptions {
  /** Branch -> mode lookup. Keys are branch names (without `refs/heads/`). */
  branchToMode?: Record<string, string>;
  /** Mode for branches not in `branchToMode`. Default: `'dev'`. */
  default?: string;
}

/**
 * GitHub Actions preset — uses `GITHUB_REF_NAME` (or `GITHUB_REF`).
 * Map specific branches to modes; everything else falls through to
 * `default`. Only fires when `GITHUB_ACTIONS=true`.
 */
function githubActions(options?: GithubActionsOptions): AppEnvPreset {
  const branchToMode = options?.branchToMode ?? { main: "prod" };
  const defaultMode = options?.default ?? "dev";
  return {
    name: "github-actions",
    detect: (env) => {
      if (env.GITHUB_ACTIONS !== "true") return undefined;
      const branch =
        env.GITHUB_REF_NAME ??
        (env.GITHUB_REF?.startsWith("refs/heads/")
          ? env.GITHUB_REF.slice("refs/heads/".length)
          : undefined);
      if (branch && branchToMode[branch]) return branchToMode[branch];
      return defaultMode;
    },
  };
}

export interface RailwayMapping {
  production?: string;
  staging?: string;
  development?: string;
}

/** Railway preset — maps `RAILWAY_ENVIRONMENT_NAME` (falls back to `RAILWAY_ENVIRONMENT`). */
function railway(overrides?: RailwayMapping): AppEnvPreset {
  const m: Record<string, string> = {
    production: "prod",
    staging: "stage",
    development: "local",
    ...overrides,
  };
  return {
    name: "railway",
    detect: (env) => {
      const v = env.RAILWAY_ENVIRONMENT_NAME ?? env.RAILWAY_ENVIRONMENT;
      if (v && v in m) return m[v];
      return undefined;
    },
  };
}

/**
 * Render preset — Render injects `RENDER=true` and `IS_PULL_REQUEST`.
 * The default mapping treats production deploys as `prod` and PR
 * previews as `stage`.
 */
function render(options?: { production?: string; preview?: string }): AppEnvPreset {
  const productionMode = options?.production ?? "prod";
  const previewMode = options?.preview ?? "stage";
  return {
    name: "render",
    detect: (env) => {
      if (env.RENDER !== "true") return undefined;
      if (env.IS_PULL_REQUEST === "true") return previewMode;
      return productionMode;
    },
  };
}

export interface NodeEnvMapping {
  production?: string;
  development?: string;
  test?: string;
}

/**
 * `NODE_ENV` preset — the Node.js convention. Default: `production`
 * -> `prod`, `development` -> `local`, `test` -> `test`. Useful as a
 * last-resort fallback for environments without their own signal.
 */
function nodeEnv(overrides?: NodeEnvMapping): AppEnvPreset {
  const m: Required<NodeEnvMapping> = {
    production: "prod",
    development: "local",
    test: "test",
    ...overrides,
  };
  return {
    name: "node-env",
    detect: (env) => {
      const v = env.NODE_ENV;
      if (v === "production") return m.production;
      if (v === "development") return m.development;
      if (v === "test") return m.test;
      return undefined;
    },
  };
}

/**
 * Bundled preset factories. Each is opt-in — compose only the
 * platforms you actually deploy to.
 */
export const presets = {
  vercel,
  netlify,
  cloudflarePages,
  githubActions,
  railway,
  render,
  nodeEnv,
} as const;
