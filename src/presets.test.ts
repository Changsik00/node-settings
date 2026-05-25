import { describe, expect, it, vi } from "vitest";
import { inferAppEnv, inferAppEnvDetailed, presets } from "./presets.js";

describe("inferAppEnv", () => {
  it("returns explicit APP_ENV from source when set", () => {
    expect(
      inferAppEnv({
        source: { APP_ENV: "stage" },
        presets: [presets.vercel()],
      }),
    ).toBe("stage");
  });

  it("falls through to presets when APP_ENV is unset", () => {
    expect(
      inferAppEnv({
        source: { VERCEL_ENV: "production" },
        presets: [presets.vercel()],
      }),
    ).toBe("prod");
  });

  it("returns default when nothing matches", () => {
    expect(
      inferAppEnv({
        source: {},
        presets: [presets.vercel()],
        default: "local",
      }),
    ).toBe("local");
  });

  it("tries presets in order, first match wins", () => {
    expect(
      inferAppEnv({
        source: { VERCEL_ENV: "production", NODE_ENV: "development" },
        presets: [presets.nodeEnv(), presets.vercel()],
      }),
    ).toBe("local");
  });

  it("inferAppEnvDetailed reports the source", () => {
    expect(
      inferAppEnvDetailed({
        source: { VERCEL_ENV: "preview" },
        presets: [presets.vercel()],
      }),
    ).toEqual({
      value: "stage",
      source: "preset",
      presetName: "vercel",
    });
    expect(
      inferAppEnvDetailed({ source: { APP_ENV: "x" } }),
    ).toEqual({ value: "x", source: "explicit", presetName: undefined });
    expect(inferAppEnvDetailed({ source: {}, default: "local" })).toEqual({
      value: "local",
      source: "default",
      presetName: undefined,
    });
  });
});

describe("presets", () => {
  describe("vercel", () => {
    it("maps VERCEL_ENV values to defaults", () => {
      const p = presets.vercel();
      expect(p.detect({ VERCEL_ENV: "production" })).toBe("prod");
      expect(p.detect({ VERCEL_ENV: "preview" })).toBe("stage");
      expect(p.detect({ VERCEL_ENV: "development" })).toBe("local");
      expect(p.detect({})).toBeUndefined();
    });

    it("accepts overrides", () => {
      const p = presets.vercel({ preview: "preview", development: "dev" });
      expect(p.detect({ VERCEL_ENV: "preview" })).toBe("preview");
      expect(p.detect({ VERCEL_ENV: "development" })).toBe("dev");
    });

    it("warns and returns undefined when VERCEL_ENV is set but unrecognized", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const p = presets.vercel();
      expect(p.detect({ VERCEL_ENV: "staging" })).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain("VERCEL_ENV");
      expect(warn.mock.calls[0][0]).toContain("staging");
      warn.mockRestore();
    });

    it("does not warn when VERCEL_ENV is absent", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const p = presets.vercel();
      p.detect({});
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("netlify", () => {
    it("maps CONTEXT values to defaults", () => {
      const p = presets.netlify();
      expect(p.detect({ CONTEXT: "production" })).toBe("prod");
      expect(p.detect({ CONTEXT: "deploy-preview" })).toBe("stage");
      expect(p.detect({ CONTEXT: "branch-deploy" })).toBe("dev");
      expect(p.detect({ CONTEXT: "dev" })).toBe("local");
      expect(p.detect({ CONTEXT: "unknown" })).toBeUndefined();
    });

    it("warns when CONTEXT is set but unrecognized", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const p = presets.netlify();
      expect(p.detect({ CONTEXT: "unknown" })).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain("CONTEXT");
      expect(warn.mock.calls[0][0]).toContain("unknown");
      warn.mockRestore();
    });
  });

  describe("cloudflarePages", () => {
    it("requires CF_PAGES=1", () => {
      const p = presets.cloudflarePages();
      expect(p.detect({ CF_PAGES_BRANCH: "main" })).toBeUndefined();
    });

    it("maps production branch to prod, others to dev", () => {
      const p = presets.cloudflarePages();
      expect(p.detect({ CF_PAGES: "1", CF_PAGES_BRANCH: "main" })).toBe("prod");
      expect(p.detect({ CF_PAGES: "1", CF_PAGES_BRANCH: "feature" })).toBe(
        "dev",
      );
    });

    it("accepts a custom production branch", () => {
      const p = presets.cloudflarePages({ productionBranch: "release" });
      expect(p.detect({ CF_PAGES: "1", CF_PAGES_BRANCH: "release" })).toBe(
        "prod",
      );
      expect(p.detect({ CF_PAGES: "1", CF_PAGES_BRANCH: "main" })).toBe("dev");
    });
  });

  describe("githubActions", () => {
    it("requires GITHUB_ACTIONS=true", () => {
      const p = presets.githubActions();
      expect(p.detect({ GITHUB_REF_NAME: "main" })).toBeUndefined();
    });

    it("maps configured branches and falls back to default", () => {
      const p = presets.githubActions({
        branchToMode: { main: "prod", staging: "stage" },
        default: "dev",
      });
      expect(
        p.detect({ GITHUB_ACTIONS: "true", GITHUB_REF_NAME: "main" }),
      ).toBe("prod");
      expect(
        p.detect({ GITHUB_ACTIONS: "true", GITHUB_REF_NAME: "staging" }),
      ).toBe("stage");
      expect(
        p.detect({ GITHUB_ACTIONS: "true", GITHUB_REF_NAME: "feature/x" }),
      ).toBe("dev");
    });

    it("falls back to parsing GITHUB_REF when GITHUB_REF_NAME is absent", () => {
      const p = presets.githubActions({ branchToMode: { main: "prod" } });
      expect(
        p.detect({
          GITHUB_ACTIONS: "true",
          GITHUB_REF: "refs/heads/main",
        }),
      ).toBe("prod");
    });
  });

  describe("railway", () => {
    it("maps RAILWAY_ENVIRONMENT_NAME and falls back to RAILWAY_ENVIRONMENT", () => {
      const p = presets.railway();
      expect(p.detect({ RAILWAY_ENVIRONMENT_NAME: "production" })).toBe("prod");
      expect(p.detect({ RAILWAY_ENVIRONMENT: "staging" })).toBe("stage");
    });

    it("warns when RAILWAY_ENVIRONMENT_NAME is set but unrecognized", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const p = presets.railway();
      expect(p.detect({ RAILWAY_ENVIRONMENT_NAME: "custom" })).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain("RAILWAY_ENVIRONMENT_NAME");
      expect(warn.mock.calls[0][0]).toContain("custom");
      warn.mockRestore();
    });
  });

  describe("render", () => {
    it("maps Render production vs PR preview", () => {
      const p = presets.render();
      expect(p.detect({ RENDER: "true" })).toBe("prod");
      expect(p.detect({ RENDER: "true", IS_PULL_REQUEST: "true" })).toBe(
        "stage",
      );
      expect(p.detect({})).toBeUndefined();
    });
  });

  describe("nodeEnv", () => {
    it("maps NODE_ENV values", () => {
      const p = presets.nodeEnv();
      expect(p.detect({ NODE_ENV: "production" })).toBe("prod");
      expect(p.detect({ NODE_ENV: "development" })).toBe("local");
      expect(p.detect({ NODE_ENV: "test" })).toBe("test");
      expect(p.detect({ NODE_ENV: "other" })).toBeUndefined();
    });

    it("warns when NODE_ENV is set but unrecognized", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const p = presets.nodeEnv();
      expect(p.detect({ NODE_ENV: "other" })).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain("NODE_ENV");
      expect(warn.mock.calls[0][0]).toContain("other");
      warn.mockRestore();
    });
  });
});
