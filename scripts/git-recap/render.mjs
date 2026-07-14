// git-recap — recap JSON → self-contained HTML.
//
// One parametric template drives all three social formats (portrait / square /
// story). The HTML is fully self-contained (inline CSS + static inline SVG
// charts) so it screenshots deterministically. Content adapts to the data:
// single-repo recaps drop the "repos" framing for streak/growth framing.

import { resolveTheme, fontStack, fontLink } from "./theme.mjs";
import { barLineChart, areaChart, abbr } from "./charts.mjs";

export const FORMATS = {
  "4x5": { w: 1080, h: 1350 },
  "1x1": { w: 1080, h: 1080 },
  "9x16": { w: 1080, h: 1920 },
};

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Per-format layout knobs (padding, type scale, chart heights, which blocks).
function layoutFor(format) {
  switch (format) {
    case "1x1":
      return { pad: "50px 56px 42px", h1: 74, gapTop: 16, sub: 22, tileV: 40, charts: 1, viz1: 540, viz2: 0, cta: false, highlights: false, topRepos: false };
    case "9x16":
      return { pad: "78px 62px 60px", h1: 100, gapTop: 26, sub: 27, tileV: 50, charts: 2, viz1: 470, viz2: 400, cta: true, highlights: true, topRepos: true };
    case "4x5":
    default:
      return { pad: "52px 56px 40px", h1: 82, gapTop: 20, sub: 23, tileV: 40, charts: 2, viz1: 380, viz2: 320, cta: true, highlights: true, topRepos: false };
  }
}

/** Big number for a stat tile → { main, unit } (unit is "k"/"M" or ""). */
function heroNum(n, { full = false } = {}) {
  if (full || Math.abs(n) < 1000) return { main: n.toLocaleString("en-US"), unit: "" };
  if (Math.abs(n) < 1e6) return { main: (n / 1e3).toFixed(Math.abs(n) < 1e4 ? 1 : 0).replace(/\.0$/, ""), unit: "k" };
  return { main: (n / 1e6).toFixed(Math.abs(n) < 1e7 ? 1 : 0).replace(/\.0$/, ""), unit: "M" };
}

function tileHtml({ v, unit = "", k, cls = "" }) {
  const u = unit ? `<span class="u">${unit}</span>` : "";
  return `<div class="stat ${cls}"><div class="v tnum">${v}${u}</div><div class="k">${k}</div></div>`;
}

/** Choose 4 stat tiles from the totals, adapting to what data exists. */
function buildTiles(t) {
  const commits = heroNum(t.commits, { full: t.commits < 100000 });
  const tiles = [tileHtml({ v: commits.main, unit: commits.unit, k: "commits", cls: "r" })];

  if (t.linesOfCodeNow != null) {
    const loc = heroNum(t.linesOfCodeNow);
    tiles.push(tileHtml({ v: loc.main, unit: loc.unit, k: "lines of code<br>(total now)", cls: "g" }));
    tiles.push(tileHtml({ v: "+" + abbr(t.linesAdded), k: `lines added<br>&minus;${abbr(t.linesRemoved)} removed` }));
  } else {
    tiles.push(tileHtml({ v: "+" + abbr(t.linesAdded), k: "lines added", cls: "g" }));
    tiles.push(tileHtml({ v: (t.linesNet >= 0 ? "+" : "") + abbr(t.linesNet), k: `net lines<br>&minus;${abbr(t.linesRemoved)} removed` }));
  }

  if (t.repos > 1) {
    tiles.push(tileHtml({ v: String(t.repos), k: "repositories", cls: "g" }));
  } else {
    tiles.push(tileHtml({ v: String(t.activeDays), k: `active days<br>${t.longestStreakDays}-day streak` }));
  }
  return tiles.join("");
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso) {
  if (!iso) return "—";
  return `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/** Secondary "highlights" chip row — fills the taller canvases with real stats. */
function buildHighlights(t) {
  const chips = [
    { cv: String(t.busiestDay.commits || 0), ck: `busiest day &middot; ${shortDate(t.busiestDay.date)}` },
    { cv: `${t.longestStreakDays}d`, ck: "longest streak" },
    { cv: String(t.avgCommitsPerActiveDay), ck: "avg / active day" },
    { cv: abbr(t.filesTouched), ck: "files touched" },
  ];
  return chips.map((c) => `<div class="chip"><div class="cv tnum">${c.cv}</div><div class="ck">${c.ck}</div></div>`).join("");
}

/** Horizontal "most active repos" bar list (multi-repo only). */
function buildTopRepos(recap, c, limit) {
  const rows = recap.perRepo.filter((r) => r.commits > 0).slice(0, limit);
  if (rows.length < 2) return "";
  const max = rows[0].commits || 1;
  const list = rows
    .map((r) => {
      const w = Math.max((r.commits / max) * 100, 2).toFixed(1);
      return `<div class="rrow"><span class="nm">${esc(r.repo)}</span><span class="rb"><i style="width:${w}%"></i></span><span class="rc tnum">${r.commits.toLocaleString("en-US")}</span></div>`;
    })
    .join("");
  return `<div class="cblock"><div class="ct"><h2>Most active repos</h2><div class="legend">by commits</div></div><div class="rlist">${list}</div></div>`;
}

function chartsHtml(recap, theme, lay) {
  const c = theme.colors;
  const innerW = 968;
  const s = recap.series;

  const chart1Legend = s.linesAdded.some((v) => v > 0)
    ? `<span><i style="background:${c.green}"></i>commits</span><span><i class="ln" style="background:${c.amber}"></i>lines added</span>`
    : `<span><i style="background:${c.green}"></i>commits</span>`;

  let out = `<div class="cblock">
      <div class="ct"><h2>Commits &amp; lines / ${s.grain}</h2><div class="legend">${chart1Legend}</div></div>
      ${barLineChart({
        bars: s.commits,
        line: s.linesAdded.some((v) => v > 0) ? s.linesAdded : null,
        monthTicks: s.monthTicks,
        width: innerW,
        height: lay.viz1,
        barColor: c.green,
        lineColor: c.amber,
        grid: c.grid,
        id: "c1",
      })}
    </div>`;

  if (lay.charts >= 2) {
    const multi = recap.totals.repos > 1;
    const values = multi ? s.reposActiveCumulative : s.linesAddedCumulative;
    const title = multi ? "Repositories in flight" : "Cumulative lines written";
    const endLabel = multi ? String(recap.totals.repos) : abbr(values[values.length - 1] || 0);
    const legend = multi
      ? `1 &rarr; <b style="color:${c.green}">&nbsp;${recap.totals.repos}</b>&nbsp;codebases`
      : `&rarr; <b style="color:${c.green}">${abbr(values[values.length - 1] || 0)}</b>&nbsp;lines`;
    out += `<div class="cblock">
      <div class="ct"><h2>${title}</h2><div class="legend">${legend}</div></div>
      ${areaChart({ values, monthTicks: s.monthTicks, width: innerW, height: lay.viz2, color: c.green, grid: c.grid, endLabel, id: "c2" })}
    </div>`;
  }
  return out;
}

/**
 * Render a recap object to a full HTML document for the given format.
 * @param {object} recap  the recap JSON (from collect.mjs or your own)
 * @param {object} [opts] { format, theme } — theme overrides merged over default
 */
export function renderRecapHtml(recap, opts = {}) {
  const format = opts.format || "4x5";
  const dim = FORMATS[format] || FORMATS["4x5"];
  const lay = layoutFor(format);
  const theme = resolveTheme(opts.theme || recap.brand);
  const c = theme.colors;
  const b = theme.brand;
  const t = recap.totals;

  const defaultTitle = `${recap.period.label}, <span class="ac">recapped.</span>`;
  const titleHtml = b.title ? esc(b.title) : defaultTitle;

  const repoWord = t.repos === 1 ? "repository" : "repositories";
  const defaultSub = `<b>${t.commits.toLocaleString("en-US")}</b> commits &middot; <b>${abbr(t.linesAdded)}</b> lines written &middot; <b>${t.repos}</b> ${repoWord} &middot; <b>${t.activeDays}</b> active days`;
  const subHtml = b.subtitle != null ? esc(b.subtitle) : defaultSub;

  const ctaHtml =
    lay.cta && b.cta
      ? `<div class="cta"><span class="ic">&#9670;</span><span class="t">${esc(b.cta)}</span></div>`
      : "";
  // The CTA is optional; when shown it needs vertical room. Reclaim it by
  // dropping the secondary highlights strip and trimming the charts a touch,
  // so the lower chart never overflows past the fixed canvas height.
  if (ctaHtml) {
    lay.highlights = false;
    lay.viz1 = Math.max(180, lay.viz1 - 14);
    if (lay.viz2) lay.viz2 = Math.max(160, lay.viz2 - 14);
  }

  const footL = b.footerLeft || `${recap.period.since} → ${recap.period.until}`;
  const footR = b.footerRight || "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">${fontLink(theme)}
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bed:${c.bed};--panel:${c.panel};--edge:${c.edge};
    --ink:${c.ink};--ink2:${c.ink2};--ink3:${c.ink3};
    --red:${c.red};--redBr:${c.redBr};--green:${c.green};--amber:${c.amber};--grid:${c.grid};
    --f-display:${fontStack(theme, "display")};--f-word:${fontStack(theme, "wordmark")};
    --f-body:${fontStack(theme, "body")};--f-mono:${fontStack(theme, "mono")};
  }
  html,body{width:${dim.w}px;height:${dim.h}px}
  body{background:var(--bed);color:var(--ink);font-family:var(--f-body);-webkit-font-smoothing:antialiased;overflow:hidden;position:relative}
  body::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;
    background:radial-gradient(75% 40% at 82% -4%, ${hexA(c.red, 0.28)}, transparent 58%),
               radial-gradient(60% 34% at 4% 104%, ${hexA(c.green, 0.10)}, transparent 60%)}
  body::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:2;opacity:.32;
    background:repeating-linear-gradient(0deg, rgba(0,0,0,.14) 0 1px, transparent 1px 3px)}
  .tnum{font-variant-numeric:tabular-nums}
  .post{position:relative;z-index:1;width:${dim.w}px;height:${dim.h}px;padding:${lay.pad};display:flex;flex-direction:column}
  .brandbar{display:flex;align-items:center;gap:14px}
  .wordmark{font-family:var(--f-word);font-size:27px;color:var(--redBr);letter-spacing:.02em;text-shadow:0 0 18px ${hexA(c.red, 0.5)}}
  .brandbar .tag{font-family:var(--f-mono);font-size:15px;letter-spacing:.22em;text-transform:uppercase;color:var(--green)}
  .brandbar .sep{flex:1;height:2px;background:linear-gradient(90deg,var(--red),transparent)}
  h1{font-family:var(--f-display);font-weight:400;margin-top:${lay.gapTop}px;font-size:${lay.h1}px;line-height:.94;letter-spacing:.005em;text-transform:uppercase;max-width:15ch}
  h1 .ac{color:var(--redBr);text-shadow:0 0 22px ${hexA(c.redBr, 0.4)}}
  .sub{margin-top:18px;font-size:${lay.sub}px;line-height:1.42;color:var(--ink2);max-width:54ch;font-weight:300}
  .sub b{color:var(--ink);font-weight:600}
  .cta{margin-top:18px;display:flex;align-items:center;gap:16px;border:2px solid var(--red);border-radius:14px;padding:16px 22px;background:linear-gradient(180deg, ${hexA(c.red, 0.16)}, ${hexA(c.red, 0.04)})}
  .cta .ic{font-size:26px;line-height:1;color:var(--redBr)}
  .cta .t{font-size:${lay.sub}px;font-weight:600;color:var(--ink);line-height:1.3}
  .stats{display:flex;gap:11px;margin-top:22px}
  .stat{flex:1;background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:14px 14px 12px}
  .stat .v{font-family:var(--f-display);font-size:${lay.tileV}px;letter-spacing:.01em;line-height:1;color:var(--ink)}
  .stat .v .u{font-size:.45em;color:var(--ink2);margin-left:1px}
  .stat.g .v{color:var(--green)} .stat.r .v{color:var(--redBr)}
  .stat .k{margin-top:7px;font-family:var(--f-mono);font-size:11.5px;letter-spacing:.05em;color:var(--ink3);text-transform:uppercase;line-height:1.25}
  .highl{display:flex;gap:11px;margin-top:12px}
  .chip{flex:1;border:1px solid var(--edge);border-radius:10px;padding:11px 13px}
  .chip .cv{font-family:var(--f-display);font-size:26px;line-height:1;color:var(--ink)}
  .chip .ck{margin-top:6px;font-family:var(--f-mono);font-size:10.5px;letter-spacing:.04em;color:var(--ink3);text-transform:uppercase}
  .charts{margin-top:24px;display:flex;flex-direction:column;gap:22px}
  .rlist{display:flex;flex-direction:column;gap:10px;margin-top:4px}
  .rrow{display:flex;align-items:center;gap:14px;font-family:var(--f-mono);font-size:15px}
  .rrow .nm{width:220px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rrow .rb{flex:1;height:15px;background:var(--panel);border:1px solid var(--edge);border-radius:5px;overflow:hidden}
  .rrow .rb i{display:block;height:100%;background:var(--green);opacity:.85;border-radius:4px}
  .rrow .rc{width:70px;text-align:right;color:var(--ink)}
  .cblock .ct{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px}
  .cblock h2{font-family:var(--f-body);font-size:20px;font-weight:600;letter-spacing:.01em;text-transform:uppercase}
  .legend{display:flex;gap:14px;font-family:var(--f-mono);font-size:12px;color:var(--ink3)}
  .legend i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:5px;vertical-align:-1px}
  .legend .ln{width:16px;height:3px;border-radius:2px;vertical-align:3px}
  svg.viz{display:block;width:100%;height:auto;overflow:visible}
  .gridline{stroke:var(--grid);stroke-width:1}
  .glab{font-family:var(--f-mono);font-size:13px}
  .axlab{font-family:var(--f-mono);font-size:13px;fill:var(--ink3)}
  .peaklab{font-family:var(--f-mono);font-size:15px;font-weight:700}
  footer{margin-top:auto;padding-top:16px;display:flex;align-items:center;justify-content:space-between;font-family:var(--f-mono);font-size:16px;color:var(--ink3);border-top:1px solid var(--edge)}
  footer .l{color:var(--green)} footer .r{color:var(--redBr)}
</style></head>
<body><div class="post">
  <div class="brandbar"><span class="wordmark">${esc(b.wordmark)}</span><span class="tag">${esc(b.tag)}</span><span class="sep"></span></div>
  <h1>${titleHtml}</h1>
  ${subHtml ? `<p class="sub">${subHtml}</p>` : ""}
  ${ctaHtml}
  <div class="stats">${buildTiles(t)}</div>
  ${lay.highlights ? `<div class="highl">${buildHighlights(t)}</div>` : ""}
  <div class="charts">${chartsHtml(recap, theme, lay)}${lay.topRepos ? buildTopRepos(recap, c, 8) : ""}</div>
  <footer><span class="l">&#9698; ${esc(stripTags(footL))}</span><span class="r">${esc(footR)}</span></footer>
</div></body></html>`;
}

// Small helpers ---------------------------------------------------------------
function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, "");
}
/** Apply an alpha to a #rrggbb hex → rgba() string (passes rgba()/other through). */
function hexA(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
