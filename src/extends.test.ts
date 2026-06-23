import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSettings } from "./define-settings.js";

const baseEnvSchema = z.object({
  APP_ENV: z.enum(["local", "dev", "prod"]).default("local"),
  DB_HOST: z.string().describe("primary db"),
  DB_PASSWORD: z.string(),
});

interface BaseConfig {
  region: string;
  logLevel: string;
}

const base = defineSettings({
  envSchema: baseEnvSchema,
  envKey: "APP_ENV",
  defaults: { region: "us-east-1", logLevel: "info" } as BaseConfig,
  perEnv: {
    local: { logLevel: "debug" },
    dev: {},
    prod: {},
  },
  build: (env, config) => ({
    dbHost: env.DB_HOST,
    region: config.region,
    logLevel: config.logLevel,
  }),
});

describe("defineSettings — extends", () => {
  it("merges parent envSchema and child envSchema", () => {
    const child = defineSettings({
      extends: [base],
      envSchema: z.object({ CONTENT_BUCKET: z.string() }),
      envKey: "APP_ENV",
      defaults: { bucket: "" },
      perEnv: {
        local: { bucket: "local-content" },
        dev: { bucket: "dev-content" },
        prod: { bucket: "prod-content" },
      },
      build: (env, config) => ({
        dbHost: env.DB_HOST,
        contentBucket: env.CONTENT_BUCKET,
        bucket: config.bucket,
        region: config.region,
      }),
    });

    const settings = child({
      DB_HOST: "h",
      DB_PASSWORD: "p",
      CONTENT_BUCKET: "b",
    });
    expect(settings.dbHost).toBe("h");
    expect(settings.contentBucket).toBe("b");
    expect(settings.bucket).toBe("local-content");
    expect(settings.region).toBe("us-east-1");
  });

  it("deep-merges parent defaults under child defaults", () => {
    const child = defineSettings({
      extends: [base],
      envSchema: z.object({}),
      envKey: "APP_ENV",
      defaults: { bucket: "x" }, // doesn't redefine region/logLevel
      perEnv: { local: {}, dev: {}, prod: {} },
      build: (_env, config) => config,
    });
    expect(child.resolved.defaults).toMatchObject({
      region: "us-east-1",
      logLevel: "info",
      bucket: "x",
    });
  });

  it("merges parent perEnv with child perEnv", () => {
    const child = defineSettings({
      extends: [base],
      envSchema: z.object({}),
      envKey: "APP_ENV",
      defaults: { bucket: "" },
      perEnv: {
        local: { bucket: "local-b" },
        prod: { bucket: "prod-b" },
        dev: {},
      },
      build: (_env, config) => config,
    });
    const s = child({ DB_HOST: "h", DB_PASSWORD: "p" });
    expect(s).toMatchObject({
      bucket: "local-b",
      logLevel: "debug", // inherited from base.perEnv.local
      region: "us-east-1", // inherited from base.defaults
    });
  });

  it("child default wins on key collision with parent default", () => {
    const child = defineSettings({
      extends: [base],
      envSchema: z.object({}),
      envKey: "APP_ENV",
      defaults: { region: "eu-west-1", logLevel: "info" },
      perEnv: { local: {}, dev: {}, prod: {} },
      build: (_env, config) => config,
    });
    expect(child.resolved.defaults.region).toBe("eu-west-1");
  });

  it("envFields reflect the merged schema", () => {
    const child = defineSettings({
      extends: [base],
      envSchema: z.object({ CONTENT_BUCKET: z.string() }),
      envKey: "APP_ENV",
      defaults: { bucket: "" },
      perEnv: { local: {}, dev: {}, prod: {} },
      build: () => ({}),
    });
    const keys = child.envFields.map((f) => f.key);
    expect(keys).toContain("DB_HOST");
    expect(keys).toContain("DB_PASSWORD");
    expect(keys).toContain("APP_ENV");
    expect(keys).toContain("CONTENT_BUCKET");
  });

  it("inherits overrideEnvKey from parent when child omits it", () => {
    const withOverride = defineSettings({
      envSchema: z.object({
        APP_ENV: z.enum(["local"]).default("local"),
        CONFIG_OVERRIDE_JSON: z.string().optional(),
        DB_HOST: z.string(),
      }),
      envKey: "APP_ENV",
      overrideEnvKey: "CONFIG_OVERRIDE_JSON",
      defaults: { bucket: "" },
      perEnv: { local: { bucket: "x" } },
      build: (_env, config) => config,
    });
    const child = defineSettings({
      extends: [withOverride],
      envSchema: z.object({}),
      envKey: "APP_ENV",
      defaults: { extra: 1 },
      perEnv: { local: {} },
      build: (_env, config) => config,
    });
    expect(child.resolved.overrideEnvKey).toBe("CONFIG_OVERRIDE_JSON");
    const s = child({
      DB_HOST: "h",
      CONFIG_OVERRIDE_JSON: JSON.stringify({ bucket: "overridden" }),
    });
    expect((s as { bucket: string }).bucket).toBe("overridden");
  });

  it("inherits and merges envOverrides from parent", () => {
    const parent = defineSettings({
      envSchema: z.object({
        APP_ENV: z.enum(["local"]).default("local"),
        DB_HOST: z.string(),
        TIMEOUT: z.coerce.number().optional(),
      }),
      envKey: "APP_ENV",
      defaults: { timeout: 1000 },
      perEnv: { local: {} },
      envOverrides: { TIMEOUT: "timeout" },
      build: (_env, config) => config,
    });
    const child = defineSettings({
      extends: [parent],
      envSchema: z.object({ PAGE_SIZE: z.coerce.number().optional() }),
      envKey: "APP_ENV",
      defaults: { pageSize: 10 },
      perEnv: { local: {} },
      envOverrides: { PAGE_SIZE: "pageSize" },
      build: (_env, config) => config,
    });
    // Child inherits the parent's mapping and adds its own.
    expect(child.resolved.envOverrides).toEqual({
      TIMEOUT: "timeout",
      PAGE_SIZE: "pageSize",
    });
    const s = child({ DB_HOST: "h", TIMEOUT: "2000", PAGE_SIZE: "25" });
    expect((s as { timeout: number }).timeout).toBe(2000);
    expect((s as { pageSize: number }).pageSize).toBe(25);
  });

  it("supports multiple parents (merged in array order)", () => {
    const a = defineSettings({
      envSchema: z.object({
        APP_ENV: z.enum(["local"]).default("local"),
        A_KEY: z.string(),
      }),
      envKey: "APP_ENV",
      defaults: { fromA: "a" },
      perEnv: { local: {} },
      build: (_env, config) => config,
    });
    const b = defineSettings({
      envSchema: z.object({
        APP_ENV: z.enum(["local"]).default("local"),
        B_KEY: z.string(),
      }),
      envKey: "APP_ENV",
      defaults: { fromB: "b" },
      perEnv: { local: {} },
      build: (_env, config) => config,
    });
    const child = defineSettings({
      extends: [a, b],
      envSchema: z.object({ C_KEY: z.string() }),
      envKey: "APP_ENV",
      defaults: { fromChild: "c" },
      perEnv: { local: {} },
      build: (_env, config) => config,
    });

    const result = child({ A_KEY: "x", B_KEY: "y", C_KEY: "z" });
    expect(result).toMatchObject({ fromA: "a", fromB: "b", fromChild: "c" });
    expect(child.envFields.map((f) => f.key).sort()).toEqual(
      ["APP_ENV", "A_KEY", "B_KEY", "C_KEY"].sort(),
    );
  });
});
