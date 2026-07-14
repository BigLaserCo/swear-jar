#!/usr/bin/env node
// git-recap — turn your local git history into a saveable social recap image.
//
//   node scripts/git-recap/cli.mjs <repo...> [options]     collect + render PNGs
//   node scripts/git-recap/cli.mjs collect <repo...>        emit recap JSON only
//   node scripts/git-recap/cli.mjs render <recap.json>      render JSON → PNGs
//
// Runs entirely on your machine: it reads your git repos and drives a headless
// browser you already have. Nothing is uploaded. See README.md for the schema.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { collectRecap, isGitRepo } from "./collect.mjs";
import { renderRecapHtml, FORMATS } from "./render.mjs";
import { rasterizeHtml, findBrowser } from "./rasterize.mjs";

const HELP = `git-recap — a local, $0, no-upload git history recap generator.

USAGE
  node scripts/git-recap/cli.mjs <repo...> [options]      collect + render images
  node scripts/git-recap/cli.mjs collect <repo...> [opts] write recap JSON only
  node scripts/git-recap/cli.mjs render <recap.json> [opts] render an existing JSON

TIMEFRAME
  --period <N>d|w|mo|y     rolling window (default 12mo; e.g. 30d, 6mo, 12mo)
  --since <YYYY-MM-DD>     explicit start (overrides --period)
  --until <YYYY-MM-DD>     explicit end (default: today)
  --bucket day|week|month  series granularity (default: auto from window)

FILTERS
  --author <pattern>       only commits whose author matches (git --author)
  --me                     shorthand for --author "$(git config user.email)"
  --merges                 include merge commits (default: excluded)
  --no-loc                 skip counting current lines-of-code (faster)

OUTPUT
  -o, --out <dir>          output directory (default: current dir)
  --formats <list>         any of 4x5,1x1,9x16 (default: all three)
  --scale <N>              pixel density, 1 or 2 (default: 1)
  --json                   also write the recap JSON next to the images
  --no-render              collect only, no images

BRANDING (all optional — the tool ships brand-neutral)
  --wordmark <s> --tag <s> --title <s> --subtitle <s> --cta <s>
  --footer-left <s> --footer-right <s>
  --accent <#hex>          bright accent colour   --bar-color <#hex> bar colour
  --brand-file <file.json> deep-merged theme overrides { colors, fonts, brand }
  --no-web-fonts           use system fonts only (fully offline render)

  -h, --help
`;

// ── tiny arg parser ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {};
  const positional = [];
  const takesValue = new Set([
    "period", "since", "until", "bucket", "author", "out", "o", "formats", "scale",
    "wordmark", "tag", "title", "subtitle", "cta", "footer-left", "footer-right",
    "accent", "bar-color", "brand-file",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-o") opts.out = argv[++i];
    else if (a.startsWith("--no-")) opts[a.slice(5)] = false;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      if (takesValue.has(key)) opts[key] = argv[++i];
      else opts[key] = true;
    } else positional.push(a);
  }
  return { opts, positional };
}

function fail(msg) {
  console.error(`git-recap: ${msg}`);
  process.exit(1);
}

// ── timeframe ─────────────────────────────────────────────────────────────────
function periodLabel(n, unit) {
  const map = { d: "days", w: "weeks", mo: "months", y: "years" };
  if (unit === "mo" && n === 12) return "Last 12 months";
  if (unit === "y") return n === 1 ? "Last 12 months" : `Last ${n} years`;
  return `Last ${n} ${map[unit]}`;
}
function shiftDay(untilDay, n, unit) {
  const d = new Date(`${untilDay}T00:00:00Z`);
  if (unit === "d") d.setUTCDate(d.getUTCDate() - n);
  else if (unit === "w") d.setUTCDate(d.getUTCDate() - n * 7);
  else if (unit === "mo") d.setUTCMonth(d.getUTCMonth() - n);
  else if (unit === "y") d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}
function resolvePeriod(opts) {
  const untilDay = opts.until || new Date().toISOString().slice(0, 10);
  if (opts.since) {
    const days = Math.round((new Date(untilDay + "T00:00:00Z") - new Date(opts.since + "T00:00:00Z")) / 86400000);
    return { sinceDay: opts.since, untilDay, key: "custom", label: `${opts.since} → ${untilDay}`, __days: days };
  }
  const spec = String(opts.period || "12mo");
  const m = /^(\d+)(d|w|mo|y)$/.exec(spec);
  if (!m) fail(`bad --period "${spec}" (use e.g. 30d, 6mo, 12mo, 1y)`);
  const n = Number(m[1]);
  const unit = m[2];
  return { sinceDay: shiftDay(untilDay, n, unit), untilDay, key: spec, label: periodLabel(n, unit) };
}

// ── branding / theme overrides from flags ─────────────────────────────────────
function themeOverrides(opts) {
  const brand = {};
  for (const [flag, key] of [
    ["wordmark", "wordmark"], ["tag", "tag"], ["title", "title"], ["subtitle", "subtitle"],
    ["cta", "cta"], ["footer-left", "footerLeft"], ["footer-right", "footerRight"],
  ]) {
    if (opts[flag] != null) brand[key] = opts[flag];
  }
  const colors = {};
  if (opts.accent) colors.redBr = opts.accent;
  if (opts["bar-color"]) colors.green = opts["bar-color"];
  const fonts = {};
  if (opts["web-fonts"] === false) fonts.useWebFonts = false;

  let base = {};
  if (opts["brand-file"]) {
    try {
      base = JSON.parse(fs.readFileSync(opts["brand-file"], "utf8"));
    } catch (e) {
      fail(`could not read --brand-file: ${e.message}`);
    }
  }
  const ov = { ...base };
  if (Object.keys(brand).length) ov.brand = { ...(base.brand || {}), ...brand };
  if (Object.keys(colors).length) ov.colors = { ...(base.colors || {}), ...colors };
  if (Object.keys(fonts).length) ov.fonts = { ...(base.fonts || {}), ...fonts };
  return Object.keys(ov).length ? ov : null;
}

function resolveFormats(opts) {
  if (!opts.formats) return ["4x5", "1x1", "9x16"];
  const list = String(opts.formats).split(",").map((s) => s.trim()).filter(Boolean);
  for (const f of list) if (!FORMATS[f]) fail(`unknown format "${f}" (choose from ${Object.keys(FORMATS).join(", ")})`);
  return list;
}

function summarize(recap) {
  // Human summary goes to stderr so stdout stays clean for `collect` piping.
  const t = recap.totals;
  const nf = (n) => n.toLocaleString("en-US");
  const log = (s) => console.error(s);
  log(`\n  ${recap.period.label} (${recap.period.since} → ${recap.period.until})`);
  log(`  ${nf(t.commits)} commits · +${nf(t.linesAdded)} / −${nf(t.linesRemoved)} lines · ${t.repos} repo(s) · ${t.activeDays} active days`);
  if (t.linesOfCodeNow != null) log(`  ${nf(t.linesOfCodeNow)} lines of code now · busiest day ${t.busiestDay.date || "—"} (${t.busiestDay.commits}) · longest streak ${t.longestStreakDays}d`);
  const top = recap.perRepo.filter((r) => r.commits > 0).slice(0, 8);
  if (top.length > 1) {
    log("  top repos:");
    for (const r of top) log(`    ${String(r.commits).padStart(6)}  ${r.repo}`);
  }
}

function renderAll(recap, formats, opts, outDir) {
  const browser = findBrowser();
  if (!browser) {
    console.error("\ngit-recap: no Chromium-family browser found — wrote JSON but skipped images.");
    console.error("  Install Chrome/Chromium/Edge/Brave, or set RECAP_CHROME, then run `render`.");
    return [];
  }
  const theme = themeOverrides(opts);
  const scale = Math.max(1, Math.min(3, Number(opts.scale) || 1));
  const written = [];
  for (const format of formats) {
    const html = renderRecapHtml(recap, { format, theme });
    const dim = FORMATS[format];
    const out = path.join(outDir, `git-recap-${recap.period.key}-${format}.png`);
    rasterizeHtml(html, { width: dim.w, height: dim.h, outPath: out, scale, browser });
    written.push(out);
    console.log(`  ✓ ${out}  (${dim.w * scale}×${dim.h * scale})`);
  }
  return written;
}

// ── commands ──────────────────────────────────────────────────────────────────
function doCollect(repoArgs, opts) {
  const repos = repoArgs.map((p) => path.resolve(p));
  if (!repos.length) fail("no repositories given");
  const bad = repos.filter((r) => !isGitRepo(r));
  if (bad.length) fail(`not a git repo: ${bad.join(", ")}`);

  const period = resolvePeriod(opts);
  let author = opts.author || null;
  if (opts.me) {
    try {
      author = execFileSync("git", ["config", "user.email"], { encoding: "utf8" }).trim() || null;
    } catch {
      fail("--me: could not read git config user.email");
    }
  }
  const recap = collectRecap({
    repos,
    sinceDay: period.sinceDay,
    untilDay: period.untilDay,
    periodKey: period.key,
    periodLabel: period.label,
    author,
    includeMerges: Boolean(opts.merges),
    loc: opts.loc !== false,
    grain: opts.bucket || null,
    brand: themeOverrides(opts),
    onProgress: (m) => process.stderr.write(`  … ${m}\r`),
  });
  process.stderr.write("".padEnd(60) + "\r");
  return recap;
}

function main() {
  const argv = process.argv.slice(2);
  const { opts, positional } = parseArgs(argv);
  if (opts.help || positional.length === 0 && argv.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  let cmd = "recap";
  let rest = positional;
  if (positional[0] === "collect" || positional[0] === "render") {
    cmd = positional[0];
    rest = positional.slice(1);
  }

  if (cmd === "render") {
    const jsonPath = rest[0];
    if (!jsonPath) fail("render: give a recap JSON path");
    let recap;
    try {
      recap = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch (e) {
      fail(`could not read recap JSON: ${e.message}`);
    }
    if (!recap || recap.tool !== "git-recap") fail("that JSON is not a git-recap recap");
    const outDir = path.resolve(opts.out || ".");
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`git-recap: rendering ${jsonPath}`);
    renderAll(recap, resolveFormats(opts), opts, outDir);
    return;
  }

  const recap = doCollect(rest, opts);
  summarize(recap);

  if (cmd === "collect") {
    const outPath = opts.out ? path.resolve(opts.out) : null;
    const json = JSON.stringify(recap, null, 2);
    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, json);
      console.log(`\n  ✓ ${outPath}`);
    } else {
      process.stdout.write(json + "\n");
    }
    return;
  }

  // default: recap → images (+ optional JSON)
  const outDir = path.resolve(opts.out || ".");
  fs.mkdirSync(outDir, { recursive: true });
  if (opts.json) {
    const jp = path.join(outDir, `git-recap-${recap.period.key}.json`);
    fs.writeFileSync(jp, JSON.stringify(recap, null, 2));
    console.log(`\n  ✓ ${jp}`);
  }
  if (opts.render !== false) {
    console.log("");
    renderAll(recap, resolveFormats(opts), opts, outDir);
  }
}

main();
