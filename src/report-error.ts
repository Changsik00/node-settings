import { z } from "zod";
import {
  NodeSettingsError,
  ERROR_CATALOG,
  DEFAULT_DOCS_BASE,
  type ErrorSeverity,
  type NodeSettingsErrorCode,
} from "./errors.js";
import { zodIssuesOf, type ZodIssueSummary } from "./utils/zod-issues.js";

/**
 * Structured, JSON-serialisable view of a thrown error. The shape
 * intentionally mirrors common API-error responses (Stripe / Google
 * Cloud / etc.): one record with stable `code`, severity, message,
 * actionable hint, and a docs URL.
 *
 * The CLI emits this in `--format=json` output; library consumers can
 * use it to feed log aggregators, Sentry breadcrumbs, etc.
 */
export interface ErrorReport {
  /** The stable error code, or `"UNKNOWN"` when `err` is not a recognised throw. */
  code: NodeSettingsErrorCode | "UNKNOWN";
  /** Severity bucket — see {@link ErrorSeverity}. `"unknown"` for unrecognised throws. */
  severity: ErrorSeverity | "unknown";
  /** Short human title (from {@link ERROR_CATALOG}). */
  title: string;
  /** Full diagnostic message, including the `hint:` line if present. */
  message: string;
  /** Remediation tip — what the caller should change to fix this. */
  hint?: string;
  /** Direct link to the long-form doc entry for this code. */
  docsUrl: string;
  /** Path/message pairs when the underlying cause was a `ZodError`. */
  issues?: ZodIssueSummary[];
  /** Wrapped cause, distilled to name + message for safe serialisation. */
  cause?: { name: string; message: string };
}

export interface ReportErrorOptions {
  /**
   * Override the base URL for `docsUrl`. Useful when a downstream tool
   * re-hosts the docs (`https://internal.example.com/node-settings/ERRORS.md`).
   * Default: {@link DEFAULT_DOCS_BASE}.
   */
  docsBase?: string;
}

/**
 * Convert any thrown value into a structured {@link ErrorReport}.
 *
 *   - `NodeSettingsError` — full report from the catalog.
 *   - `ZodError`           — synthesised report with code `ENV_VALIDATION_FAILED`
 *                            and the issues array populated.
 *   - anything else        — `code: 'UNKNOWN'`, severity `'unknown'`.
 *
 * The returned object is plain JSON (`JSON.stringify` round-trips
 * cleanly), so logging frameworks and the CLI's `--format=json` mode
 * can ship it directly.
 *
 * @example
 * ```ts
 * try {
 *   const cfg = settings(process.env);
 * } catch (err) {
 *   const report = reportError(err);
 *   if (report.severity === "runtime") {
 *     console.error(`[boot] ${report.title}: see ${report.docsUrl}`);
 *   }
 *   throw err;
 * }
 * ```
 */
export function reportError(
  err: unknown,
  options: ReportErrorOptions = {},
): ErrorReport {
  const docsBase = options.docsBase ?? DEFAULT_DOCS_BASE;

  if (err instanceof NodeSettingsError) {
    const entry = ERROR_CATALOG[err.code];
    const report: ErrorReport = {
      code: err.code,
      severity: entry.severity,
      title: entry.title,
      message: err.message,
      docsUrl: `${docsBase}#${entry.docsAnchor}`,
    };
    if (err.hint) report.hint = err.hint;
    if (err.cause instanceof z.ZodError) {
      report.issues = zodIssuesOf(err.cause);
    }
    if (err.cause instanceof Error) {
      report.cause = { name: err.cause.name, message: err.cause.message };
    }
    return report;
  }

  if (err instanceof z.ZodError) {
    const entry = ERROR_CATALOG.ENV_VALIDATION_FAILED;
    return {
      code: "ENV_VALIDATION_FAILED",
      severity: entry.severity,
      title: entry.title,
      message: err.message,
      docsUrl: `${docsBase}#${entry.docsAnchor}`,
      issues: zodIssuesOf(err),
    };
  }

  return {
    code: "UNKNOWN",
    severity: "unknown",
    title: "Unknown error",
    message: err instanceof Error ? err.message : String(err),
    docsUrl: docsBase,
  };
}
