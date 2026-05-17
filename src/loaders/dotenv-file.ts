import { readFileSync } from "node:fs";
import { raise } from "../errors.js";

/**
 * Minimal `.env` file parser used by the CLI for `validate` / `check`.
 *
 * Supports the common subset of dotenv syntax:
 *   - `KEY=value`
 *   - Surrounding double or single quotes (stripped)
 *   - Lines starting with `#` are comments
 *   - Inline `#` comments after an unquoted value
 *   - Blank lines ignored
 *
 * Anything more exotic (variable expansion, multi-line values) is
 * deliberately out of scope. Use dotenv-expand etc. before piping the
 * result into `loadSettings(...)` if you need it.
 */
export function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Read a `.env`-style file from disk and return its parsed key/value map.
 *
 * Filesystem failures are wrapped in `NodeSettingsError` with code
 * `FILE_READ_FAILED` so callers can distinguish them from validation
 * errors. The original error (e.g. ENOENT, EACCES) is preserved on `cause`.
 */
export function loadDotenvFile(path: string): Record<string, string> {
  return parseDotenv(readDotenvSafe(path));
}

export function readDotenvSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    raise(
      "FILE_READ_FAILED",
      `failed to read dotenv file ${path}: ${err instanceof Error ? err.message : String(err)}`,
      {
        hint: "Check that the file exists and the process has read permission. Pass a different path with --env-file or fix the file's permissions.",
        cause: err,
      },
    );
  }
}
