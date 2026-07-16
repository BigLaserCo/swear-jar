// HTML dashboard renderer — the viral surface.
//
// Turns the pure stats object (src/stats.mjs) into the self-contained
// assets/report_template.html. The template is 100% local: zero external
// requests, everything inlined. This module ONLY injects data — it never
// fetches anything and never launches anything (it returns/prints a path;
// the auto-open courtesy lives in the CLI via src/open.mjs, not here).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeStats } from "./stats.mjs";
import { dataDir } from "./ledger.mjs";
import { DONATE_URL } from "./donate.mjs";
import { hostedWrappedUrl } from "./hosted.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(HERE, "..", "assets", "report_template.html");
const KINDNESS_TEMPLATE_PATH = path.join(HERE, "..", "assets", "kindness_template.html");
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

// stats -> filled HTML string. donateUrl DEFAULTS ON (DONATE_URL — the tip jar);
// pass a string to point elsewhere, or `false` to hide the section. hostedUrl
// (milestone 3) is the "see it in lights / join the board" button — inject a
// string to show it, omit or pass `false` to hide it (local-only). BOTH render
// as an <a href> a human clicks — the page still auto-requests nothing.
export function renderDashboard(stats, opts = {}) {
  const { donateUrl, hostedUrl } = opts;
  // opts.kind: "damage" (default) | "kindness" — side A or side B of the tape.
  const templatePath = opts.templatePath || (opts.kind === "kindness" ? KINDNESS_TEMPLATE_PATH : TEMPLATE_PATH);
  const template = loadTemplate(templatePath);
  const payload = { ...stats };
  const donate = donateUrl === false ? null : donateUrl === undefined ? DONATE_URL : donateUrl;
  if (donate) payload.donate_url = donate;
  if (typeof hostedUrl === "string" && hostedUrl) payload.hosted_wrapped_url = hostedUrl;
  const json = safeJson(payload);
  // Use a replacer function so `$` sequences in the JSON aren't treated as
  // String.replace special patterns.
  return template.replace(MARKER, () => json);
}

// records -> report.html on disk. Returns the path. Does NOT open a browser.
// By default the report carries the "in lights" button (covers a user who chose
// local first); pass `hostedUrl: false` (or `localOnly: true`) to omit it, or a
// string to override. Building the URL is pure — no request is ever made here.
export function writeDashboard(records, opts = {}) {
  const stats = computeStats(records, opts.now);
  let hostedUrl = opts.hostedUrl;
  if (hostedUrl === undefined) {
    if (opts.localOnly || records.length === 0) {
      hostedUrl = false;
    } else {
      try {
        hostedUrl = hostedWrappedUrl(stats, records);
      } catch {
        hostedUrl = false; // a URL hiccup never blocks writing the local report
      }
    }
  }
  const html = renderDashboard(stats, { ...opts, hostedUrl });
  const outPath = opts.outPath || path.join(dataDir(), opts.kind === "kindness" ? "kindness.html" : "report.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");
  return outPath;
}
