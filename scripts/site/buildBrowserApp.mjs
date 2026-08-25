#!/usr/bin/env node
// Stage the browser scanner into the docs tree served at /app/. The source files
// remain web/ and src/; this copies a deliberately small, browser-safe closure
// so the static deployment does not depend on repository-path fallbacks.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const copies = [
  ["web/app-shell.html", "docs/app/index.html"],
  ["web/app.css", "docs/app/app.css"],
  ["web/app.mjs", "docs/app/app.mjs"],
  ["web/folder-input.mjs", "docs/app/folder-input.mjs"],
  ["web/result-share.mjs", "docs/app/result-share.mjs"],
  ["web/browser-scan.mjs", "docs/app/browser-scan.mjs"],
  ...["detect.mjs", "odds.mjs", "render.mjs", "sharecard.mjs", "stats.mjs", "version.mjs"].map((name) => [
    `src/${name}`,
    `docs/src/${name}`,
  ]),
];

for (const [source, target] of copies) {
  const from = path.join(ROOT, source);
  const to = path.join(ROOT, target);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

console.log(`browser app staged → ${copies.map(([, target]) => target).join(", ")}`);
