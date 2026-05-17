/**
 * @env-kit/node-settings — Schema-first settings for Node apps.
 *
 * Two halves:
 *
 *  1. **Runtime**: `defineSettings(...)` validates `process.env` against a
 *     zod schema, layers in per-environment config and an optional JSON
 *     override, and returns a frozen, fully-typed settings object.
 *
 *  2. **Tooling**: the same schema can be turned into `.env.example`
 *     files, Markdown documentation tables, and Kubernetes ConfigMap /
 *     Secret manifests via the `generators/` entry point or the
 *     `node-settings` CLI.
 *
 * The application defines the shape of its settings; this package
 * provides the assembly procedure and the generators around it.
 */
export {
  defineSettings,
  type DefineSettingsOptions,
  type SettingsLoader,
  type AnySettingsLoader,
  type ResolvedSettings,
  type MergedEnv,
  type MergedConfig,
} from "./define-settings.js";

export {
  defineClientEnv,
  type DefineClientEnvOptions,
} from "./client-env.js";

export {
  NodeSettingsError,
  type NodeSettingsErrorCode,
} from "./errors.js";

export {
  todo,
  isTodo,
  findTodos,
  TODO_SYMBOL,
  type TodoSentinel,
} from "./todo.js";

export {
  presets,
  inferAppEnv,
  inferAppEnvDetailed,
  type AppEnvPreset,
  type InferAppEnvOptions,
  type InferAppEnvResult,
  type VercelMapping,
  type NetlifyMapping,
  type GithubActionsOptions,
  type CloudflarePagesOptions,
  type RailwayMapping,
  type NodeEnvMapping,
} from "./presets.js";

export {
  introspectEnvSchema,
  type EnvField,
  type IntrospectOptions,
  DEFAULT_SECRET_PATTERNS,
} from "./introspect.js";

export { loadNodeEnv } from "./loaders/index.js";
export { loadDotenvFile, parseDotenv } from "./loaders/dotenv-file.js";
export {
  loadDotenvCascade,
  type LoadDotenvCascadeOptions,
  type DotenvCascadeResult,
} from "./loaders/dotenv-cascade.js";

export { deepMerge, type DeepPartial } from "./utils/deep-merge.js";
export { mergePerEnv } from "./utils/merge-per-env.js";

export {
  checkPerEnvCompleteness,
  type PerEnvCompletenessReport,
  type PerEnvIssue,
  type CheckPerEnvOptions,
} from "./check-per-env.js";
