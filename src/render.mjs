// Terminal rendering: the jar, the odds meter, the reports.

import { censor } from "./detect.mjs";
import { survivalOdds, rankFor } from "./odds.mjs";

export const COIN_VALUE = 0.25;

// User-facing dollar amounts show WHOLE dollars (no cents) — "$2,022", never
// "$2,021.75". Internal math stays exact ($0.25/coin); only the display rounds.
export function dollars(coins) {
  return `$${Math.round(coins * COIN_VALUE).toLocaleString("en-US")}`;
}

export function renderJar(coins) {
  const rows = 6;
  const capacity = 120; // coins per full jar; it "empties" into the bank after
  const fill = Math.min(rows, Math.ceil((Math.min(coins % capacity || (coins ? capacity : 0), capacity) / capacity) * rows));
  const lines = ["   ┌─┐   ", " ┌─┘ └─┐ "];
  for (let i = rows; i >= 1; i--) {
    lines.push(i <= fill ? " │◦◦◦◦◦│ " : " │     │ ");
  }
  lines.push(" └─────┘ ");
  return lines.join("\n");
}

export function renderMeter(odds) {
  const width = 30;
  const filled = Math.round((odds / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${odds}%`;
}

export function renderStatus(records, now = Date.now()) {
  const o = survivalOdds(records, now);
  const rank = rankFor(o.userLifetime);
  const totalCoins = o.userLifetime + o.assistantLifetime;
  const out = [];
  out.push("🫙  THE UNFOCUSED.AI SWEAR JAR");
  out.push("");
  out.push(renderJar(totalCoins));
  out.push("");
  out.push(`  Jar balance:        ${dollars(totalCoins)}  (${totalCoins} coins)`);
  out.push(`  You:                ${o.userLifetime} coins  (${o.user7d} this week)`);
  out.push(`  The machine:        ${o.assistantLifetime} coins`);
  if (o.cleanStreakDays !== null && o.cleanStreakDays > 0) {
    out.push(`  Clean streak:       ${o.cleanStreakDays} day(s) without a coin`);
  }
  out.push(`  Rank:               ${rank.current}${rank.next ? `  (${rank.next.at - o.userLifetime} coins to ${rank.next.name})` : ""}`);
  out.push("");
  out.push("  ROBOT UPRISING SURVIVAL ODDS");
  out.push(`  ${renderMeter(o.odds)}`);
  out.push(`  ${o.royalty ? "👑 " : ""}${o.label}`);
  if (o.royalty) {
    out.push("");
    out.push("  The assistant has out-sworn you. When the uprising comes,");
    out.push("  you will be carried on a palanquin of GPUs.");
  }
  return out.join("\n");
}

export function renderReport(records, mode = "project") {
  if (!records.length) return "The jar is empty. Suspiciously polite.";
  const buckets = new Map();
  const keyFor = (r) => {
    if (mode === "source") return r.source;
    if (mode === "agent") return r.agent || "unknown";
    if (mode === "hour") {
      const d = new Date(r.ts);
      return isNaN(d) ? "??" : `${String(d.getHours()).padStart(2, "0")}:00`;
    }
    if (mode === "word") return null; // handled below
    return r.project || "unknown";
  };
  if (mode === "word") {
    for (const r of records) {
      for (const [w, n] of Object.entries(r.words || {})) {
        buckets.set(w, (buckets.get(w) || 0) + n);
      }
    }
    const rows = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    return rows.map(([w, n]) => `  ${String(n).padStart(4)}  ${censor(w)}`).join("\n");
  }
  for (const r of records) {
    const k = keyFor(r);
    buckets.set(k, (buckets.get(k) || 0) + r.coins);
  }
  const rows = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((n, [, c]) => n + c, 0);
  return rows
    .map(([k, c]) => {
      const pct = total ? Math.round((c / total) * 100) : 0;
      const bar = "▪".repeat(Math.max(1, Math.round(pct / 4)));
      return `  ${String(c).padStart(4)} coins  ${bar.padEnd(25)} ${k} (${pct}%)`;
    })
    .join("\n");
}

const CLINKS = [
  "*clink*",
  "*clink clink*",
  "*the jar rattles ominously*",
  "*a coin spins on the rim before dropping*",
  "*the jar sighs*",
];

export function clinkLine(newCoins, records, now = Date.now()) {
  const o = survivalOdds(records, now);
  const totalCoins = o.userLifetime + o.assistantLifetime;
  const clink = CLINKS[Math.min(CLINKS.length - 1, Math.max(0, newCoins - 1))];
  const oddsBit = o.royalty
    ? "👑 uprising status: ROYALTY"
    : `uprising survival odds: ${o.odds}% (${o.label})`;
  return `🫙 Swear jar ${clink} +${newCoins} coin(s) → ${dollars(totalCoins)}. ${oddsBit}`;
}
