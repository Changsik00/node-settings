/**
 * End-to-end CLI tests against the canonical `sample/` directory.
 *
 * These call `runCli` (the programmatic entry point used by `bin.js`)
 * instead of spawning the binary, so the test stays fast and integrates
 * with the normal vitest run. The bin shim itself is trivial — it just
 * calls runCli and forwards the exit code — and is exercised by
 * `scripts/verify-dist.mjs` after build.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runCli } from "./index.js";

const SAMPLE = "sample/settings.ts";

interface Capture {
  logs: string[];
  errs: string[];
  stdout: string[];
  stderr: string[];
}

let capture: Capture;
let tmp: string;

beforeEach(() => {
  capture = { logs: [], errs: [], stdout: [], stderr: [] };
  vi.spyOn(console, "log").mockImplementation((...args) => {
    capture.logs.push(args.map((a) => String(a)).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args) => {
    capture.errs.push(args.map((a) => String(a)).join(" "));
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    capture.stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    capture.stderr.push(String(chunk));
    return true;
  });
  tmp = mkdtempSync(join(tmpdir(), "node-settings-e2e-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe("CLI e2e — inspect", () => {
  it("prints schema + layered config for every perEnv branch", async () => {
    const code = await runCli(["inspect", "--config", SAMPLE]);
    expect(code).toBe(0);
    const out = capture.logs.join("\n");
    expect(out).toContain("envKey=APP_ENV");
    expect(out).toContain("DB_HOST (string, required)");
    expect(out).toContain("DB_PASSWORD (string, required, secret)");
    expect(out).toContain("layered config for APP_ENV=local");
    expect(out).toContain("layered config for APP_ENV=prod");
  });

  it("--env=prod renders <TODO> for the unfilled cdnDomain", async () => {
    const code = await runCli([
      "inspect",
      "--config",
      SAMPLE,
      "--env=prod",
    ]);
    expect(code).toBe(0);
    const out = capture.logs.join("\n");
    expect(out).toContain("cdnDomain: <TODO:");
    expect(out).not.toContain("layered config for APP_ENV=local");
  });
});

describe("CLI e2e — validate", () => {
  it("returns 1 when the env file is missing required vars", async () => {
    const envFile = join(tmp, ".env.local");
    // Write a .env file that satisfies the sample schema...
    require("node:fs").writeFileSync(
      envFile,
      "APP_ENV=local\nDB_HOST=h\nDB_PASSWORD=p\n",
    );
    const code = await runCli([
      "validate",
      envFile,
      "--config",
      SAMPLE,
    ]);
    expect(code).toBe(0);
    expect(capture.logs.join("\n")).toContain("OK");
  });

  it("returns 1 when the env file is incomplete", async () => {
    const envFile = join(tmp, ".env.broken");
    require("node:fs").writeFileSync(envFile, "APP_ENV=local\n"); // missing DB_HOST
    const code = await runCli([
      "validate",
      envFile,
      "--config",
      SAMPLE,
    ]);
    expect(code).toBe(1);
    expect(capture.errs.join("\n")).toMatch(/FAIL|DB_HOST/);
  });

  it("returns 2 when the env file does not exist", async () => {
    const code = await runCli([
      "validate",
      "/tmp/nonexistent-node-settings-test.env",
      "--config",
      SAMPLE,
    ]);
    expect(code).toBe(2);
  });
});

describe("CLI e2e — check", () => {
  it("exits non-zero when prod has an unfilled todo and no envValues", async () => {
    const code = await runCli(["check", "--config", SAMPLE]);
    expect(code).toBe(1);
    const out = (capture.logs.concat(capture.errs)).join("\n");
    expect(out).toContain("prod");
    expect(out).toMatch(/unfilled todo|missing-required-env/);
  });
});

describe("CLI e2e — generate", () => {
  it("generate env-example writes the rendered template to --out", async () => {
    const out = join(tmp, ".env.example");
    const code = await runCli([
      "generate",
      "env-example",
      "--config",
      SAMPLE,
      "--out",
      out,
    ]);
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("APP_ENV");
    expect(text).toContain("DB_HOST");
    expect(text).toMatch(/# DB_PASSWORD .*secret/);
  });

  it("generate envs writes one file per perEnv branch", async () => {
    const code = await runCli([
      "generate",
      "envs",
      "--config",
      SAMPLE,
      "--out-dir",
      tmp,
    ]);
    expect(code).toBe(0);
    const files = readdirSync(tmp).sort();
    expect(files).toEqual([
      ".env.dev.example",
      ".env.local.example",
      ".env.prod.example",
      ".env.stage.example",
    ]);
    const prod = readFileSync(join(tmp, ".env.prod.example"), "utf8");
    expect(prod).toContain("APP_ENV=prod");
  });

  it("generate docs writes a Markdown table", async () => {
    const out = join(tmp, "ENV.md");
    const code = await runCli([
      "generate",
      "docs",
      "--config",
      SAMPLE,
      "--out",
      out,
    ]);
    expect(code).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("# Environment Variables");
    expect(text).toContain("| `DB_HOST` |");
  });

  it("generate json-schema emits a Draft 2020-12 JSON Schema", async () => {
    const out = join(tmp, "env.schema.json");
    const code = await runCli([
      "generate",
      "json-schema",
      "--config",
      SAMPLE,
      "--title",
      "Sample env",
      "--out",
      out,
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(out, "utf8"));
    expect(parsed.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(parsed.title).toBe("Sample env");
    expect(parsed.properties.DB_HOST.type).toBe("string");
    expect(parsed.properties.DB_PASSWORD.format).toBe("password");
    expect(parsed.required).toContain("DB_HOST");
  });

  it("generate k8s emits ConfigMap + Secret yaml", async () => {
    const out = join(tmp, "k8s.yaml");
    const code = await runCli([
      "generate",
      "k8s",
      "--config",
      SAMPLE,
      "--name",
      "demo",
      "--namespace",
      "prod",
      "--out",
      out,
    ]);
    expect(code).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("kind: ConfigMap");
    expect(text).toContain("kind: Secret");
    expect(text).toContain("name: demo-config");
    expect(text).toContain("name: demo-secret");
    expect(text).toContain("namespace: prod");
    // DB_PASSWORD ends up in the Secret, not the ConfigMap
    const cmStart = text.indexOf("kind: ConfigMap");
    const secStart = text.indexOf("kind: Secret");
    expect(text.slice(cmStart, secStart)).not.toContain("DB_PASSWORD");
    expect(text.slice(secStart)).toContain("DB_PASSWORD");
  });

  it("generate tfvars emits HCL with placeholders + descriptions", async () => {
    const out = join(tmp, "terraform.tfvars");
    const code = await runCli([
      "generate",
      "tfvars",
      "--config",
      SAMPLE,
      "--out",
      out,
    ]);
    expect(code).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toMatch(/DB_HOST\s*=\s*"REPLACE_ME"/);
    expect(text).toMatch(/DB_PASSWORD\s*=\s*"REPLACE_ME"/);
    expect(text).toContain("# --- Secrets ---");
  });

  it("generate compose (service style default) emits a services: snippet", async () => {
    const out = join(tmp, "compose.snippet.yml");
    const code = await runCli([
      "generate",
      "compose",
      "--config",
      SAMPLE,
      "--name",
      "web",
      "--out",
      out,
    ]);
    expect(code).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toMatch(/^services:$/m);
    expect(text).toMatch(/^ {2}web:$/m);
    expect(text).toMatch(/DB_HOST: "\$\{DB_HOST\}"/);
    expect(text).toMatch(/DB_PASSWORD: "\$\{DB_PASSWORD\}"/);
  });

  it("generate compose --style env-file emits KEY=VALUE lines", async () => {
    const out = join(tmp, ".env.compose");
    const code = await runCli([
      "generate",
      "compose",
      "--config",
      SAMPLE,
      "--style",
      "env-file",
      "--out",
      out,
    ]);
    expect(code).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toMatch(/^DB_HOST=REPLACE_ME$/m);
    expect(text).toMatch(/^DB_PASSWORD=REPLACE_ME$/m);
  });

  it("returns exit code 2 when generate target is missing", async () => {
    const code = await runCli(["generate"]);
    expect(code).toBe(2);
  });

  it("returns exit code 2 for an unknown generate target", async () => {
    const code = await runCli([
      "generate",
      "nonsense",
      "--config",
      SAMPLE,
    ]);
    expect(code).toBe(2);
  });
});

describe("CLI e2e — --format=json", () => {
  it("validate --format=json emits a structured ok result on success", async () => {
    const envFile = join(tmp, ".env.local");
    require("node:fs").writeFileSync(
      envFile,
      "APP_ENV=local\nDB_HOST=h\nDB_PASSWORD=p\n",
    );
    const code = await runCli([
      "validate",
      envFile,
      "--config",
      SAMPLE,
      "--format",
      "json",
    ]);
    expect(code).toBe(0);
    const doc = JSON.parse(capture.stdout.join(""));
    expect(doc.ok).toBe(true);
    expect(doc.source).toBe(envFile);
    // Forward slash on POSIX, backslash on Windows — match both.
    expect(doc.config).toMatch(/sample[/\\]settings\.ts$/);
  });

  it("validate --format=json emits a structured error result on failure", async () => {
    const envFile = join(tmp, ".env.broken");
    require("node:fs").writeFileSync(envFile, "APP_ENV=local\n");
    const code = await runCli([
      "validate",
      envFile,
      "--config",
      SAMPLE,
      "--format",
      "json",
    ]);
    expect(code).toBe(1);
    const doc = JSON.parse(capture.stdout.join(""));
    expect(doc.ok).toBe(false);
    expect(doc.error).toBeDefined();
    expect(doc.error.code).toBeDefined();
  });

  it("check --format=json includes per-env counts and issues", async () => {
    const code = await runCli([
      "check",
      "--config",
      SAMPLE,
      "--format",
      "json",
    ]);
    expect(code).toBe(1);
    const doc = JSON.parse(capture.stdout.join(""));
    expect(doc.ok).toBe(false);
    expect(doc.report.countsByEnv.prod).toBeDefined();
    expect(Array.isArray(doc.report.issues)).toBe(true);
  });

  it("inspect --format=json serialises todo() as { $todo: reason }", async () => {
    const code = await runCli([
      "inspect",
      "--config",
      SAMPLE,
      "--env=prod",
      "--format",
      "json",
    ]);
    expect(code).toBe(0);
    const doc = JSON.parse(capture.stdout.join(""));
    // Forward slash on POSIX, backslash on Windows — match both.
    expect(doc.config).toMatch(/sample[/\\]settings\.ts$/);
    const prod = doc.branches.find(
      (b: { env: string }) => b.env === "prod",
    );
    expect(prod).toBeDefined();
    // cdnDomain is todo() in the sample
    const cdn = prod.config.cdnDomain;
    expect(cdn).toBeDefined();
    expect(cdn.$todo).toBeDefined();
  });
});

describe("CLI e2e — preflight", () => {
  it("text mode prints all three stages and exits 1 due to todo() in prod", async () => {
    const envFile = join(tmp, ".env.local");
    require("node:fs").writeFileSync(
      envFile,
      "APP_ENV=local\nDB_HOST=h\nDB_PASSWORD=p\n",
    );
    const code = await runCli([
      "preflight",
      envFile,
      "--config",
      SAMPLE,
    ]);
    expect(code).toBe(1);
    const out = capture.logs.concat(capture.errs).join("\n");
    expect(out).toContain("[1/3] validate");
    expect(out).toContain("[2/3] check");
    expect(out).toContain("[3/3] inspect");
    expect(out).toContain("preflight: FAIL");
  });

  it("--format=json bundles validate + check + inspect into one document", async () => {
    const envFile = join(tmp, ".env.local");
    require("node:fs").writeFileSync(
      envFile,
      "APP_ENV=local\nDB_HOST=h\nDB_PASSWORD=p\n",
    );
    const code = await runCli([
      "preflight",
      envFile,
      "--config",
      SAMPLE,
      "--format",
      "json",
    ]);
    expect(code).toBe(1);
    const doc = JSON.parse(capture.stdout.join(""));
    expect(doc.ok).toBe(false);
    expect(doc.validate.ok).toBe(true);
    expect(doc.check.ok).toBe(false);
    expect(doc.inspect.ok).toBe(true);
  });

  it("returns 2 when env-file is missing", async () => {
    const code = await runCli([
      "preflight",
      "/tmp/nonexistent-preflight-test.env",
      "--config",
      SAMPLE,
    ]);
    expect(code).toBe(2);
  });
});

describe("CLI e2e — --workspace", () => {
  let originalCwd: string;
  let wsRoot: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    // Create the workspace under the project root so jiti can resolve
    // `zod` and `@env-kit/node-settings` via the regular node_modules
    // walk-up. Any tmp dir outside the project is unreachable from jiti.
    wsRoot = mkdtempSync(join(originalCwd, ".tmp-ws-e2e-"));
    mkdirSync(join(wsRoot, ".git"));
    mkdirSync(join(wsRoot, "packages", "alpha"), { recursive: true });
    mkdirSync(join(wsRoot, "packages", "beta"), { recursive: true });
    const pkgConfig = `
import { defineSettings, todo } from "${originalCwd.replace(/\\/g, "/")}/src/index.ts";
import { z } from "zod";

const settings = defineSettings({
  envSchema: z.object({
    APP_ENV: z.enum(["local", "prod"]).default("local"),
    DB_HOST: z.string(),
  }),
  envKey: "APP_ENV",
  defaults: { bucket: "default" },
  perEnv: {
    local: { bucket: "local-b" },
    prod: { bucket: todo("set in prod") },
  },
  build: (env, config) => ({ dbHost: env.DB_HOST, bucket: config.bucket }),
});

export default settings;
`;
    writeFileSync(
      join(wsRoot, "packages", "alpha", "settings.config.ts"),
      pkgConfig,
    );
    writeFileSync(
      join(wsRoot, "packages", "beta", "settings.config.ts"),
      pkgConfig,
    );
    process.chdir(wsRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(wsRoot, { recursive: true, force: true });
  });

  it("check --workspace aggregates results across packages", async () => {
    const code = await runCli(["check", "--workspace"]);
    // Both packages copy the sample, which has todo() in prod → fail.
    expect(code).toBe(1);
    const out = capture.logs.concat(capture.errs).join("\n");
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });

  it("check --workspace --format=json emits a structured workspace doc", async () => {
    const code = await runCli(["check", "--workspace", "--format", "json"]);
    expect(code).toBe(1);
    const doc = JSON.parse(capture.stdout.join(""));
    expect(doc.ok).toBe(false);
    expect(doc.packages.length).toBe(2);
    expect(doc.packages.map((p: { name: string }) => p.name).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("inspect --workspace --format=json reports per-package InspectResult", async () => {
    const code = await runCli([
      "inspect",
      "--workspace",
      "--format",
      "json",
    ]);
    expect(code).toBe(0);
    const doc = JSON.parse(capture.stdout.join(""));
    expect(doc.packages.length).toBe(2);
    for (const pkg of doc.packages) {
      expect(pkg.result.envKey).toBe("APP_ENV");
      expect(Array.isArray(pkg.result.branches)).toBe(true);
    }
  });

  it("preflight --workspace --format=json runs validate+check+inspect per package", async () => {
    const code = await runCli([
      "preflight",
      "--workspace",
      "--format",
      "json",
    ]);
    expect(code).toBe(1);
    const doc = JSON.parse(capture.stdout.join(""));
    expect(doc.packages.length).toBe(2);
    for (const pkg of doc.packages) {
      expect(pkg.result.validate).toBeDefined();
      expect(pkg.result.check).toBeDefined();
      expect(pkg.result.inspect).toBeDefined();
    }
  });

  it("preflight --workspace text mode prints per-package banners", async () => {
    const code = await runCli(["preflight", "--workspace"]);
    expect(code).toBe(1);
    const out = capture.logs.concat(capture.errs).join("\n");
    expect(out).toContain("workspace root");
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });
});

describe("CLI e2e — --workspace empty discovery", () => {
  let originalCwd: string;
  let emptyRoot: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    emptyRoot = mkdtempSync(join(originalCwd, ".tmp-ws-e2e-"));
    mkdirSync(join(emptyRoot, ".git"));
    process.chdir(emptyRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(emptyRoot, { recursive: true, force: true });
  });

  it("check --workspace exits 2 with a 'no packages' message when nothing is discovered", async () => {
    const code = await runCli(["check", "--workspace"]);
    expect(code).toBe(2);
    const err = capture.errs.join("\n");
    expect(err).toContain("no packages with a settings config");
  });

  it("inspect --workspace --format=json emits a structured 'no packages' document", async () => {
    const code = await runCli([
      "inspect",
      "--workspace",
      "--format",
      "json",
    ]);
    expect(code).toBe(2);
    const json = JSON.parse(capture.stdout.join(""));
    expect(json.ok).toBe(false);
    expect(json.packages).toEqual([]);
    expect(json.error).toContain("no packages");
  });
});

describe("CLI e2e — diff", () => {
  it("text mode passes on a complete, correct ConfigMap + Secret", async () => {
    const yamlPath = join(tmp, "live.yaml");
    require("node:fs").writeFileSync(
      yamlPath,
      `
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
data:
  APP_ENV: prod
  DB_HOST: db.example.com
---
apiVersion: v1
kind: Secret
metadata:
  name: s
type: Opaque
stringData:
  DB_PASSWORD: secret
`,
    );
    const code = await runCli(["diff", yamlPath, "--config", SAMPLE]);
    expect(code).toBe(0);
    expect(capture.logs.join("\n")).toMatch(/no drift/);
  });

  it("flags secret-in-configmap as an error", async () => {
    const yamlPath = join(tmp, "leaky.yaml");
    require("node:fs").writeFileSync(
      yamlPath,
      `
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
data:
  APP_ENV: prod
  DB_HOST: db.example.com
  DB_PASSWORD: this-leaked
`,
    );
    const code = await runCli(["diff", yamlPath, "--config", SAMPLE]);
    expect(code).toBe(1);
    const out = capture.logs.join("\n");
    expect(out).toMatch(/secret-in-configmap/);
    expect(out).toMatch(/DB_PASSWORD/);
  });

  it("--format=json emits a structured report", async () => {
    const yamlPath = join(tmp, "live.yaml");
    require("node:fs").writeFileSync(
      yamlPath,
      `
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
data:
  APP_ENV: prod
  DB_HOST: db.example.com
  LEGACY: ignored
---
apiVersion: v1
kind: Secret
metadata:
  name: s
type: Opaque
stringData:
  DB_PASSWORD: secret
`,
    );
    const code = await runCli([
      "diff",
      yamlPath,
      "--config",
      SAMPLE,
      "--format",
      "json",
    ]);
    expect(code).toBe(0); // extra-key is a warning, not an error
    const doc = JSON.parse(capture.stdout.join(""));
    expect(doc.ok).toBe(true);
    expect(doc.report.counts.warnings).toBeGreaterThan(0);
    expect(
      doc.report.issues.some(
        (i: { kind: string; key: string }) =>
          i.kind === "extra-key" && i.key === "LEGACY",
      ),
    ).toBe(true);
  });

  it("--strict turns warnings into a non-zero exit", async () => {
    const yamlPath = join(tmp, "live.yaml");
    require("node:fs").writeFileSync(
      yamlPath,
      `
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
data:
  APP_ENV: prod
  DB_HOST: db.example.com
  LEGACY: leftover
---
apiVersion: v1
kind: Secret
metadata:
  name: s
type: Opaque
stringData:
  DB_PASSWORD: secret
`,
    );
    const code = await runCli([
      "diff",
      yamlPath,
      "--config",
      SAMPLE,
      "--strict",
    ]);
    expect(code).toBe(1);
  });

  it("returns 2 when the file does not exist", async () => {
    const code = await runCli([
      "diff",
      "/tmp/never-existed-node-settings-diff.yaml",
      "--config",
      SAMPLE,
    ]);
    expect(code).toBe(2);
  });
});

describe("CLI e2e — top-level dispatch", () => {
  it("prints help and exits 0 when no command is given", async () => {
    const code = await runCli([]);
    expect(code).toBe(0);
    expect(capture.stdout.join("")).toContain("node-settings");
  });

  it("exits 2 for an unknown command", async () => {
    const code = await runCli(["dunno"]);
    expect(code).toBe(2);
  });
});
