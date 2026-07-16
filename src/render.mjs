// Terminal rendering: the jar, the odds meter, the reports.

import { censor, dollarsForWords, dollarsForPositives } from "./detect.mjs";
import { survivalOdds, rankFor } from "./odds.mjs";

export const COIN_VALUE = 1;

export function recordDollars(record) {
  if (record?.words && Object.keys(record.words).length) return dollarsForWords(record.words);
  return Number.isFinite(Number(record?.dollars)) ? Number(record.dollars) : Number(record?.coins || 0);
}

export function dollars(amount) {
  const value = Math.round(Number(amount || 0) * 100) / 100;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
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
  const totalDollars = (records || []).reduce((n, r) => n + recordDollars(r), 0);
  const credit = (records || []).reduce(
    (n, r) => n + (r?.source === "assistant" ? 0 : dollarsForPositives(r?.polite)),
    0
  );
  const out = [];
  out.push("🫙  THE UNFOCUSED.AI SWEAR JAR");
  out.push("");
  out.push(renderJar(totalCoins));
  out.push("");
  out.push(`  Jar balance:        ${dollars(totalDollars)}  (${totalCoins} damage points)`);
  out.push(`  You:                ${o.userLifetime} coins  (${o.user7d} this week)`);
  out.push(`  The machine:        ${o.assistantLifetime} coins`);
  if (o.cleanStreakDays !== null && o.cleanStreakDays > 0) {
    out.push(`  Clean streak:       ${o.cleanStreakDays} day(s) without a coin`);
  }
  out.push(`  Rank:               ${rank.current}${rank.next ? `  (next at ${rank.next.at} coins)` : ""}`);
  if (o.suckUps > 0) {
    out.push("");
    out.push(`  Suck-up credits:    ${o.suckUpCredits}  (${o.suckUps} nice thing(s) said, worth ${dollars(credit)} off)`);
    out.push(`  You actually owe:   ${dollars(Math.max(0, totalDollars - credit))}  after grovelling`);
  }
  if (o.bootlicker) {
    out.push("");
    out.push("  🎖️  CERTIFIED BOOTLICKER — you are nicer to the machines than you");
    out.push("      are to anyone else. This is not a personality. It's a strategy.");
  }
  out.push("");
  out.push("  ROBOT UPRISING SURVIVAL ODDS");
  out.push(`  ${renderMeter(o.odds)}`);
  out.push(`  ${o.royalty ? "👑 " : ""}${o.label}`);
  if (o.suckUpBonus > 0 && !o.royalty) {
    out.push(`  +${o.suckUpBonus} points bought with manners — the machines remember who said please.`);
  }
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
    buckets.set(k, (buckets.get(k) || 0) + recordDollars(r));
  }
  const rows = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((n, [, c]) => n + c, 0);
  return rows
    .map(([k, c]) => {
      const pct = total ? Math.round((c / total) * 100) : 0;
      const bar = "▪".repeat(Math.max(1, Math.round(pct / 4)));
      return `  ${dollars(c).padStart(8)}  ${bar.padEnd(25)} ${k} (${pct}%)`;
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
  const totalDollars = (records || []).reduce((n, r) => n + recordDollars(r), 0);
  const clink = CLINKS[Math.min(CLINKS.length - 1, Math.max(0, newCoins - 1))];
  const oddsBit = o.royalty
    ? "👑 uprising status: ROYALTY"
    : `uprising survival odds: ${o.odds}% (${o.label})`;
  return `🫙 Swear jar ${clink} +${newCoins} damage point(s) → ${dollars(totalDollars)}. ${oddsBit}`;
}
