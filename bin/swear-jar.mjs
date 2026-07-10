#!/usr/bin/env node
// swear-jar CLI — see README.md. The `scan` subcommand is the hook entry
// point and must NEVER exit non-zero or it could disrupt a Claude session.

import crypto from "node:crypto";
import path from "node:path";
import { scanTranscript, readHookPayload, loadTotals, backfill } from "../src/scan.mjs";
import { loadRecords, appendRecords } from "../src/ledger.mjs";
import { renderStatus, renderReport, clinkLine, dollars } from "../src/render.mjs";
import { detect } from "../src/detect.mjs";
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
      console.log(
        `\n🫙 Backfill complete.\n` +
          `  Transcripts scanned: ${summary.scanned}\n` +
          `  New records:         ${summary.newRecords}` +
          codexLine +
          `\n  Jar balance:         ${dollars(summary.jar)}  (${totals.user + totals.assistant} coins)`
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
    case "import-superwhisper": {
      // Import historical Superwhisper dictation into its OWN never-summed
      // ledger (dictation.jsonl). It measures swears-per-dictation and would
      // double-count dictated prompts, so it is kept out of the main jar.
      const explicit = flag("root");
      const root = explicit || defaultSuperwhisperRoot();
      if (!root) {
        console.log("🫙 Couldn't find your Superwhisper recordings folder.");
        console.log("   Point me at it:  swear-jar import-superwhisper --root <dir>");
        console.log("   (Superwhisper › Settings › Recordings shows the exact path.)");
        break;
      }
      const res = importSuperwhisper(root);
      console.log(
        `🫙 Superwhisper import complete.\n` +
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
          "  swear-jar import-superwhisper [--root <dir>]  import Superwhisper dictation (separate ledger)",
          "  swear-jar dashboard           write the shareable HTML report (prints path)",
          "  swear-jar report [--by project|source|word|hour] [--dictation]",
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
