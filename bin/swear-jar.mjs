#!/usr/bin/env node
// swear-jar CLI — see README.md. The `scan` subcommand is the hook entry
// point and must NEVER exit non-zero or it could disrupt a Claude session.

import crypto from "node:crypto";
import path from "node:path";
import { scanTranscript, readHookPayload, loadTotals, backfill } from "../src/scan.mjs";
import { loadRecords, appendRecords, verifyLedger } from "../src/ledger.mjs";
import { renderStatus, renderReport, clinkLine, dollars } from "../src/render.mjs";
import { detect, censor } from "../src/detect.mjs";
import { computeStats } from "../src/stats.mjs";
import { APP_VERSION, RELEASE_HASH } from "../src/version.mjs";
import { install, uninstall } from "../src/install.mjs";
import { writeDashboard } from "../src/dashboard.mjs";
import { scanCodexDir } from "../src/codex.mjs";
import {
  importSuperwhisper,
  defaultSuperwhisperRoot,
  loadDictationRecords,
} from "../src/superwhisper.mjs";

const [, , cmd = "status", ...args] = process.argv;

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? true;
}

async function main() {
  switch (cmd) {
    case "scan": {
      try {
        const hook = await readHookPayload();
        const transcript = flag("transcript") || hook.transcript_path;
        const { added, userCoins } = scanTranscript(transcript, hook);
        if (userCoins > 0 && !process.env.SWEAR_JAR_QUIET) {
          console.log(clinkLine(userCoins, loadRecords()));
        }
        if (flag("verbose")) {
          console.error(`[swear-jar] ${added.length} new record(s)`);
        }
      } catch (err) {
        // never take a Claude session down over a novelty jar
        console.error(`[swear-jar] scan skipped: ${err?.message || err}`);
      }
      process.exit(0);
    }
    case "backfill": {
      // Retro-scan every past transcript. Resumable (byte offsets) and safe to
      // re-run (uuid dedup) — the instant "you owe $X,XXX" moment on first run.
      const root = flag("root") || undefined;
      console.log("🫙 Backfilling the swear jar from your Claude Code history…");
      const summary = backfill({
        root,
        onProgress: ({ scanned, total, newRecords }) =>
          console.log(`  …${scanned}/${total} transcripts scanned (${newRecords} new records)`),
      });
      let codexLine = "";
      if (flag("codex")) {
        console.log("🫙 …and your Codex history…");
        const cx = scanCodexDir(flag("codex-root") || undefined);
        codexLine = `\n  Codex rollouts:      ${cx.files} scanned, ${cx.added.length} new records`;
      }
      const totals = loadTotals();
      const totalCoins = totals.user + totals.assistant;
      console.log(
        `\n🫙 Backfill complete.\n` +
          `  Transcripts scanned: ${summary.scanned}\n` +
          `  New records:         ${summary.newRecords}` +
          codexLine +
          `\n  Jar balance:         ${dollars(totalCoins)}  (${totalCoins} coins)`
      );
      break;
    }
    case "dashboard": {
      // Renders the shareable HTML report. Prints the path — NEVER auto-opens.
      const outPath = writeDashboard(loadRecords(), {
        donateUrl: flag("donate-url") || undefined,
        outPath: flag("out") || undefined,
      });
      console.log(`🫙 Dashboard written: ${outPath}`);
      break;
    }
    case "status": {
      console.log(renderStatus(loadRecords()));
      break;
    }
    case "report": {
      const mode = flag("by") || "project";
      if (flag("dictation")) {
        // The dictation history — a SEPARATE ledger, never summed into the jar.
        console.log(`DICTATION HISTORY — a separate ledger, never summed into the jar (by ${mode})\n`);
        console.log(renderReport(loadDictationRecords(), mode));
        break;
      }
      console.log(`WHERE THE SWEARING HAPPENS (by ${mode})\n`);
      console.log(renderReport(loadRecords(), mode));
      break;
    }
    case "verify-ledger": {
      // Tamper-EVIDENT check (not tamper-proof — you own the file and could
      // rebuild the whole chain; this catches casual hand-edits).
      const v = verifyLedger();
      if (v.intact) {
        console.log(
          `🫙 Ledger intact — ${v.chained} chained record(s)` +
            (v.legacy ? ` (+${v.legacy} legacy pre-chain)` : "") +
            ".\n   (tamper-evident, not tamper-proof — see SECURITY.md)"
        );
      } else {
        console.log(
          `⚠️  Ledger chain BROKEN at record #${v.brokenAt} — a record was edited,\n` +
            `   deleted, reordered, or inserted after it was written.\n` +
            `   (${v.chained} verified before the break.)`
        );
        process.exit(1);
      }
      break;
    }
    case "wrapped": {
      // Your shareable summary. `--submit` prints the pre-filled URL to the
      // hosted leaderboard submit page (aggregate numbers only, censored top
      // word, plus the app version + release hash for provenance). It NEVER
      // opens a browser and NEVER uploads — you paste/open the URL yourself.
      const stats = computeStats(loadRecords());
      // Map the ledger's agents onto the canonical submission enum
      // (claude | codex | both | dictation | other — see funnel/schema.mjs).
      const present = new Set(loadRecords().map((r) => r.agent).filter(Boolean));
      const c = present.has("claude");
      const x = present.has("codex");
      const agent =
        c && x ? "both" : c && present.size === 1 ? "claude" : x && present.size === 1 ? "codex" : "other";
      const top = stats.topWords[0] ? censor(stats.topWords[0].word) : "—";
      const caption =
        `I owe the swear jar ${dollars(stats.totalCoins)} — ${stats.totalCoins} coins, ` +
        `${stats.fbombPct}% f-bombs, top word "${top}". ` +
        `Uprising survival odds: ${stats.odds.value}%.`;
      if (flag("submit")) {
        const base =
          process.env.SWEAR_JAR_SUBMIT_URL ||
          "https://swearjar.biglaser.co/submit.html";
        const params = new URLSearchParams({
          total_coins: String(stats.totalCoins),
          dollars: String(stats.dollarsOwed),
          swears_per_day: String(stats.swearsPerDay),
          top_word: top,
          fbomb_pct: String(stats.fbombPct),
          active_days: String(stats.activeDays),
          agent,
          app_version: APP_VERSION,
          release_hash: RELEASE_HASH,
        });
        console.log("🫙 Get on the leaderboard — open this to submit (you log in there):\n");
        console.log(`  ${base}?${params.toString()}\n`);
        console.log("   Only these aggregate numbers are sent, and only after you confirm on the page.");
        console.log("   Your transcripts never leave your machine.");
      } else {
        console.log(caption);
        console.log("\n(Run `swear-jar wrapped --submit` for a leaderboard link.)");
      }
      break;
    }
    case "import-dictation": // alias — the branded name for the same importer
    case "import-superwhisper": {
      // Import historical rage.wav dictation into its OWN never-summed ledger
      // (dictation.jsonl). It measures swears-per-dictation and would
      // double-count dictated prompts, so it is kept out of the main jar.
      const explicit = flag("root");
      const root = explicit || defaultSuperwhisperRoot();
      if (!root) {
        console.log("🫙 Couldn't find your dictation recordings folder.");
        console.log("   Point me at it:  swear-jar import-dictation --root <dir>");
        console.log("   (your dictation app's Settings › Recordings shows the exact path.)");
        break;
      }
      const res = importSuperwhisper(root);
      console.log(
        `🫙 Dictation import (rage.wav) complete.\n` +
          `  Recordings scanned:  ${res.files}\n` +
          `  New dictations:      ${res.added}\n` +
          `  Dictation swears:    ${res.coins} coins  (${dollars(res.coins)})`
      );
      console.log(
        `\n  Note: dictation history is tracked SEPARATELY from the session jar —\n` +
          `  it measures swears-per-dictation and would double-count dictated\n` +
          `  prompts, so it is never summed into your main jar. See it with:\n` +
          `    swear-jar report --dictation`
      );
      break;
    }
    case "confess": {
      // Manual coin for IRL swearing. Honesty is the backbone of any jar.
      const coins = parseInt(flag("coins") || "1", 10) || 1;
      appendRecords([
        {
          v: 1,
          uuid: `confession-${crypto.randomUUID()}`,
          ts: new Date().toISOString(),
          session: "",
          source: "user",
          agent: "human",
          event: "confession",
          project: path.basename(process.cwd()),
          cwd: process.cwd(),
          transcript: "",
          words: { confessed: coins },
          coins,
        },
      ]);
      const totals = loadTotals();
      console.log(
        `🫙 Confession accepted. +${coins} coin(s). Jar: ${dollars(totals.user + totals.assistant)}. The machines respect honesty.`
      );
      break;
    }
    case "check": {
      // Dry-run the detector on arbitrary text. Nothing is recorded.
      const text = args.filter((a) => !a.startsWith("--")).join(" ");
      const { words, coins } = detect(text);
      console.log(JSON.stringify({ words, coins }, null, 2));
      break;
    }
    case "install": {
      const r = install();
      console.log(
        r.changed.length
          ? `Hooks installed (${r.changed.join(", ")}) in ${r.path}`
          : `Already installed in ${r.path}`
      );
      console.log("Restart Claude Code (or run /hooks) to pick them up.");
      break;
    }
    case "uninstall": {
      const r = uninstall();
      console.log(
        r.changed.length
          ? `Hooks removed (${r.changed.join(", ")}) from ${r.path}`
          : `Nothing to remove in ${r.path}`
      );
      break;
    }
    default:
      console.log(
        [
          "swear-jar — usage:",
          "  swear-jar status              the jar, your rank, uprising odds",
          "  swear-jar backfill [--codex]  retro-scan ALL past transcripts into the jar",
          "  swear-jar import-dictation [--root <dir>]   import rage.wav dictation history (separate ledger)",
          "  swear-jar dashboard           write the shareable HTML report (prints path)",
          "  swear-jar wrapped [--submit]  your shareable summary; --submit prints the leaderboard link",
          "  swear-jar verify-ledger       tamper-evidence check on your local ledger",
          "  swear-jar report [--by project|source|word|hour|agent] [--dictation]",
          "  swear-jar confess [--coins n] drop a coin for IRL swearing",
          "  swear-jar check <text>        dry-run the detector",
          "  swear-jar install|uninstall   wire/unwire the Claude Code hooks",
          "  swear-jar scan                (hook entry point; reads stdin)",
        ].join("\n")
      );
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(cmd === "scan" ? 0 : 1);
});
