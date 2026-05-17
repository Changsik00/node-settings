#!/usr/bin/env node
/**
 * Regenerate the auto-managed section of `docs/ERRORS.md` from
 * `ERROR_CATALOG`. Run via `pnpm gen:errors-doc`.
 *
 * The script only touches the slice between
 *   <!-- BEGIN AUTO-GENERATED:CATALOG -->
 *   <!-- END AUTO-GENERATED:CATALOG -->
 * markers — everything outside is preserved as hand-written prose.
 *
 * If the markers aren't present yet, the script inserts them
 * (along with the catalog body) at the end of the file.
 *
 * Requires `pnpm build` to have run, because the catalog is imported
 * from `dist/`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { ERROR_CATALOG } from "../dist/index.js";
import { renderCatalogSection } from "./lib/errors-doc.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, "..");
const ERRORS_MD = resolvePath(ROOT, "docs/ERRORS.md");

const BEGIN = "<!-- BEGIN AUTO-GENERATED:CATALOG -->";
const END = "<!-- END AUTO-GENERATED:CATALOG -->";

const current = readFileSync(ERRORS_MD, "utf8");
const body = renderCatalogSection(ERROR_CATALOG);
const block = `${BEGIN}\n${body}\n${END}`;

let updated;
const beginIdx = current.indexOf(BEGIN);
const endIdx = current.indexOf(END);
if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
  updated = `${current.slice(0, beginIdx)}${block}${current.slice(endIdx + END.length)}`;
} else {
  const suffix = current.endsWith("\n") ? "" : "\n";
  updated = `${current}${suffix}\n${block}\n`;
}

if (updated !== current) {
  writeFileSync(ERRORS_MD, updated, "utf8");
  console.log(`wrote docs/ERRORS.md (${Object.keys(ERROR_CATALOG).length} codes).`);
} else {
  console.log(`docs/ERRORS.md is already up to date.`);
}
