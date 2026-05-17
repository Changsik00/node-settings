#!/usr/bin/env node
/**
 * Verify the error catalog is the single source of truth:
 *
 *   1. Every key in ERROR_CATALOG has the expected shape
 *      (severity, title, docsAnchor).
 *   2. Every catalog entry has at least one `raise("CODE", …)` call
 *      site in `src/` (dead-code guard).
 *   3. Every catalog entry's `docsAnchor` resolves to a real
 *      `<a id="…">` (or `## …` heading) in `docs/ERRORS.md`.
 *   4. `docs/ERRORS.md`'s auto-generated catalog section matches what
 *      `scripts/generate-errors-doc.mjs` would produce now.
 *
 * Run AFTER `pnpm build`. Exits non-zero on the first violation.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { ERROR_CATALOG } from "../dist/index.js";
import { renderCatalogSection } from "./lib/errors-doc.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, "..");
const SRC_DIR = resolvePath(ROOT, "src");
const ERRORS_MD = resolvePath(ROOT, "docs/ERRORS.md");

const VALID_SEVERITY = new Set(["config", "runtime", "io", "usage"]);

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
}

// ----- 1. Shape -----
for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
  if (!entry || typeof entry !== "object") {
    fail(`ERROR_CATALOG['${code}'] is not an object.`);
  }
  if (!VALID_SEVERITY.has(entry.severity)) {
    fail(
      `ERROR_CATALOG['${code}'].severity = '${entry.severity}' is not one of ${[...VALID_SEVERITY].join(", ")}.`,
    );
  }
  if (typeof entry.title !== "string" || entry.title.length === 0) {
    fail(`ERROR_CATALOG['${code}'].title must be a non-empty string.`);
  }
  if (typeof entry.docsAnchor !== "string" || !/^[a-z0-9_]+$/.test(entry.docsAnchor)) {
    fail(
      `ERROR_CATALOG['${code}'].docsAnchor must match /^[a-z0-9_]+$/ (got '${entry.docsAnchor}').`,
    );
  }
}

// ----- 2. Every code has at least one raise() call site -----
const sourceText = collectSourceText(SRC_DIR);
for (const code of Object.keys(ERROR_CATALOG)) {
  // Match `raise("CODE"` or `"CODE",` immediately preceded by raise( or new NodeSettingsError(
  const re = new RegExp(
    `(raise\\s*\\(\\s*"${code}"|new NodeSettingsError\\s*\\(\\s*"${code}")`,
  );
  if (!re.test(sourceText)) {
    fail(
      `ERROR_CATALOG['${code}'] is registered but never raised anywhere in src/. Remove it from the catalog or add the throw.`,
    );
  }
}

// ----- 3. Anchors resolve in ERRORS.md -----
const errorsMd = readFileSync(ERRORS_MD, "utf8");
for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
  const idTag = `id="${entry.docsAnchor}"`;
  if (!errorsMd.includes(idTag)) {
    fail(
      `docs/ERRORS.md is missing an <a id="${entry.docsAnchor}"> anchor for '${code}'. Run \`pnpm gen:errors-doc\` to regenerate.`,
    );
  }
}

// ----- 4. Auto-generated section is in sync -----
const expected = renderCatalogSection(ERROR_CATALOG);
const beginMarker = "<!-- BEGIN AUTO-GENERATED:CATALOG -->";
const endMarker = "<!-- END AUTO-GENERATED:CATALOG -->";
const beginIdx = errorsMd.indexOf(beginMarker);
const endIdx = errorsMd.indexOf(endMarker);
if (beginIdx === -1 || endIdx === -1) {
  fail(
    `docs/ERRORS.md is missing the ${beginMarker} / ${endMarker} markers. Run \`pnpm gen:errors-doc\` to write them.`,
  );
}
const actualSection = errorsMd
  .slice(beginIdx + beginMarker.length, endIdx)
  .replace(/^\n|\n$/g, "");
if (actualSection.trim() !== expected.trim()) {
  fail(
    `docs/ERRORS.md auto-generated section is out of date. Run \`pnpm gen:errors-doc\` and commit the result.`,
  );
}

console.log(
  `OK    ${Object.keys(ERROR_CATALOG).length} error codes all wired (raise call + docs anchor + catalog section).`,
);

function collectSourceText(dir) {
  const parts = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = resolvePath(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      parts.push(collectSourceText(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      parts.push(readFileSync(full, "utf8"));
    }
  }
  return parts.join("\n");
}
