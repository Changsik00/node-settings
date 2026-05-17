import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  generateEnvExample,
  generatePerEnvExamples,
} from "../generators/env-example.js";
import { generateMarkdownDocs } from "../generators/markdown.js";
import { generateK8sManifests } from "../generators/k8s.js";
import { generateJsonSchema } from "../generators/json-schema.js";
import { generateTfvars } from "../generators/tfvars.js";
import {
  generateComposeFragment,
  type ComposeStyle,
} from "../generators/compose.js";
import { loadUserConfig, type LoadedUserConfig } from "./load-user-config.js";
import type { ParsedArgs } from "./args.js";
import { flagBool, flagString } from "./args.js";

/**
 * A `generate` subcommand. Either returns `{ output }` (text written to
 * stdout or `--out`), `{ done: true }` (handler already produced its
 * output as a side effect), or `{ exitCode }` (failed flag parsing,
 * caller is told why and given the exit code).
 */
type GenerateOutcome =
  | { kind: "output"; text: string }
  | { kind: "done" }
  | { kind: "exit"; code: number };

interface GenerateHandler {
  /** All command aliases for this target (the first is the canonical name). */
  aliases: readonly string[];
  run: (
    loader: LoadedUserConfig["loader"],
    args: ParsedArgs,
  ) => GenerateOutcome | Promise<GenerateOutcome>;
}

const HANDLERS: readonly GenerateHandler[] = [
  {
    aliases: ["env-example", "env"],
    run: (loader) => ({
      kind: "output",
      text: generateEnvExample(loader.envFields),
    }),
  },
  {
    aliases: ["envs", "per-env", "env-samples"],
    run: (loader, args) => {
      const outDir = flagString(args, "out-dir") ?? flagString(args, "out");
      if (!outDir) {
        console.error("[node-settings] generate envs requires --out-dir <dir>");
        return { kind: "exit", code: 2 };
      }
      const examples = generatePerEnvExamples(loader);
      mkdirSync(outDir, { recursive: true });
      const written: string[] = [];
      for (const [envName, contents] of Object.entries(examples)) {
        const fullPath = resolve(outDir, `.env.${envName}.example`);
        writeFileSync(fullPath, contents, "utf8");
        written.push(fullPath);
      }
      console.error(`wrote ${written.length} file(s):`);
      for (const p of written) console.error(`  ${p}`);
      return { kind: "done" };
    },
  },
  {
    aliases: ["docs", "markdown", "md"],
    run: (loader, args) => ({
      kind: "output",
      text: generateMarkdownDocs(loader.envFields, {
        ...optionalString(args, "title"),
        ...optionalString(args, "intro"),
      }),
    }),
  },
  {
    aliases: ["json-schema", "schema"],
    run: (loader, args) => ({
      kind: "output",
      text: generateJsonSchema(loader.envFields, {
        ...optionalString(args, "title"),
        ...optionalString(args, "id", "$id"),
        ...optionalString(args, "description"),
      }),
    }),
  },
  {
    aliases: ["k8s", "kubernetes"],
    run: (loader, args) => {
      const name = flagString(args, "name");
      if (!name) {
        console.error("[node-settings] generate k8s requires --name <app-name>");
        return { kind: "exit", code: 2 };
      }
      const namespace = flagString(args, "namespace");
      const inlineSecretValues = flagBool(args, "inline-secrets", false);
      const result = generateK8sManifests(loader.envFields, {
        name,
        ...(namespace !== undefined ? { namespace } : {}),
        inlineSecretValues,
      });
      return { kind: "output", text: result.yaml };
    },
  },
  {
    aliases: ["tfvars", "terraform"],
    run: (loader) => ({
      kind: "output",
      text: generateTfvars(loader.envFields),
    }),
  },
  {
    aliases: ["compose", "docker-compose"],
    run: (loader, args) => {
      const styleRaw = flagString(args, "style");
      const style: ComposeStyle = styleRaw === "env-file" ? "env-file" : "service";
      const serviceName = flagString(args, "name") ?? "app";
      return {
        kind: "output",
        text: generateComposeFragment(loader.envFields, { style, serviceName }),
      };
    },
  },
];

const HANDLER_BY_ALIAS: ReadonlyMap<string, GenerateHandler> = new Map(
  HANDLERS.flatMap((h) => h.aliases.map((a) => [a, h] as const)),
);

const TARGET_LIST = HANDLERS.map((h) => h.aliases[0]).join(", ");

/**
 * `node-settings generate <target>` — render `.env.example`, Markdown
 * docs, Kubernetes manifests, JSON Schema, Terraform tfvars, or a
 * docker-compose fragment from the user's schema. Output is written to
 * `--out <path>` or printed to stdout.
 */
export async function runGenerate(args: ParsedArgs): Promise<number> {
  const target = args.positionals[1];
  if (!target) {
    console.error(`[node-settings] generate <target> required. Targets: ${TARGET_LIST}`);
    return 2;
  }

  const handler = HANDLER_BY_ALIAS.get(target);
  if (!handler) {
    console.error(
      `[node-settings] unknown generate target '${target}'. Targets: ${TARGET_LIST}`,
    );
    return 2;
  }

  const configPath = flagString(args, "config");
  const outPath = flagString(args, "out");
  const { loader } = await loadUserConfig(configPath);

  const outcome = await handler.run(loader, args);
  if (outcome.kind === "exit") return outcome.code;
  if (outcome.kind === "done") return 0;

  if (outPath) {
    writeFileSync(outPath, outcome.text, "utf8");
    console.error(`wrote ${outPath}`);
  } else {
    process.stdout.write(outcome.text);
  }
  return 0;
}

/**
 * Read a string flag and produce a single-key object only when the flag
 * was actually set. Lets us spread into the options bag without
 * polluting it with `undefined` values that override defaults.
 */
function optionalString(
  args: ParsedArgs,
  flag: string,
  asKey: string = flag,
): Record<string, string> {
  const value = flagString(args, flag);
  return value !== undefined ? { [asKey]: value } : {};
}
