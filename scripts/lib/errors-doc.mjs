/**
 * Shared catalog-doc rendering used by both
 * `scripts/generate-errors-doc.mjs` (writer) and
 * `scripts/verify-errors.mjs` (drift detector).
 *
 * The output goes between the
 *   <!-- BEGIN AUTO-GENERATED:CATALOG -->
 *   <!-- END AUTO-GENERATED:CATALOG -->
 * markers in docs/ERRORS.md. Everything outside the markers is
 * hand-curated and not touched.
 */

const SEVERITY_ORDER = ["config", "runtime", "io", "usage"];

const SEVERITY_HEADERS = {
  config: {
    title: "Configuration errors (raised at `defineSettings(...)` time)",
    blurb:
      "Misconfiguration in the developer's source. Surfaces at module-load time so it can never reach production.",
  },
  runtime: {
    title: "Runtime errors (raised when the loader is called)",
    blurb:
      "Bad env values at boot. The deployment environment must provide them; the developer's code is fine.",
  },
  io: {
    title: "I/O errors (CLI and filesystem helpers)",
    blurb:
      "Filesystem / parse failures from the CLI or `loadDotenv*`. The original error is preserved on `cause`.",
  },
  usage: {
    title: "Usage errors (the API was called incorrectly)",
    blurb:
      "The caller wired up `@env-kit/node-settings` in a way the library can't honour. Code-review-time bugs.",
  },
};

/**
 * Render the auto-generated catalog body. Returns a markdown string
 * with no leading or trailing newline; the caller inserts it between
 * the BEGIN / END markers as-is.
 */
export function renderCatalogSection(catalog) {
  const grouped = groupBySeverity(catalog);
  const blocks = [];
  for (const severity of SEVERITY_ORDER) {
    const entries = grouped[severity];
    if (!entries || entries.length === 0) continue;
    const header = SEVERITY_HEADERS[severity];
    blocks.push(`### ${header.title}`);
    blocks.push("");
    blocks.push(header.blurb);
    blocks.push("");
    blocks.push("| Code | Anchor | Title |");
    blocks.push("| --- | --- | --- |");
    for (const [code, entry] of entries) {
      blocks.push(
        `| \`${code}\` | <a id="${entry.docsAnchor}"></a>[#${entry.docsAnchor}](#${entry.docsAnchor}) | ${entry.title} |`,
      );
    }
    blocks.push("");
  }
  return blocks.join("\n").replace(/\n+$/, "");
}

function groupBySeverity(catalog) {
  const out = { config: [], runtime: [], io: [], usage: [] };
  for (const [code, entry] of Object.entries(catalog)) {
    out[entry.severity].push([code, entry]);
  }
  // Keep insertion order within each bucket.
  return out;
}
