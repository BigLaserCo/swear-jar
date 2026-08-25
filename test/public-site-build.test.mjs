import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testArgsForVersion } from "../scripts/ci/run-tests.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "scripts", "site", "buildPublicSite.mjs");
const outputs = [
  "docs/admin.html",
  "docs/demo.html",
  "docs/kindness.html",
  "docs/app/index.html",
  "docs/app/app.css",
  "docs/app/app.mjs",
  "docs/app/browser-scan.mjs",
  "docs/app/folder-input.mjs",
  "docs/app/result-share.mjs",
  ...["detect.mjs", "odds.mjs", "render.mjs", "sharecard.mjs", "stats.mjs", "version.mjs"]
    .map((name) => `docs/src/${name}`),
];

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("verification and deployment build the deterministic public site first", () => {
  assert.ok(fs.existsSync(BUILD), "one public-site builder exists");
  const deploy = read("scripts/deploy-site.sh");
  const verify = read("scripts/ci/verify.mjs");
  assert.ok(deploy.indexOf("buildPublicSite.mjs") < deploy.indexOf("rsync -az"), "deploy builds before rsync");
  assert.ok(verify.indexOf("buildPublicSite.mjs") < verify.indexOf("checkTests();"), "verification builds before tests");
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.equal(scripts["build:site"], "node scripts/site/buildPublicSite.mjs");
  assert.match(
    scripts.test,
    /buildPublicSite\.mjs.*node scripts\/ci\/run-tests\.mjs/,
    "npm test uses the version-aware stable runner for browser-raster tests"
  );
  assert.match(
    verify,
    /run-tests\.mjs/,
    "verification uses the same version-aware runner"
  );
});

test("the stable test runner preserves Node 20 support while avoiding isolated Chromium workers where supported", () => {
  assert.deepEqual(testArgsForVersion("20.0.0"), ["--test"]);
  assert.deepEqual(testArgsForVersion("20.10.0"), ["--test", "--test-concurrency=1"]);
  assert.deepEqual(testArgsForVersion("22.7.0"), ["--test", "--test-concurrency=1"]);
  assert.deepEqual(testArgsForVersion("22.8.0"), ["--test", "--experimental-test-isolation=none", "--test-concurrency=1"]);
  assert.deepEqual(testArgsForVersion("23.5.0"), ["--test", "--experimental-test-isolation=none", "--test-concurrency=1"]);
  assert.deepEqual(testArgsForVersion("23.6.0"), ["--test", "--test-isolation=none", "--test-concurrency=1"]);
  assert.deepEqual(testArgsForVersion("25.0.0"), ["--test", "--test-isolation=none", "--test-concurrency=1"]);
});

test("generated public artifacts are ignored build outputs, not review-hidden content", () => {
  const ignored = read(".gitignore");
  for (const target of ["docs/admin.html", "docs/demo.html", "docs/kindness.html", "docs/app/", "docs/src/"]) {
    assert.match(ignored, new RegExp(`^${target.replace(/[./]/g, "\\$&")}$`, "m"), `${target} is ignored`);
  }
  const tracked = execFileSync("git", ["ls-files", "--", ...outputs], { cwd: ROOT, encoding: "utf8" }).trim();
  assert.equal(tracked, "", "generated deployment bytes do not enter the release stack");
});

test("one build creates every public artifact reproducibly", () => {
  const first = new Map(outputs.map((target) => [target, read(target)]));
  execFileSync(process.execPath, [BUILD], { cwd: ROOT });
  for (const target of outputs) assert.equal(read(target), first.get(target), `${target} is reproducible`);
});
