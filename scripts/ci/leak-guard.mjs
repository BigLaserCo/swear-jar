#!/usr/bin/env node
// swear-jar leak-guard — a supply-chain / internal-code leakage scanner.
// Zero dependencies, Node stdlib only. Exits NON-ZERO with a per-hit report if
// any git-tracked SOURCE file (bin/**, src/**, scripts/**) contains:
//
//   (a) an import/require of a NON-stdlib, NON-relative module — i.e. any
//       specifier that is not `node:*` and not a `./` or `../` path. This
//       catches a stray npm package or a first-party org scope (an at-sign
//       scoped package) sneaking onto a zero-dependency project.
//   (b) a relative import whose resolved path ESCAPES the repo root (a `../`
//       chain climbing above the package directory — e.g. into a sibling
//       internal checkout).
//   (c) any INTERNAL-SCOPE token appearing anywhere in the file text (see the
//       auditable denylist below). The public marketing domain (biglaser.co)
//       is intentionally NOT on the list — only internal identifiers are.
//
// Docs, tests, and assets are NOT scanned: they legitimately mention brand
// strings and carry example fixtures. Only committed source (bin/src/scripts)
// is scanned.
//
// SELF-EXCLUSION: this scanner's OWN source is skipped (see SELF_EXCLUDE). A
// pattern scanner necessarily contains the very patterns it hunts — its import
// regexes, its detail strings, and its denylist — so scanning itself would
// always self-flag. Every real secret scanner (gitleaks, trufflehog) excludes
// its own rule definitions for exactly this reason. The blind-spot risk is
// negligible: this file is CI-only (not in the npm `files` allowlist, so never
// published) and a zero-dep project cannot resolve an internal import anyway.
// The needles below are still assembled from fragments via `j(...)` as defense
// in depth, so the denylist itself carries no verbatim token.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Assemble a literal from pieces so the assembled string never appears verbatim
// in this file's own bytes (so the scanner never flags itself).
const j = (...parts) => parts.join("");

// ── the auditable internal-scope denylist ────────────────────────────────────
// Each entry is `[ human-readable label, needle ]`. The needle is fragmented so
// the verbatim token is absent from this file; read the `j("a","b")` pieces to
// audit the exact string. Matching is case-insensitive. Keep this list in sync
// with the internal identifiers a zero-dep public project must never ship.
// NOTE: every label + comment below is ALSO fragment-safe — no verbatim denied
// token appears anywhere in this file (labels reworded, paths described not
// spelled), so the scanner stays clean when it scans its own source.
export const INTERNAL_TOKENS = [
  ["first-party npm scope (b)", j("@", "blc/")], // "@" + "blc/"  → shared-lib scope
  ["first-party npm scope (bl)", j("@", "biglaser/")], // "@" + "biglaser/" → first-party scope
  ["shared component lib", j("Blc", "Common")], // "Blc" + "Common"
  ["core agent-OS repo", j("company-", "in-a-box")], // "company-" + "in-a-box"
  ["release automation infra", j("release-", "train")], // "release-" + "train" (hyphenated)
  ["queue ledger dir", j(".", "elephant")], // "." + "elephant" → gitignored ledger dir
  ["guarded provider client", j("guarded", "Fetch")], // "guarded" + "Fetch" → dead-man switch
  ["local secret vault", j("ai-", "secrets")], // "ai-" + "secrets" → the local vault dir
  ["prod deploy key name", j("biglaser_", "deploy")], // "biglaser_" + "deploy" → SSH key
];

// ── import specifier extraction ──────────────────────────────────────────────
// Three regexes cover every module-specifier form. Binding lists may span
// newlines, so the `from`-form disallows only `;` and quotes in the middle,
// which keeps a lazy match from leaping across statements. Dynamic imports with
// a non-string argument (e.g. `import(new URL(...))`) are intentionally not
// matched — they carry no bare specifier to vet.
const SPEC_RES = [
  // static `import … from "x"` and re-export `export … from "x"`
  /\b(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/g,
  // side-effect `import "x"`
  /\bimport\s*(['"])([^'"]+)\1/g,
  // dynamic `import("x")` and CommonJS `require("x")`
  /\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1/g,
];

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

// Does a relative specifier, resolved against the importing file, climb above
// the repo root? Paths are posix (git + module specifiers both use "/").
function importEscapesRoot(relFilePath, spec) {
  const dir = path.posix.dirname(relFilePath);
  const resolved = path.posix.normalize(path.posix.join(dir, spec));
  return resolved === ".." || resolved.startsWith("../");
}

function classifySpec(relFilePath, spec) {
  if (spec.startsWith("node:")) return null; // stdlib — allowed
  if (spec.startsWith("./") || spec.startsWith("../")) {
    // relative — allowed only if it stays inside the repo root
    return importEscapesRoot(relFilePath, spec)
      ? { kind: "escaping-import", detail: `relative import escapes repo root: "${spec}"` }
      : null;
  }
  // anything else is a bare / scoped specifier on a zero-dependency project
  return { kind: "external-import", detail: `non-stdlib, non-relative import: "${spec}"` };
}

// ── the pure detection function (unit-tested with in-memory fixtures) ─────────
// `files` = [{ path, text }] with posix-relative paths. Returns a flat array of
// hits: { file, line, kind, detail }. No filesystem or process access — so it
// is fully testable without spawning or writing temp files.
export function detectLeaks(files) {
  const hits = [];
  for (const { path: rel, text } of files) {
    // (a) + (b) — vet every module specifier
    for (const re of SPEC_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const spec = m[2];
        const verdict = classifySpec(rel, spec);
        if (verdict) {
          hits.push({ file: rel, line: lineOf(text, m.index), kind: verdict.kind, detail: verdict.detail });
        }
      }
    }
    // (c) — internal-scope tokens anywhere in the file (case-insensitive)
    const lower = text.toLowerCase();
    for (const [label, needle] of INTERNAL_TOKENS) {
      const idx = lower.indexOf(needle.toLowerCase());
      if (idx !== -1) {
        hits.push({
          file: rel,
          line: lineOf(text, idx),
          kind: "internal-token",
          detail: `internal-scope token (${label}): "${needle}"`,
        });
      }
    }
  }
  return hits;
}

export function formatHit(h) {
  return `${h.file}:${h.line} [${h.kind}] ${h.detail}`;
}

// ── read the real tracked source (one read per file) ─────────────────────────
// funnel/ (the submission service) and web/ (the browser app) ship publicly too,
// so they get the same internal-code scan as bin/src/scripts.
const SCANNED_PREFIXES = ["bin/", "src/", "scripts/", "funnel/", "web/"];
// This scanner's own source is skipped — it necessarily contains the patterns
// and denylist it hunts (see the SELF-EXCLUSION note in the header).
const SELF_EXCLUDE = new Set(["scripts/ci/leak-guard.mjs"]);

export function collectTrackedSources(root) {
  let tracked = [];
  try {
    tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    tracked = [];
  }
  const files = [];
  for (const rel of tracked) {
    if (!SCANNED_PREFIXES.some((p) => rel.startsWith(p))) continue;
    if (SELF_EXCLUDE.has(rel)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    files.push({ path: rel, text });
  }
  return files;
}

// Collect + detect over the real repo. Returns { hits, fileCount } so callers
// (verify.mjs) can format failures in their own style without process.exit.
export function runGuard(root) {
  const files = collectTrackedSources(root);
  const hits = detectLeaks(files);
  return { hits, fileCount: files.length };
}

// ── CLI: `node scripts/ci/leak-guard.mjs` ────────────────────────────────────
function main() {
  const root = path.resolve(new URL("../../", import.meta.url).pathname);
  const { hits, fileCount } = runGuard(root);
  if (hits.length) {
    console.error("leak-guard FAILED — internal/first-party code found in shipped source:");
    for (const h of hits) console.error(`  x  ${formatHit(h)}`);
    process.exit(1);
  }
  console.log(`leak-guard: ${fileCount} src/bin/scripts file(s) free of internal/first-party code`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
