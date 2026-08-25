import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pairs = [
  ["web/app-shell.html", "docs/app/index.html"],
  ["web/app.css", "docs/app/app.css"],
  ["web/app.mjs", "docs/app/app.mjs"],
  ["web/browser-scan.mjs", "docs/app/browser-scan.mjs"],
  ["web/folder-input.mjs", "docs/app/folder-input.mjs"],
  ["web/result-share.mjs", "docs/app/result-share.mjs"],
  ...["detect.mjs", "odds.mjs", "render.mjs", "sharecard.mjs", "stats.mjs", "version.mjs"]
    .map((name) => [`src/${name}`, `docs/src/${name}`]),
];

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("browser app builder keeps every committed deployment copy fresh and reproducible", () => {
  const before = new Map(pairs.map(([, target]) => [target, read(target)]));
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "site", "buildBrowserApp.mjs")], {
    cwd: ROOT,
  });

  for (const [source, target] of pairs) {
    assert.equal(read(target), read(source), `${target} stays byte-for-byte canonical`);
    assert.equal(read(target), before.get(target), `${target} is a current reproducible output`);
  }
});
