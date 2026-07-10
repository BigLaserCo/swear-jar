// The install proof — the guarantee behind `npx swear-jar` / `npm i -g swear-jar`.
//
// This test packs the package exactly as `npm publish` would, asserts the
// tarball ships ONLY the runtime surface (bin/src/assets/.claude-plugin/skills
// + README/LICENSE) and NOTHING internal (tests, docs, scripts, worktrees, or
// any absolute machine path), then installs that same tarball into a throwaway
// consumer with --ignore-scripts (a trustworthy CLI runs NO install code) and
// runs the installed bin end-to-end. If this is green, `npx swear-jar` works
// and leaks nothing.
//
// It is env-conditional: if `npm` is not on PATH (some minimal CI images), it
// skips with a clear reason rather than falsely reddening the gate. In this
// repo's worktree npm IS present, so it runs and must pass.
// SKIP-OK: skips only when npm is absent from PATH (packaging proof needs npm).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function npmOnPath() {
  try {
    execFileSync("npm", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Files that MUST be in the shipped tarball (relative to package root).
const MUST_INCLUDE = [
  "package.json",
  "README.md",
  "LICENSE",
  "bin/swear-jar.mjs",
  "assets/report_template.html",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  "skills/swear-jar/SKILL.md",
  "src/scan.mjs",
  "src/ledger.mjs",
  "src/detect.mjs",
  "src/render.mjs",
  "src/install.mjs",
];

// No shipped path may live under these internal roots …
const FORBIDDEN_PREFIXES = ["test/", "docs/", "scripts/", ".worktrees/", ".github/", ".elephant/"];
// … nor look like a leaked absolute / machine-local path.
const FORBIDDEN_PATTERN = /Users|BlcCommon|\.elephant/i;

const SKIP = npmOnPath()
  ? false
  : "SKIP-OK: npm not on PATH — packaging/install proof requires npm (env gate, no ticket)";

test("npm pack ships only the runtime surface and installs into a runnable CLI", { skip: SKIP }, async (t) => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "swear-pack-"));
  const consumer = fs.mkdtempSync(path.join(os.tmpdir(), "swear-consumer-"));
  const jarHome = fs.mkdtempSync(path.join(os.tmpdir(), "swear-home-"));

  try {
    // ── pack exactly as `npm publish` would ────────────────────────────────
    const packJson = execFileSync(
      "npm",
      ["pack", "--json", "--pack-destination", workdir],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );
    const meta = JSON.parse(packJson);
    const entry = Array.isArray(meta) ? meta[0] : meta;
    const files = entry.files.map((f) => f.path.replace(/\\/g, "/"));
    const tgz = path.join(workdir, entry.filename);
    assert.ok(fs.existsSync(tgz), `tarball ${entry.filename} should exist`);

    // ── the tarball carries every runtime file ──────────────────────────────
    for (const rel of MUST_INCLUDE) {
      assert.ok(files.includes(rel), `packed tarball must include ${rel} (got: ${files.join(", ")})`);
    }
    // all src/*.mjs ship (not just the sampled few above)
    const srcCount = files.filter((f) => f.startsWith("src/") && f.endsWith(".mjs")).length;
    assert.ok(srcCount >= 8, `expected the full src/ module set, saw ${srcCount}`);

    // ── and NOTHING internal / machine-local leaks ──────────────────────────
    for (const f of files) {
      for (const bad of FORBIDDEN_PREFIXES) {
        assert.ok(!f.startsWith(bad), `packed tarball must NOT include ${f} (under ${bad})`);
      }
      assert.ok(!FORBIDDEN_PATTERN.test(f), `packed path looks machine-local / internal: ${f}`);
    }
    // belt-and-suspenders: named internal files are absent
    assert.ok(!files.some((f) => /(^|\/)pack\.test\.mjs$/.test(f)), "test files must not ship");
    assert.ok(!files.some((f) => f === "scripts/ci/verify.mjs"), "CI gate must not ship");
    assert.ok(!files.some((f) => f.startsWith("docs/")), "docs/ must not ship");

    // ── install THAT tarball as a real consumer would (npm i -g style) ───────
    fs.writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({ name: "swear-jar-consumer", version: "1.0.0", private: true }) + "\n"
    );
    execFileSync(
      "npm",
      ["install", tgz, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: consumer, encoding: "utf8" }
    );

    // the package landed and zero transitive deps came along (trust: no supply chain)
    const installed = path.join(consumer, "node_modules", "swear-jar");
    assert.ok(fs.existsSync(path.join(installed, "bin", "swear-jar.mjs")), "installed bin should exist");
    const installedDeps = fs
      .readdirSync(path.join(consumer, "node_modules"))
      .filter((n) => !n.startsWith(".") && n !== "swear-jar");
    assert.deepEqual(installedDeps, [], `swear-jar must pull ZERO deps, saw: ${installedDeps.join(", ")}`);

    // the CLI shim exists (this is what `npx swear-jar` / a global bin resolves to)
    const shim = path.join(consumer, "node_modules", ".bin", "swear-jar");
    assert.ok(fs.existsSync(shim), "node_modules/.bin/swear-jar shim should exist");

    // ── run the installed bin end-to-end through the real shim ──────────────
    const runEnv = { ...process.env, SWEAR_JAR_HOME: jarHome };
    const statusOut = execFileSync(shim, ["status"], { encoding: "utf8", env: runEnv });
    assert.match(statusOut, /SWEAR JAR/, "status output should render the jar");
    assert.match(statusOut, /Jar balance:/, "status output should show a jar balance");
    assert.match(statusOut, /UPRISING SURVIVAL ODDS/, "status output should show survival odds");

    // unknown command prints usage and still exits 0 (the CLI never hard-crashes)
    const helpOut = execFileSync(shim, ["--help"], { encoding: "utf8", env: runEnv });
    assert.match(helpOut, /swear-jar — usage:/, "usage text should render");
    assert.match(helpOut, /swear-jar backfill/, "usage should list the backfill command");
  } finally {
    for (const dir of [workdir, consumer, jarHome]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
