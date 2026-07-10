// HTML dashboard renderer — the viral surface.
//
// Turns the pure stats object (src/stats.mjs) into the self-contained
// assets/report_template.html. The template is 100% local: zero external
// requests, everything inlined. This module ONLY injects data — it never
// fetches anything and NEVER opens a browser (it returns/prints a path).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeStats } from "./stats.mjs";
import { dataDir } from "./ledger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(HERE, "..", "assets", "report_template.html");
const MARKER = "/*__DATA__*/{}";

// Line/paragraph separators are valid in JSON but terminate a JS statement
// inside a <script>; "<" lets a value close the script tag early. Escaping all
// three keeps the payload valid JSON while making a hostile project name
// (e.g. one containing "</script>") completely inert.
const LS = new RegExp(String.fromCharCode(0x2028), "g");
const PS = new RegExp(String.fromCharCode(0x2029), "g");
function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(LS, "\\u2028")
    .replace(PS, "\\u2029");
}

export function loadTemplate(templatePath = TEMPLATE_PATH) {
  return fs.readFileSync(templatePath, "utf8");
}

// stats -> filled HTML string. donateUrl defaults UNSET (the donate button
// stays hidden) — never hardcode a personal payment link.
export function renderDashboard(stats, opts = {}) {
  const { donateUrl, templatePath } = opts;
  const template = loadTemplate(templatePath);
  const payload = { ...stats };
  if (donateUrl) payload.donate_url = donateUrl;
  const json = safeJson(payload);
  // Use a replacer function so `$` sequences in the JSON aren't treated as
  // String.replace special patterns.
  return template.replace(MARKER, () => json);
}

// records -> report.html on disk. Returns the path. Does NOT open a browser.
export function writeDashboard(records, opts = {}) {
  const stats = computeStats(records, opts.now);
  const html = renderDashboard(stats, opts);
  const outPath = opts.outPath || path.join(dataDir(), "report.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");
  return outPath;
}
