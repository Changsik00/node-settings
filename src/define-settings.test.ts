import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineSettings } from "./define-settings.js";

const envSchema = z.object({
  APP_ENV: z.enum(["local", "dev", "prod"]).default("local"),
  DB_HOST: z.string().describe("Primary database host"),
  DB_PASSWORD: z.string(),
  CONFIG_OVERRIDE_JSON: z.string().optional(),
});

interface AppConfig {
  bucket: string;
  workerConcurrency: number;
  logLevel: string;
}

const defaults: AppConfig = {
  bucket: "",
  workerConcurrency: 1,
  logLevel: "info",
};

const perEnv = {
  local: { bucket: "local-bucket" },
  dev: { bucket: "dev-bucket" },
  prod: { bucket: "TODO-prod-bucket" },
};

const baseEnv = { DB_HOST: "127.0.0.1", DB_PASSWORD: "x" };

describe("defineSettings", () => {
  it("validates env, layers config, freezes the result", () => {
    const settings = defineSettings({
      envSchema,
      envKey: "APP_ENV",
      defaults,
      perEnv,
      build: (env, config) => ({
        dbHost: env.DB_HOST,
        bucket: config.bucket,
        workerConcurrency: config.workerConcurrency,
      }),
    });
    const s = settings(baseEnv);
    expect(s.dbHost).toBe("127.0.0.1");
    expect(s.bucket).toBe("local-bucket");
    expect(s.workerConcurrency).toBe(1);
    expect(Object.isFrozen(s)).toBe(true);
  });

  it("selects the per-env branch matching envKey", () => {
    const settings = defineSettings({
      envSchema,
      envKey: "APP_ENV",
      defaults,
      perEnv,
      build: (_env, config) => ({ bucket: config.bucket }),
    });
    expect(settings({ ...baseEnv, APP_ENV: "dev" }).bucket).toBe("dev-bucket");
  });

  it("throws when the envKey value has no matching perEnv branch", () => {
    const schema = z.object({
      APP_ENV: z.enum(["local", "stage"]).default("local"),
      DB_HOST: z.string(),
    });
    const settings = defineSettings({
      envSchema: schema,
      envKey: "APP_ENV",
      defaults,
      perEnv: { local: {} },
      build: (_env, config) => config,
    });
    expect(() => settings({ ...baseEnv, APP_ENV: "stage" })).toThrow(
      /perEnv has no branch for 'stage'/,
    );
    try {
      settings({ ...baseEnv, APP_ENV: "stage" });
    } catch (err) {
      expect((err as { code?: string }).code).toBe("PER_ENV_BRANCH_MISSING");
    }
  });

  it("applies CONFIG_OVERRIDE_JSON as the top layer", () => {
    const settings = defineSettings({
      envSchema,
      envKey: "APP_ENV",
      overrideEnvKey: "CONFIG_OVERRIDE_JSON",
      defaults,
      perEnv,
      build: (_env, config) => ({
        bucket: config.bucket,
        workerConcurrency: config.workerConcurrency,
      }),
    });
    const s = settings({
      ...baseEnv,
      CONFIG_OVERRIDE_JSON: JSON.stringify({
        bucket: "override",
        workerConcurrency: 5,
      }),
    });
    expect(s.bucket).toBe("override");
    expect(s.workerConcurrency).toBe(5);
  });

  it("throws on malformed override JSON", () => {
    const settings = defineSettings({
      envSchema,
      envKey: "APP_ENV",
      overrideEnvKey: "CONFIG_OVERRIDE_JSON",
      defaults,
      perEnv,
      build: (_env, config) => config,
    });
    expect(() =>
      settings({ ...baseEnv, CONFIG_OVERRIDE_JSON: "{invalid" }),
    ).toThrow(/override JSON parse failed/);
  });

  it.each([
    ["array",  JSON.stringify(["bucket", "timeout"])],
    ["string", JSON.stringify("just a string")],
    ["number", JSON.stringify(42)],
    ["null",   "null"],
  ])("throws OVERRIDE_JSON_NOT_OBJECT when override JSON is a %s", (_label, value) => {
    const settings = defineSettings({
      envSchema,
      envKey: "APP_ENV",
      overrideEnvKey: "CONFIG_OVERRIDE_JSON",
      defaults,
      perEnv,
      build: (_env, config) => config,
    });
    expect(() =>
      settings({ ...baseEnv, CONFIG_OVERRIDE_JSON: value }),
    ).toThrow(/override JSON must be a plain object/);
  });

  it("runs validateOverride to reject unknown keys", () => {
    const settings = defineSettings({
      envSchema,
      envKey: "APP_ENV",
      overrideEnvKey: "CONFIG_OVERRIDE_JSON",
      defaults,
      perEnv,
      validateOverride: (parsed) => {
        const allowed = new Set(["bucket", "workerConcurrency", "logLevel"]);
        const obj = parsed as Record<string, unknown>;
        const unknown = Object.keys(obj).filter((k) => !allowed.has(k));
        if (unknown.length > 0) {
          throw new Error(`Unknown override key(s): ${unknown.join(", ")}`);
        }
        return obj as Partial<AppConfig>;
      },
      build: (_env, config) => config,
    });
    expect(() =>
      settings({
        ...baseEnv,
        CONFIG_OVERRIDE_JSON: JSON.stringify({ bukcet: "typo" }),
      }),
    ).toThrow(/Unknown override key/);
  });

  it("invokes onOverride when an override applies", () => {
    const onOverride = vi.fn();
    const settings = defineSettings({
      envSchema,
      envKey: "APP_ENV",
      overrideEnvKey: "CONFIG_OVERRIDE_JSON",
      defaults,
      perEnv,
      onOverride,
      build: (_env, config) => config,
    });
    settings({
      ...baseEnv,
      CONFIG_OVERRIDE_JSON: JSON.stringify({ bucket: "alt" }),
    });
    expect(onOverride).toHaveBeenCalledTimes(1);
    expect(onOverride).toHaveBeenCalledWith({ bucket: "alt" }, "local");
  });

  it("throws OVERRIDE_ENV_EMPTY when override env var is whitespace-only", () => {
    const settings = defineSettings({
      envSchema,
      envKey: "APP_ENV",
      overrideEnvKey: "CONFIG_OVERRIDE_JSON",
      defaults,
      perEnv,
      build: (_env, config) => config,
    });
    for (const ws of [" ", "   ", "\t", "\n", "  \t  "]) {
      expect(() =>
        settings({ ...baseEnv, CONFIG_OVERRIDE_JSON: ws }),
      ).toThrow(expect.objectContaining({ code: "OVERRIDE_ENV_EMPTY" }));
    }
  });

  it("skips onOverride when the override env is empty / unset", () => {
    const onOverride = vi.fn();
    const settings = defineSettings({
      envSchema,
      envKey: "APP_ENV",
      overrideEnvKey: "CONFIG_OVERRIDE_JSON",
      defaults,
      perEnv,
      onOverride,
      build: (_env, config) => config,
    });
    settings({ ...baseEnv, CONFIG_OVERRIDE_JSON: "" });
    settings(baseEnv);
    expect(onOverride).not.toHaveBeenCalled();
  });

  it("surfaces zod errors when required env vars are missing", () => {
    const settings = defineSettings({
      envSchema,
      envKey: "APP_ENV",
      defaults,
      perEnv,
      build: (_env, config) => config,
    });
    expect(() => settings({})).toThrow();
  });

  it("attaches opts and envFields for tooling", () => {
    const settings = defineSettings({
      envSchema,
      envKey: "APP_ENV",
      defaults,
      perEnv,
      build: (_env, config) => config,
    });
    expect(settings.opts.envKey).toBe("APP_ENV");
    expect(settings.envFields.map((f) => f.key)).toContain("DB_HOST");
    const dbHost = settings.envFields.find((f) => f.key === "DB_HOST");
    expect(dbHost?.description).toBe("Primary database host");
    expect(dbHost?.secret).toBe(false);
    const password = settings.envFields.find((f) => f.key === "DB_PASSWORD");
    expect(password?.secret).toBe(true);
  });
});
