// git-recap — data collection (the git → JSON pipeline).
//
// Zero dependencies, Node stdlib only. Everything runs locally against the
// user's own git repositories: it shells out to `git` and reads tracked files
// on disk. Nothing is uploaded, and no network is touched.
//
// The output is a plain JSON object (see README.md for the schema). That JSON
// is the ONLY interface between collection and rendering — you can collect on
// one machine, hand the JSON to `render.mjs` anywhere, or feed it your own
// hand-written JSON. Data and pixels are fully decoupled.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;

// Unit/record separators keep the pretty-format unambiguous even when a commit
// author's name contains tabs or the subject contains our field delimiters.
const REC = "\x1e"; // record separator — prefixes every commit header line
const UNIT = "\x1f"; // unit separator — between fields of a commit header

/** Run a git command in `repo`, returning stdout as a string ("" on failure). */
function git(repo, args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 512, // numstat for a big repo can be large
    });
  } catch (err) {
    if (allowFail) return "";
    throw new Error(`git ${args.join(" ")} failed in ${repo}: ${err.message}`);
  }
}

/** True when `dir` is inside a git work tree. */
export function isGitRepo(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() === "true";
  } catch {
    return false;
  }
}

/** Human-friendly repo name = basename of the work-tree root. */
export function repoName(dir) {
  const top = git(dir, ["rev-parse", "--show-toplevel"], { allowFail: true }).trim();
  return path.basename(top || path.resolve(dir));
}

// ── date helpers (calendar arithmetic on YYYY-MM-DD, UTC-anchored) ────────────
// We bucket by the author-LOCAL calendar day: git's %aI already carries the
// commit's own timezone, so the first 10 chars are the day the author lived.
// All subsequent week/month math is done in UTC on that date-only string, which
// is deterministic and independent of the machine running the tool.

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function dayKey(iso) {
  return iso.slice(0, 10);
}
function toUTC(day) {
  return new Date(`${day}T00:00:00Z`);
}
function fmtDay(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(day, n) {
  const d = toUTC(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDay(d);
}
/** Monday (ISO week start) of the week containing `day`. */
function weekStart(day) {
  const d = toUTC(day);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return fmtDay(d);
}
function monthStart(day) {
  return `${day.slice(0, 7)}-01`;
}
function addMonths(monthDay, n) {
  const d = toUTC(monthDay);
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(1);
  return fmtDay(d);
}

/** Pick a series grain so the bar count stays readable for the window length. */
export function autoGrain(days) {
  if (days <= 45) return "day"; // ~up to 45 daily bars
  if (days <= 200) return "week"; // ~up to 28 weekly bars
  return "month";
}

/** Build the continuous, gap-filled list of bucket-start dates for a window. */
function buildBuckets(sinceDay, untilDay, grain) {
  const starts = [];
  if (grain === "day") {
    for (let d = sinceDay; d <= untilDay; d = addDays(d, 1)) starts.push(d);
  } else if (grain === "week") {
    for (let d = weekStart(sinceDay); d <= untilDay; d = addDays(d, 7)) starts.push(d);
  } else {
    for (let d = monthStart(sinceDay); d <= untilDay; d = addMonths(d, 1)) starts.push(d);
  }
  return starts;
}

/** Map a commit day → its bucket-start date for the chosen grain. */
function bucketOf(day, grain) {
  if (grain === "day") return day;
  if (grain === "week") return weekStart(day);
  return monthStart(day);
}

/** Short x-axis label for a bucket + the month-change tick list. */
function bucketLabels(starts, grain) {
  const labels = starts.map((s) => {
    if (grain === "day") return String(Number(s.slice(8, 10)));
    if (grain === "week") return `${s.slice(5, 7)}/${s.slice(8, 10)}`;
    return MONTHS[Number(s.slice(5, 7)) - 1];
  });
  const monthTicks = [];
  let prevMonth = null;
  starts.forEach((s, i) => {
    const m = s.slice(0, 7);
    if (m !== prevMonth) {
      monthTicks.push([i, MONTHS[Number(s.slice(5, 7)) - 1]]);
      prevMonth = m;
    }
  });
  return { labels, monthTicks };
}

// ── lines-of-code-now (current tracked line count at HEAD) ────────────────────
const MAX_LOC_FILE = 2 * 1024 * 1024; // skip files larger than 2 MB
function countLinesOfCode(repo) {
  const list = git(repo, ["ls-files", "-z"], { allowFail: true });
  if (!list) return 0;
  const files = list.split("\0").filter(Boolean);
  let total = 0;
  for (const rel of files) {
    const abs = path.join(repo, rel);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size === 0 || st.size > MAX_LOC_FILE) continue;
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    // binary sniff: a NUL byte in the first 8 KB → not source, skip.
    const sniff = Math.min(buf.length, 8192);
    let binary = false;
    for (let i = 0; i < sniff; i++) {
      if (buf[i] === 0) {
        binary = true;
        break;
      }
    }
    if (binary) continue;
    let lines = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) lines++;
    if (buf.length && buf[buf.length - 1] !== 0x0a) lines++; // last unterminated line
    total += lines;
  }
  return total;
}

// ── per-repo collection ───────────────────────────────────────────────────────
function collectRepo(repo, { sinceDay, untilDay, author, includeMerges, grain, loc }) {
  const args = ["log", `--since=${sinceDay}T00:00:00`, `--until=${untilDay}T23:59:59`];
  if (!includeMerges) args.push("--no-merges");
  if (author) args.push(`--author=${author}`);
  args.push("--numstat", "--date=iso-strict", `--pretty=format:${REC}%H${UNIT}%aI${UNIT}%an${UNIT}%ae`);
  const out = git(repo, args, { allowFail: true });

  const byBucket = new Map(); // bucketStart → { commits, added }
  const byDay = new Map(); // dayKey → commits (for streak/activeDays)
  const files = new Set();
  let commits = 0;
  let insertions = 0;
  let deletions = 0;
  let first = null;
  let last = null;
  let curDay = null;
  let curBucket = null;

  for (const line of out.split("\n")) {
    if (line === "") continue;
    if (line[0] === REC) {
      const [, iso] = line.slice(1).split(UNIT);
      const day = dayKey(iso);
      commits++;
      curDay = day;
      curBucket = bucketOf(day, grain);
      byDay.set(day, (byDay.get(day) || 0) + 1);
      const b = byBucket.get(curBucket) || { commits: 0, added: 0 };
      b.commits++;
      byBucket.set(curBucket, b);
      if (!first || day < first) first = day;
      if (!last || day > last) last = day;
    } else {
      // numstat: "<added>\t<deleted>\t<path>" — added/deleted are "-" for binary
      const tab1 = line.indexOf("\t");
      const tab2 = line.indexOf("\t", tab1 + 1);
      if (tab1 < 0 || tab2 < 0) continue;
      const a = line.slice(0, tab1);
      const d = line.slice(tab1 + 1, tab2);
      const p = line.slice(tab2 + 1);
      const add = a === "-" ? 0 : parseInt(a, 10) || 0;
      const del = d === "-" ? 0 : parseInt(d, 10) || 0;
      insertions += add;
      deletions += del;
      if (p) files.add(p);
      if (curBucket) byBucket.get(curBucket).added += add;
    }
  }

  return {
    repo: repoName(repo),
    path: repo,
    commits,
    insertions,
    deletions,
    filesTouched: files.size,
    first,
    last,
    linesOfCodeNow: loc ? countLinesOfCode(repo) : null,
    byBucket,
    byDay,
  };
}

/** Longest run of consecutive calendar days present in `daySet`. */
function longestStreak(daySet) {
  const days = [...daySet].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of days) {
    if (prev && addDays(prev, 1) === day) run++;
    else run = 1;
    if (run > best) best = run;
    prev = day;
  }
  return best;
}

/**
 * Collect a recap across one or more repos.
 * @returns the recap JSON object (schema in README.md).
 */
export function collectRecap(opts) {
  const {
    repos,
    sinceDay,
    untilDay,
    periodKey,
    periodLabel,
    author = null,
    includeMerges = false,
    loc = true,
    grain: grainOpt,
    brand = null,
    onProgress = () => {},
  } = opts;

  const days = Math.round((toUTC(untilDay) - toUTC(sinceDay)) / 86400000) + 1;
  const grain = grainOpt || autoGrain(days);
  const starts = buildBuckets(sinceDay, untilDay, grain);
  const { labels, monthTicks } = bucketLabels(starts, grain);
  const idxOf = new Map(starts.map((s, i) => [s, i]));

  const perRepo = [];
  const commitsSeries = new Array(starts.length).fill(0);
  const addedSeries = new Array(starts.length).fill(0);
  const allDays = new Set();
  const dayCommits = new Map();
  let totalCommits = 0;
  let totalInsertions = 0;
  let totalDeletions = 0;
  let totalLoc = 0;
  let totalFiles = 0;
  let anyLoc = false;

  for (const repo of repos) {
    onProgress(`scanning ${repoName(repo)}…`);
    const r = collectRepo(repo, { sinceDay, untilDay, author, includeMerges, grain, loc });
    for (const [bucket, v] of r.byBucket) {
      const i = idxOf.get(bucket);
      if (i === undefined) continue;
      commitsSeries[i] += v.commits;
      addedSeries[i] += v.added;
    }
    for (const [day, c] of r.byDay) {
      allDays.add(day);
      dayCommits.set(day, (dayCommits.get(day) || 0) + c);
    }
    totalCommits += r.commits;
    totalInsertions += r.insertions;
    totalDeletions += r.deletions;
    totalFiles += r.filesTouched;
    if (r.linesOfCodeNow != null) {
      totalLoc += r.linesOfCodeNow;
      anyLoc = true;
    }
    // strip internal maps before they reach the JSON
    const { byBucket, byDay, ...pub } = r;
    perRepo.push(pub);
  }

  perRepo.sort((a, b) => b.commits - a.commits);
  const activeRepos = perRepo.filter((r) => r.commits > 0);

  // "Repos in flight" cumulative: how many repos had their first in-window
  // commit at or before each bucket — the growth curve of the codebase count.
  const reposCumulative = new Array(starts.length).fill(0);
  const firstBuckets = activeRepos
    .filter((r) => r.first)
    .map((r) => idxOf.get(bucketOf(r.first, grain)))
    .filter((i) => i !== undefined)
    .sort((a, b) => a - b);
  let fi = 0;
  for (let i = 0; i < starts.length; i++) {
    while (fi < firstBuckets.length && firstBuckets[fi] <= i) fi++;
    reposCumulative[i] = fi;
  }
  // cumulative lines added — the single-repo growth alternative
  const addedCumulative = [];
  addedSeries.reduce((acc, v, i) => (addedCumulative[i] = acc + v), 0);

  // busiest day + streaks
  let busiest = { date: null, commits: 0 };
  for (const [day, c] of dayCommits) if (c > busiest.commits) busiest = { date: day, commits: c };
  const activeDays = allDays.size;

  return {
    schemaVersion: SCHEMA_VERSION,
    tool: "git-recap",
    generatedAt: new Date().toISOString(),
    period: { key: periodKey, label: periodLabel, since: sinceDay, until: untilDay, days },
    filters: { author, includeMerges },
    totals: {
      commits: totalCommits,
      linesAdded: totalInsertions,
      linesRemoved: totalDeletions,
      linesNet: totalInsertions - totalDeletions,
      linesOfCodeNow: anyLoc ? totalLoc : null,
      repos: activeRepos.length,
      filesTouched: totalFiles,
      activeDays,
      longestStreakDays: longestStreak(allDays),
      avgCommitsPerActiveDay: activeDays ? Math.round((totalCommits / activeDays) * 10) / 10 : 0,
      busiestDay: busiest,
    },
    series: {
      grain,
      buckets: labels,
      bucketStart: starts,
      commits: commitsSeries,
      linesAdded: addedSeries,
      reposActiveCumulative: reposCumulative,
      linesAddedCumulative: addedCumulative,
      monthTicks,
    },
    perRepo,
    brand: brand || undefined,
  };
}
