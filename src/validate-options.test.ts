import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSettings } from "./define-settings.js";
import { NodeSettingsError } from "./errors.js";

describe("defensive validations at defineSettings time", () => {
  it("rejects envSchema that is not a ZodObject", () => {
    expect(() =>
      defineSettings({
        // a non-object schema (zod 4 keeps refined objects as ZodObject, so
        // we need a clearly non-object shape to trigger the validation)
        envSchema: z.string() as unknown as z.ZodObject<z.ZodRawShape>,
        envKey: "APP_ENV",
        defaults: {},
        perEnv: { local: {} },
        build: () => ({}),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_ENV_SCHEMA",
      }) as unknown as Error,
    );
  });

  it("rejects an envKey that is not present in the schema", () => {
    try {
      defineSettings({
        envSchema: z.object({ APP_ENV: z.enum(["local"]).default("local") }),
        envKey: "NODE_ENV" as never,
        defaults: {},
        perEnv: { local: {} },
        build: () => ({}),
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(NodeSettingsError);
      expect((err as NodeSettingsError).code).toBe("MISSING_ENV_KEY");
    }
  });

  it("rejects an envKey whose underlying type is not string/enum", () => {
    try {
      defineSettings({
        envSchema: z.object({
          APP_ENV: z.coerce.number().default(1),
        }),
        envKey: "APP_ENV" as never,
        defaults: {},
        perEnv: { "1": {} },
        build: () => ({}),
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as NodeSettingsError).code).toBe("INVALID_ENV_KEY_TYPE");
    }
  });

  it("rejects perEnv that is empty", () => {
    try {
      defineSettings({
        envSchema: z.object({ APP_ENV: z.enum(["local"]).default("local") }),
        envKey: "APP_ENV",
        defaults: {},
        perEnv: {},
        build: () => ({}),
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as NodeSettingsError).code).toBe("PER_ENV_EMPTY");
    }
  });

  it("rejects perEnv branch keys that are not in the envKey enum", () => {
    try {
      defineSettings({
        envSchema: z.object({
          APP_ENV: z.enum(["local", "prod"]).default("local"),
        }),
        envKey: "APP_ENV",
        defaults: {},
        perEnv: { local: {}, prouction: {} }, // typo
        build: () => ({}),
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as NodeSettingsError).code).toBe("PER_ENV_KEY_NOT_IN_ENUM");
      expect((err as NodeSettingsError).message).toMatch(/prouction/);
    }
  });

  it("rejects overrideEnvKey that is not in the schema", () => {
    try {
      defineSettings({
        envSchema: z.object({ APP_ENV: z.enum(["local"]).default("local") }),
        envKey: "APP_ENV",
        overrideEnvKey: "MISSING_KEY" as never,
        defaults: {},
        perEnv: { local: {} },
        build: () => ({}),
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as NodeSettingsError).code).toBe("INVALID_OVERRIDE_KEY");
    }
  });

  it("rejects an extends array containing a non-loader value", () => {
    try {
      defineSettings({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extends: [{} as any],
        envSchema: z.object({ APP_ENV: z.enum(["local"]).default("local") }),
        envKey: "APP_ENV",
        defaults: {},
        perEnv: { local: {} },
        build: () => ({}),
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as NodeSettingsError).code).toBe("INVALID_EXTENDS_ITEM");
    }
  });

  it("wraps zod env validation errors as ENV_VALIDATION_FAILED", () => {
    const settings = defineSettings({
      envSchema: z.object({
        APP_ENV: z.enum(["local"]).default("local"),
        DB_HOST: z.string(),
      }),
      envKey: "APP_ENV",
      defaults: {},
      perEnv: { local: {} },
      build: (env) => ({ host: env.DB_HOST }),
    });
    try {
      settings({});
      throw new Error("expected throw");
    } catch (err) {
      expect((err as NodeSettingsError).code).toBe("ENV_VALIDATION_FAILED");
      expect((err as NodeSettingsError).message).toMatch(/DB_HOST/);
    }
  });

  it("wraps invalid override JSON as OVERRIDE_JSON_PARSE", () => {
    const settings = defineSettings({
      envSchema: z.object({
        APP_ENV: z.enum(["local"]).default("local"),
        OVERRIDE: z.string().optional(),
      }),
      envKey: "APP_ENV",
      overrideEnvKey: "OVERRIDE",
      defaults: {},
      perEnv: { local: {} },
      build: () => ({}),
    });
    try {
      settings({ OVERRIDE: "{not json" });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as NodeSettingsError).code).toBe("OVERRIDE_JSON_PARSE");
    }
  });

  describe("envKey type unwrapping", () => {
    it("accepts a plain ZodString envKey", () => {
      const settings = defineSettings({
        envSchema: z.object({
          APP_ENV: z.string().default("local"),
          DB_HOST: z.string(),
        }),
        envKey: "APP_ENV",
        defaults: {},
        perEnv: { local: { x: 1 }, prod: { x: 2 } },
        build: (env, config) => ({ host: env.DB_HOST, x: config.x }),
      });
      const cfg = settings({ APP_ENV: "local", DB_HOST: "h" });
      expect(cfg.x).toBe(1);
    });

    it("unwraps ZodOptional around envKey", () => {
      const settings = defineSettings({
        envSchema: z.object({
          APP_ENV: z.enum(["local", "prod"]).optional().default("local"),
          DB_HOST: z.string(),
        }),
        envKey: "APP_ENV",
        defaults: {},
        perEnv: { local: { x: 1 }, prod: { x: 2 } },
        build: (env, config) => ({ host: env.DB_HOST, x: config.x }),
      });
      expect(settings({ DB_HOST: "h" }).x).toBe(1);
    });

    it("unwraps ZodNullable around envKey", () => {
      // Nullable wraps the enum so unwrapWrappers must peel it off.
      const settings = defineSettings({
        envSchema: z.object({
          APP_ENV: z.enum(["local"]).nullable().default("local" as never),
          DB_HOST: z.string(),
        }),
        envKey: "APP_ENV",
        defaults: {},
        perEnv: { local: {} },
        build: (env) => ({ host: env.DB_HOST }),
      });
      expect(settings({ DB_HOST: "h" }).host).toBe("h");
    });
  });

  describe("ZodNativeEnum envKey", () => {
    enum AppEnv {
      Local = "local",
      Prod = "prod",
    }

    it("accepts a ZodNativeEnum envKey + matching perEnv branches", () => {
      const settings = defineSettings({
        envSchema: z.object({
          APP_ENV: z.nativeEnum(AppEnv).default(AppEnv.Local),
          DB_HOST: z.string(),
        }),
        envKey: "APP_ENV",
        defaults: { x: 0 },
        perEnv: { local: { x: 1 }, prod: { x: 2 } },
        build: (env, config) => ({ host: env.DB_HOST, x: config.x }),
      });
      expect(settings({ DB_HOST: "h" }).x).toBe(1);
    });

    it("rejects perEnv branch not in the ZodNativeEnum values", () => {
      try {
        defineSettings({
          envSchema: z.object({
            APP_ENV: z.nativeEnum(AppEnv).default(AppEnv.Local),
          }),
          envKey: "APP_ENV",
          defaults: {},
          // intentional typo: not a value of AppEnv
          perEnv: { local: {}, staging: {} },
          build: () => ({}),
        });
        throw new Error("expected throw");
      } catch (err) {
        expect((err as NodeSettingsError).code).toBe(
          "PER_ENV_KEY_NOT_IN_ENUM",
        );
        // zod 4 unifies ZodEnum / ZodNativeEnum — message simplified to "enum".
        expect((err as NodeSettingsError).message).toMatch(/enum/);
        expect((err as NodeSettingsError).message).toMatch(/staging/);
      }
    });
  });
});
