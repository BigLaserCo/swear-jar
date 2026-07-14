// Tests for the git-recap tool (scripts/git-recap). Builds a throwaway git repo
// with commits on known dates, then asserts the collected stats, the rendered
// HTML, and — when a browser is available — the rasterized PNG.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectRecap, isGitRepo, repoName } from "../scripts/git-recap/collect.mjs";
import { renderRecapHtml, FORMATS } from "../scripts/git-recap/render.mjs";
import { rasterizeHtml, findBrowser } from "../scripts/git-recap/rasterize.mjs";
import { resolveTheme, fontStack } from "../scripts/git-recap/theme.mjs";
import { abbr } from "../scripts/git-recap/charts.mjs";

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-recap-test-"));
  const g = (args, date) =>
    execFileSync("git", ["-C", dir, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
  g(["init", "-q", "-b", "main"]);
  g(["config", "commit.gpgsign", "false"]);
  const commit = (file, lines, date) => {
    fs.writeFileSync(path.join(dir, file), "x\n".repeat(lines));
    g(["add", "-A"]);
    g(["commit", "-q", "-m", `add ${file}`], date);
  };
  // 5 commits across 4 active days; longest streak = Jun 1-3 = 3 days.
  commit("a.txt", 3, "2026-06-01T12:00:00");
  commit("b.txt", 5, "2026-06-02T12:00:00");
  commit("c.txt", 2, "2026-06-02T15:00:00"); // same day → busiest day = 2 commits
  commit("d.txt", 4, "2026-06-03T12:00:00");
  commit("e.txt", 1, "2026-06-20T12:00:00"); // gap → streak stays 3
  return dir;
}

test("isGitRepo / repoName", () => {
  const dir = makeRepo();
  assert.equal(isGitRepo(dir), true);
  assert.equal(isGitRepo(os.tmpdir()), false);
  assert.equal(repoName(dir), path.basename(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("collectRecap aggregates commits, lines, streaks, series", () => {
  const dir = makeRepo();
  const recap = collectRecap({
    repos: [dir],
    sinceDay: "2026-06-01",
    untilDay: "2026-06-30",
    periodKey: "custom",
    periodLabel: "June",
    loc: true,
  });

  assert.equal(recap.tool, "git-recap");
  assert.equal(recap.totals.commits, 5);
  assert.equal(recap.totals.linesAdded, 15); // 3+5+2+4+1
  assert.equal(recap.totals.linesRemoved, 0);
  assert.equal(recap.totals.linesOfCodeNow, 15); // working tree total
  assert.equal(recap.totals.repos, 1);
  assert.equal(recap.totals.activeDays, 4);
  assert.equal(recap.totals.longestStreakDays, 3);
  assert.deepEqual(recap.totals.busiestDay, { date: "2026-06-02", commits: 2 });

  // series is gap-filled daily and sums back to the totals
  assert.equal(recap.series.grain, "day");
  assert.equal(recap.series.commits.length, 30);
  assert.equal(recap.series.commits.reduce((a, b) => a + b, 0), 5);
  assert.equal(recap.series.linesAdded.reduce((a, b) => a + b, 0), 15);
  assert.equal(recap.series.linesAddedCumulative.at(-1), 15);

  assert.equal(recap.perRepo.length, 1);
  assert.equal(recap.perRepo[0].commits, 5);
  assert.equal(recap.perRepo[0].insertions, 15);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("author filter excludes non-matching commits", () => {
  const dir = makeRepo();
  const none = collectRecap({
    repos: [dir], sinceDay: "2026-06-01", untilDay: "2026-06-30",
    periodKey: "c", periodLabel: "June", author: "nobody@nowhere.test", loc: false,
  });
  assert.equal(none.totals.commits, 0);
  const mine = collectRecap({
    repos: [dir], sinceDay: "2026-06-01", untilDay: "2026-06-30",
    periodKey: "c", periodLabel: "June", author: "test@example.com", loc: false,
  });
  assert.equal(mine.totals.commits, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("renderRecapHtml produces self-contained HTML for every format", () => {
  const dir = makeRepo();
  const recap = collectRecap({
    repos: [dir], sinceDay: "2026-06-01", untilDay: "2026-06-30",
    periodKey: "custom", periodLabel: "June", loc: true,
  });
  for (const format of Object.keys(FORMATS)) {
    const html = renderRecapHtml(recap, { format, theme: { brand: { wordmark: "UNIT TEST" } } });
    assert.match(html, /^<!doctype html>/);
    assert.ok(html.includes("UNIT TEST"), "brand override applied");
    assert.ok(html.includes("<svg"), "charts present");
    assert.ok(!html.includes("<script"), "no client-side script (deterministic)");
    // dimensions match the format
    assert.ok(html.includes(`width:${FORMATS[format].w}px`));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("abbr formats counts", () => {
  assert.equal(abbr(900), "900");
  assert.equal(abbr(12300), "12k");
  assert.equal(abbr(1530000), "1.5M");
});

test("theme override merges over defaults", () => {
  const t = resolveTheme({ colors: { green: "#123456" }, brand: { tag: "// x" } });
  assert.equal(t.colors.green, "#123456");
  assert.equal(t.colors.bed, "#19120d"); // default preserved
  assert.equal(t.brand.tag, "// x");
  assert.match(fontStack(t, "display"), /Anton/);
});

// Rasterization needs a real browser; skip cleanly where none is installed
// (e.g. minimal CI) so the suite stays green without one.
const hasBrowser = Boolean(findBrowser());
test("rasterizeHtml writes a PNG", { skip: !hasBrowser && "no Chromium-family browser found" }, () => {
  const dir = makeRepo();
  const recap = collectRecap({
    repos: [dir], sinceDay: "2026-06-01", untilDay: "2026-06-30",
    periodKey: "custom", periodLabel: "June", loc: false,
  });
  const html = renderRecapHtml(recap, { format: "1x1" });
  const out = path.join(dir, "out.png");
  rasterizeHtml(html, { width: 1080, height: 1080, outPath: out });
  const buf = fs.readFileSync(out);
  assert.ok(buf.length > 1000, "png has content");
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]); // PNG magic
  assert.equal(buf.readUInt32BE(16), 1080); // width in IHDR
  fs.rmSync(dir, { recursive: true, force: true });
});
