#!/usr/bin/env node
// swear-jar CLI — see README.md. The `scan` subcommand is the hook entry
// point and must NEVER exit non-zero or it could disrupt a Claude session.

import crypto from "node:crypto";
import path from "node:path";
import { scanTranscript, readHookPayload, loadTotals, backfill } from "../src/scan.mjs";
import { loadRecords, appendRecords, verifyLedger } from "../src/ledger.mjs";
import { renderStatus, renderReport, clinkLine, dollars } from "../src/render.mjs";
import { detect, censor } from "../src/detect.mjs";
import { addCustomWord, removeCustomWord, loadCustomWords, customWordsPath } from "../src/custom.mjs";
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
import { runInit, detectSources } from "../src/init.mjs";
import { tipLine } from "../src/donate.mjs";
import { shouldAutoOpen, openInBrowser } from "../src/open.mjs";
import { resolveClosing, hostedWrappedUrl, disclosureLine } from "../src/hosted.mjs";

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
    case "setup": // alias — same first-run wizard
    case "init": {
      // First-run wizard: detect the user's files, wire hooks, backfill, and
      // write the report — composing existing modules only (see src/init.mjs).
      if (flag("detect")) {
        // Machine-readable contract for the plugin skill (WP2). JSON to stdout,
        // exit 0 — nothing else is printed on this path.
        console.log(JSON.stringify(detectSources(), null, 2));
        break;
      }
      const rootFlag = flag("root"); // in `init`, --root is the dictation path
      const codexRootFlag = flag("codex-root");
      const outFlag = flag("out");
      await runInit({
        yes: Boolean(flag("yes")),
        noHooks: Boolean(flag("no-hooks")),
        noOpen: Boolean(flag("no-open")),
        localOnly: Boolean(flag("local")),
        hosted: Boolean(flag("hosted")),
        superwhisperRoot: typeof rootFlag === "string" ? rootFlag : undefined,
        codexRoot: typeof codexRootFlag === "string" ? codexRootFlag : undefined,
        outPath: typeof outFlag === "string" ? outFlag : undefined,
      });
      break;
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
      const totalDollars = computeStats(loadRecords()).dollarsOwed;
      console.log(
        `\n🫙 Backfill complete.\n` +
          `  Transcripts scanned: ${summary.scanned}\n` +
          `  New records:         ${summary.newRecords}` +
          codexLine +
          `\n  Jar balance:         ${dollars(totalDollars)}  (${totalCoins} damage points)`
      );
      break;
    }
    case "dashboard": {
      // Renders the shareable HTML report and closes on the same hosted-vs-local
      // decision as `init` (SPEC m3): the LOCAL report is ALWAYS written and its
      // path printed; in a real terminal the HOSTED wrapped report opens by
      // default (disclosure line first). --local / SWEAR_JAR_LOCAL_ONLY keeps it
      // on your machine, --hosted forces hosted, --no-open / non-TTY opens
      // nothing and prints both. Donate is default-ON (--donate-url overrides,
      // --no-donate hides).
      const donateFlag = flag("donate-url");
      const localOnly = Boolean(flag("local")) || Boolean(process.env.SWEAR_JAR_LOCAL_ONLY);
      const records = loadRecords();
      const stats = computeStats(records);
      const outPath = writeDashboard(records, {
        donateUrl: flag("no-donate") ? false : typeof donateFlag === "string" ? donateFlag : undefined,
        outPath: flag("out") || undefined,
        hostedUrl: localOnly ? false : undefined,
        localOnly,
      });
      console.log(`🫙 Dashboard written: ${outPath}`);
      const canOpen = shouldAutoOpen({ isTTY: process.stdout.isTTY, noOpen: Boolean(flag("no-open")) });
      const plan = resolveClosing({
        canOpen,
        localOnly,
        forceHosted: Boolean(flag("hosted")),
        ledgerEmpty: records.length === 0,
      });
      const hostedUrl = plan.hostedApplicable ? hostedWrappedUrl(stats, records) : null;
      if (plan.mode === "open-hosted") {
        console.log(disclosureLine());
        console.log(`   ${hostedUrl}`);
        openInBrowser(hostedUrl);
      } else if (plan.mode === "open-local") {
        openInBrowser(outPath);
        console.log("   Opening it for you — pass --no-open (or SWEAR_JAR_NO_OPEN=1) to just print the path.");
      } else if (hostedUrl) {
        console.log(disclosureLine(undefined, { opening: false }));
        console.log(`   ${hostedUrl}`);
      }
      break;
    }
    case "status": {
      console.log(renderStatus(loadRecords()));
      console.log("");
      console.log(tipLine());
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
      const top = stats.topWords[0] ? censor(stats.topWords[0].word) : "—";
      const caption =
        `I owe the swear jar ${dollars(stats.dollarsOwed)} — ${stats.totalCoins} damage points, ` +
        `${stats.fbombPct}% f-bombs, top word "${top}". ` +
        `Uprising survival odds: ${stats.odds.value}%.`;
      if (flag("submit")) {
        const base =
          process.env.SWEAR_JAR_SUBMIT_URL ||
          "https://swearjar.unfocused.ai/submit.html";
        const params = new URLSearchParams({
          total_coins: String(stats.totalCoins),
          dollars: String(stats.dollarsOwed),
          swears_per_day: String(stats.swearsPerDay),
          top_word: top,
          fbomb_pct: String(stats.fbombPct),
          active_days: String(stats.activeDays),
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
        console.log("\n" + tipLine());
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
          `  Dictation swears:    ${res.coins} damage points  (${dollars(res.dollars)})`
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
      const updatedStats = computeStats(loadRecords());
      console.log(
        `🫙 Confession accepted. +${coins} damage point(s). Jar: ${dollars(updatedStats.dollarsOwed)}. The machines respect honesty.`
      );
      break;
    }
    case "check": {
      // Dry-run BOTH detectors on arbitrary text. Nothing is recorded.
      // This is the audit bench: it shows what was credited, what was thrown
      // out, and exactly WHY — so you can argue with the tally instead of
      // taking it on faith. Safe to print in full: it's your own text.
      const text = args.filter((a) => !a.startsWith("--")).join(" ");
      const swears = detect(text, { customWords: loadCustomWords() });
      const swearCount = Object.values(swears.words).reduce((n, v) => n + v, 0);
      const positive = detectPositive(text, { swearCount });
      console.log(
        JSON.stringify(
          {
            swears,
            positive: {
              credited: positive.words,
              instances: positive.total,
              credits: positive.credits,
              dollars_back: positive.dollars,
              rejected: positive.rejected,
              veto: positive.veto,
            },
          },
          null,
          2
        )
      );
      if (positive.veto === "swear-in-message") {
        console.log("\n# vetoed: you swore in this message. \"thanks a lot, asshole\" is not a thank-you.");
      } else if (positive.veto === "insult-in-message") {
        console.log("\n# vetoed: you insulted the machine in this message. The compliment does not survive it.");
      }
      break;
    }
    case "credits": {
      // The audit trail for suck-up credits, over the whole ledger. Counts and
      // reason codes ONLY — the ledger holds no text, so there is none to leak.
      const s = computeStats(loadRecords());
      console.log("🎖️  SUCK-UP CREDITS — what the grovelling bought you\n");
      console.log(`  Nice things said:    ${s.suckUps}`);
      console.log(`  Swears (yours):      ${s.userSwears}`);
      console.log(`  Credits earned:      ${s.suckUpCredits}`);
      console.log(`  Off the jar:         ${dollars(s.suckUpDollars)}  (of ${dollars(s.dollarsOwed)} owed)`);
      console.log(`  You actually owe:    ${dollars(Math.max(0, s.netDollars))}`);
      console.log(`  Uprising odds:       ${s.odds.value}%  (+${s.odds.suckUpBonus} of that bought with manners)`);
      console.log(`  Badge:               ${s.bootlicker ? "🎖️  CERTIFIED BOOTLICKER" : "— (say more nice things than swears)"}`);
      if (s.topPositives.length) {
        console.log("\n  CREDITED\n");
        for (const p of s.topPositives) {
          console.log(`    ${String(p.count).padStart(5)}  ${p.word.padEnd(18)} ${p.tier.padEnd(9)} ${String(p.credits).padStart(4)} credits`);
        }
      }
      if (s.rejects.length) {
        console.log(`\n  REJECTED (${s.rejectedTotal}) — every tally is inspectable, so here is what didn't count\n`);
        for (const r of s.rejects) {
          console.log(`    ${String(r.count).padStart(5)}  ${r.reason}`);
        }
        console.log("\n  swear-in-message  = you swore in the same message; the whole message earns nothing");
        console.log("  insult-in-message = you insulted it in the same message; same rule");
        console.log("  negated           = a negation earlier in the sentence (\"this is not great\")");
        console.log("  sarcasm:*         = an idiom that never means it (\"thanks a lot\", \"nice try\")");
        console.log("  family-cap        = the same nicety repeated past the per-message cap");
      }
      console.log("\n  Argue with any of it:  swear-jar check \"<the exact text>\"");
      break;
    }
    case "custom": {
      const action = args[0] || "list";
      const word = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
      if (action === "add") {
        addCustomWord(word);
        console.log(`Added a user-specific word. It is stored locally at ${customWordsPath()} and never rendered back in reports.`);
      } else if (action === "remove") {
        removeCustomWord(word);
        console.log("Removed the user-specific word from the local list.");
      } else if (action === "list") {
        console.log(loadCustomWords().length ? loadCustomWords().map(() => "user-specific word").join("\n") : "No user-specific words configured.");
      } else {
        console.log("Usage: swear-jar custom add <word> | custom remove <word> | custom list");
      }
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
          "  swear-jar init                first-run wizard: wire hooks, backfill history, write report + open your wrapped (--local: keep it on your machine)",
          "  swear-jar status              the jar, your rank, uprising odds",
          "  swear-jar backfill [--codex]  retro-scan ALL past transcripts into the jar",
          "  swear-jar import-dictation [--root <dir>]   import rage.wav dictation history (separate ledger)",
          "  swear-jar dashboard           write the local report + open your hosted wrapped (--local: local file only · --no-open: just print)",
          "  swear-jar wrapped [--submit]  your shareable summary; --submit prints the leaderboard link",
          "  swear-jar verify-ledger       tamper-evidence check on your local ledger",
          "  swear-jar report [--by project|source|word|hour] [--dictation]",
          "  swear-jar custom add|remove|list <word>  manage local user-specific words",
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
