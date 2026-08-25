#!/usr/bin/env node
// Build every generated file that the static host serves. Canonical source
// stays under assets/, web/, and src/ so releases carry reviewable code rather
// than large duplicated HTML and module copies.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const builders = [
  "scripts/site/buildAdmin.mjs",
  "scripts/site/buildDemo.mjs",
  "scripts/site/buildKindness.mjs",
  "scripts/site/buildBrowserApp.mjs",
];

for (const builder of builders) {
  execFileSync(process.execPath, [path.join(ROOT, builder)], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

console.log(`public site built from ${builders.length} deterministic builders`);
