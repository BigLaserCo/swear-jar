#!/usr/bin/env node
// Build docs/admin.html — the open debug / state-simulator console.
//
// No password, fully client-side, ZERO external requests. It renders the REAL
// dashboard template (src/dashboard.mjs) with synthetic ledgers so QA can eyeball
// every UI state without a real ~/.swear-jar, plus a couple of leaderboard/submit
// states authored inline. Every state document is embedded (JSON, with "<"
// escaped) and swapped into a same-origin <iframe srcdoc> on click — nothing is
// ever fetched.
//
//   node scripts/site/buildAdmin.mjs
//
// Deterministic: fixed NOW + hand-built record sets → byte-for-byte reproducible,
// exactly like scripts/site/buildDemo.mjs. Reads NOTHING real.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDashboard } from "../../src/dashboard.mjs";
import { computeStats } from "../../src/stats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(ROOT, "docs", "admin.html");

// Fixed instant so generatedAt / odds / date ranges are reproducible.
const NOW = Date.UTC(2026, 6, 10, 12, 0, 0); // 2026-07-10T12:00:00Z
const day = (d, h = 9) => new Date(Date.UTC(2026, 6, d, h, 0, 0)).toISOString();

// ── synthetic ledgers, hand-built (no PRNG needed for a handful of records) ──
const NORMAL = [
  { source: "user", project: "prod-hotfix-friday", ts: day(1, 9), words: { fuck: 2, shit: 1 }, coins: 8 },
  { source: "user", project: "prod-hotfix-friday", ts: day(1, 14), words: { damn: 1 }, coins: 1 },
  { source: "assistant", project: "prod-hotfix-friday", ts: day(1, 15), words: { shit: 1 }, coins: 2 },
  { source: "user", project: "cursed-regex", ts: day(2, 11), words: { fuck: 1, bitch: 1 }, coins: 5 },
  { source: "user", project: "cursed-regex", ts: day(3, 23), words: { motherfucker: 1 }, coins: 5 },
  { source: "user", project: "todo-app-v9", ts: day(4, 10), words: { hell: 1, crap: 1 }, coins: 2 },
  { source: "user", project: "todo-app-v9", ts: day(5, 16), words: { shit: 3 }, coins: 6 },
  { source: "assistant", project: "todo-app-v9", ts: day(5, 16), words: { damn: 1 }, coins: 1 },
  { source: "user", project: "legacy-jenga", ts: day(6, 22), words: { fuck: 2 }, coins: 6, polite: { please: 1 } },
  { source: "user", project: "legacy-jenga", ts: day(8, 9), words: { bollocks: 1 }, coins: 2 },
];

// gold star: more polite instances than swear instances.
const GOLD = [
  { source: "user", project: "very-polite-app", ts: day(2, 9), words: { damn: 1 }, coins: 1, polite: { please: 2, thanks: 2 } },
  { source: "user", project: "very-polite-app", ts: day(4, 10), words: { crap: 1 }, coins: 1, polite: { thanks: 1, sorry: 1, appreciate: 1 } },
];

// royalty: the machine has out-sworn the human.
const ROYALTY = [
  { source: "user", project: "quantum-blender", ts: day(3, 9), words: { damn: 1 }, coins: 1 },
  { source: "assistant", project: "quantum-blender", ts: day(3, 10), words: { fuck: 3, shit: 2 }, coins: 13 },
];

const dash = (recs) => renderDashboard(computeStats(recs, NOW), { donateUrl: false });

// ── auxiliary states authored inline (leaderboard / submit surfaces) ─────────
const auxDoc = (bodyHtml) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--bg:#0f1216;--panel:#171b21;--line:#272d37;--ink:#e8e6e1;--dim:#b9bfc8;--muted:#8a93a0;--faint:#5a626e;
--gold:#e8b23a;--ok:#5b8a72;--err:#d1543f;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.6;padding:26px}
h2{font:600 12px/1.2 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin:0 0 16px}
.card{background:linear-gradient(180deg,var(--panel),#13171d);border:1px solid var(--line);border-radius:14px;padding:20px;max-width:640px;margin:0 auto 16px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
th{font:600 10px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.badge{display:inline-block;font:600 10px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;padding:5px 8px;border-radius:999px;border:1px solid}
.badge.held{color:var(--gold);border-color:rgba(232,178,58,.5);background:rgba(232,178,58,.08)}
.reason{color:var(--dim);font-family:var(--mono);font-size:12.5px}
.notice{border-radius:12px;padding:16px 18px;font-size:14.5px;max-width:640px;margin:0 auto}
.notice.ok{background:#141b17;border:1px solid #2c3a33;color:var(--ok)}
.notice.err{background:#1b1213;border:1px solid #43272b;color:var(--err)}
.notice b{font-weight:700}
</style></head><body>${bodyHtml}</body></html>`;

const HELD = auxDoc(`
  <div class="card">
    <h2>🔍 Held for review — implausible rate</h2>
    <table>
      <thead><tr><th>Handle</th><th>Coins</th><th>Coins / day</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>Potty Mouth</td><td>1,240</td><td>62</td><td><span class="badge held">Ranks</span></td></tr>
        <tr><td>Definitely Human</td><td>48,900</td><td>4,300</td><td><span class="badge held">Held</span></td></tr>
      </tbody>
    </table>
    <p class="reason">Held: 4,300 coins per active day is implausibly high — excluded from the ranked boards until a human looks. Not called a fake, just parked.</p>
  </div>`);

const SUBMIT_OK = auxDoc(`
  <div class="notice ok"><b>Check your email.</b> We sent a confirmation link. Click it within 48 hours and your entry goes live on the board. Nothing is published until you do.</div>`);

const SUBMIT_ERR = auxDoc(`
  <div class="notice err"><b>Submission rejected.</b> A stat looks off — open this page via <span style="font-family:var(--mono)">swear-jar wrapped --submit</span> so the numbers fill in, then try again.</div>`);

// state key -> label + rendered document
const STATES = [
  ["normal", "Normal report", dash(NORMAL)],
  ["empty", "Empty jar", dash([])],
  ["gold", "Gold star", dash(GOLD)],
  ["royalty", "Royalty (machine out-swears you)", dash(ROYALTY)],
  ["held", "Held / implausible row", HELD],
  ["submitOk", "Submit success", SUBMIT_OK],
  ["submitErr", "Submit failure", SUBMIT_ERR],
];

// Embed every state document as JSON with "<" escaped so no embedded "</script>",
// "<script src", or URL can leak out of the data island into admin.html's own
// markup (same trick as src/dashboard.mjs safeJson).
const docMap = Object.fromEntries(STATES.map(([k, , html]) => [k, html]));
const blob = JSON.stringify(docMap)
  .replace(/</g, "\\u003c")
  .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
  .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");

const buttons = STATES.map(
  ([k, label], i) =>
    `<button class="stbtn${i === 0 ? " on" : ""}" data-state="${k}">${label}</button>`
).join("");

// Shared footer — kept identical across docs/*.html (index/tip/wrapped/admin).
const FOOTER = `<footer>
    <span><b>🫙 swear-jar</b> — from unfocused.ai. MIT-licensed · private preview.</span>
    <span>Follow the maker: <a href="https://tiktok.com/@biglaserco" rel="noopener">TikTok @biglaserco</a> · <a href="https://youtube.com/@BigLaserCo" rel="noopener">YouTube @BigLaserCo</a></span>
    <span><a href="index.html">Home</a> · <a href="demo.html">Demo report</a> · <a href="https://github.com/BigLaserCo/swear-jar">Source on GitHub</a></span>
  </footer>`;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>debug console — swear-jar</title>
<meta name="description" content="Open, client-side debug console for swear-jar: preview every dashboard state (normal, empty, gold star, royalty) plus leaderboard and submit states. No account, no data, nothing leaves your machine.">
<meta name="robots" content="noindex,nofollow">
<link rel="canonical" href="https://swearjar.unfocused.ai/admin.html">
<meta property="og:type" content="website">
<meta property="og:title" content="swear-jar debug console">
<meta property="og:description" content="Preview every swear-jar UI state. Client-side, zero requests.">
<meta property="og:url" content="https://swearjar.unfocused.ai/admin.html">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="swear-jar debug console">
<meta name="twitter:description" content="Preview every swear-jar UI state. Client-side, zero requests.">
<style>
  :root{--page:#0C0B0E;--section:#131117;--card:rgba(24,21,28,.7);--solid:#17141C;--input:#100E14;
    --heading:#F3EEE7;--primary:#EDE7DC;--secondary:#CFC6BA;--muted:#9C9288;--dim:#6F675E;--faint:#544D46;
    --accent:#E8623A;--accent-text:#F0805C;--gold:#F5C542;--green:#5FB07A;
    --div:rgba(255,255,255,.06);--bcard:rgba(255,255,255,.09);--baccent:rgba(232,98,58,.55);
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;background:var(--page);color:var(--primary);font-family:var(--sans);line-height:1.5}
  .wrap{max-width:1180px;margin:0 auto;padding:0 20px 60px}
  .topbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 0;border-bottom:1px solid var(--div)}
  .mark{font-size:22px}
  .wordmark{font:800 17px/1 var(--sans);letter-spacing:-.02em;color:var(--heading)}
  .wordmark .slash{color:var(--dim);font-weight:600}
  .tag{margin-left:auto;font:600 10px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--gold);
    border:1px solid rgba(245,197,66,.5);border-radius:999px;padding:6px 11px}
  .lede{color:var(--muted);font-size:14px;margin:18px 0 6px;max-width:70ch}
  .lede b{color:var(--secondary)}
  h2{font:600 11px/1.2 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--accent-text);margin:26px 0 12px}
  .gallery{display:flex;flex-wrap:wrap;gap:9px}
  .stbtn{appearance:none;font-family:var(--sans);font-size:13.5px;font-weight:600;color:var(--secondary);
    background:var(--input);border:1px solid var(--bcard);border-radius:10px;padding:10px 14px;cursor:pointer;transition:border-color .15s,color .15s}
  .stbtn:hover{border-color:var(--baccent);color:var(--accent-text)}
  .stbtn.on{border-color:var(--baccent);color:var(--accent-text);background:rgba(232,98,58,.08)}
  .editor{display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px;background:var(--card);border:1px solid var(--bcard);
    border-radius:14px;padding:16px 18px;margin-top:10px}
  .fld{display:flex;flex-direction:column;gap:6px}
  .fld label{font:600 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
  .fld input{width:130px;background:var(--input);border:1px solid var(--bcard);border-radius:9px;color:var(--primary);
    font-family:var(--mono);font-size:14px;padding:9px 11px;outline:none}
  .fld input:focus{border-color:var(--baccent)}
  .apply{appearance:none;font-family:var(--sans);font-size:14px;font-weight:700;color:var(--page);background:var(--accent);
    border:1px solid transparent;border-radius:10px;padding:10px 18px;cursor:pointer}
  .apply:hover{filter:brightness(1.06)}
  .hint{font:400 12px/1.5 var(--mono);color:var(--faint);width:100%;margin-top:2px}
  .frameWrap{margin-top:16px;border:1px solid var(--bcard);border-radius:14px;overflow:hidden;background:var(--solid)}
  iframe{display:block;width:100%;height:78vh;min-height:560px;border:0;background:var(--page)}
  footer{margin-top:40px;padding-top:22px;border-top:1px solid var(--div);font:500 12px/1.8 var(--mono);color:var(--faint);
    display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap}
  footer b{color:var(--muted);font-weight:600}
  footer a{color:var(--muted)}
  footer a:hover{color:var(--accent-text)}
  .toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);background:var(--solid);
    border:1px solid var(--gold);color:var(--primary);padding:12px 18px;border-radius:10px;font-size:13.5px;max-width:440px;
    opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;z-index:9}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
</style>
</head>
<body>
<div class="wrap">
  <header class="topbar">
    <span class="mark">🫙</span><span class="wordmark">swear-jar <span class="slash">/ debug console</span></span>
    <span class="tag">no auth · client-side · QA only</span>
  </header>

  <p class="lede">A wide-open state simulator for eyeballing the UI. It renders the <b>real</b> dashboard
    template with synthetic data — no account, no ledger, nothing leaves your machine. Every panel below
    is generated deterministically; there is nothing real to leak here.</p>

  <h2>State gallery</h2>
  <div class="gallery" id="gallery">${buttons}</div>

  <h2>Debug — live stats editor</h2>
  <div class="editor">
    <div class="fld"><label for="ed-coins">Coins</label><input id="ed-coins" type="text" inputmode="numeric" placeholder="e.g. 1240"></div>
    <div class="fld"><label for="ed-dollars">$ owed</label><input id="ed-dollars" type="text" inputmode="numeric" placeholder="e.g. 310"></div>
    <div class="fld"><label for="ed-odds">Odds %</label><input id="ed-odds" type="text" inputmode="numeric" placeholder="e.g. 4"></div>
    <button class="apply" id="apply">Apply</button>
    <p class="hint">Edits the numbers on the report shown below. Try to break it — that's the point.</p>
  </div>

  <!-- srcdoc content is our OWN deterministic, zero-network HTML, so it runs
       unsandboxed: the report template's inline scripts must execute to draw the
       waveform / KPIs / charts, and the editor below needs same-origin access. -->
  <div class="frameWrap"><iframe id="frame" title="swear-jar state preview"></iframe></div>

  <p class="lede" style="margin-top:22px">Want the shareable version instead? The public <a href="demo.html">demo report</a>
    is the same template with a full synthetic ledger.</p>

  ${FOOTER}
</div>
<div class="toast" id="toast"></div>

<script>
const STATES = /*__STATES__*/{};
const $ = (id) => document.getElementById(id);
const frame = $("frame");
let current = "normal";

function show(key){
  current = key;
  // srcdoc is same-origin with this page, so the editor below can reach into it.
  frame.srcdoc = STATES[key] || "";
  document.querySelectorAll(".stbtn").forEach(b => b.classList.toggle("on", b.dataset.state === key));
}

document.getElementById("gallery").addEventListener("click", (e) => {
  const btn = e.target.closest(".stbtn");
  if (btn) show(btn.dataset.state);
});

function toast(msg){ const t = $("toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 4200); }

// ── the live stats editor ────────────────────────────────────────────────────
// To the smart-ass reading the source hunting for the exploit: hi, we left this
// here for you. Client-side numbers are yours to vandalize; the real board checks
// provenance server-side (email-verified submissions, plausibility bounds, the
// held-for-review lane). Nothing you type here touches anything real — it edits
// pixels in an iframe on your own machine. Enjoy the star. ⭐
function applyEdits(){
  const doc = frame.contentDocument;
  if(!doc){ toast("Nothing to edit — pick a report state first."); return; }
  const coins = $("ed-coins").value.trim();
  const dollars = $("ed-dollars").value.trim();
  const odds = $("ed-odds").value.trim();
  const num = (s) => Number(String(s).replace(/[^0-9.]/g, ""));
  let touched = false;
  // dollars → the hero number
  const heronum = doc.getElementById("heronum");
  if(heronum && dollars !== ""){ heronum.textContent = Math.round(num(dollars)).toLocaleString("en-US"); touched = true; }
  // coins → first KPI tile value (and the wrapped card number)
  if(coins !== ""){
    const kpiV = doc.querySelector("#kpis .kpi .v");
    if(kpiV){ kpiV.textContent = "🤬 " + Math.round(num(coins)).toLocaleString("en-US"); touched = true; }
    const wnum = doc.getElementById("wnum");
    if(wnum){ wnum.textContent = Math.round(num(coins)).toLocaleString("en-US"); }
  }
  // odds → the gauge big number
  if(odds !== ""){
    const big = doc.querySelector("#gauge .big");
    if(big){ big.textContent = Math.round(num(odds)) + "%"; touched = true; }
  }
  if(!touched){ toast("Type a number first, then Apply."); return; }
  // it "works" — then, after a beat, the dry reveal.
  setTimeout(() => toast("Nice. That's your browser's copy. The leaderboard is validated server-side — but the jar respects the hustle. ⭐"), 700);
}
$("apply").addEventListener("click", applyEdits);

show("normal");
</script>
</body>
</html>`;

function main() {
  const html = PAGE.replace("/*__STATES__*/{}", () => blob);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, "utf8");
  const rel = path.relative(ROOT, OUT);
  console.log(`admin built → ${rel}`);
  console.log(`  ${STATES.length} states · ${(html.length / 1024).toFixed(0)}kb`);
}

main();
