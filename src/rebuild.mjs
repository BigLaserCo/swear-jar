// Re-derive the whole ledger from your transcripts.
//
// WHY THIS EXISTS: the ledger is DERIVED data, but it is written append-only
// and deduped by message uuid — which is exactly what makes it trustworthy
// (a re-scan can never double-charge you). The cost of that guarantee is that
// a record, once written, never learns anything new. When the detector gains
// a whole new dimension — suck-up credits — every message you already scanned
// is frozen without it, and the new feature reads as an empty room.
//
// So: archive the old ledger, throw away the derived records, and re-derive
// them from the transcripts, which are still sitting on your disk and are the
// real source of truth. Nothing is invented and nothing is uploaded; the same
// scanners run over the same files.
//
// Confessions are the one thing that CANNOT be re-derived — you typed them at
// the CLI and no transcript remembers them — so they are carried across.

import fs from "node:fs";
import { loadRecords, ledgerPath, statePath, appendRecords } from "./ledger.mjs";
import { backfill, claudeProjectsRoot } from "./scan.mjs";
import { scanCodexDir, defaultCodexRoot } from "./codex.mjs";

// A record nobody can rebuild from a file on disk. Today that is exactly the
// manual confessions (`swear-jar confess`).
export function isIrreplaceable(record) {
  return record?.event === "confession" || record?.agent === "human";
}

export function rebuildLedger({ root, codexRoot, codex = true, now = new Date() } = {}) {
  const before = loadRecords();
  const backup = `${ledgerPath()}.bak-${now.toISOString().replace(/[:.]/g, "-")}`;

  // 1. Archive FIRST. If anything below goes wrong, the old jar is still there.
  if (fs.existsSync(ledgerPath())) fs.copyFileSync(ledgerPath(), backup);

  // 2. Keep what can't be re-derived; drop the rest.
  const keep = before.filter(isIrreplaceable);

  // 3. Clear the ledger AND the byte-offset state, so every transcript is read
  //    from zero. (Dropping the ledger is what releases the uuid dedup.)
  fs.rmSync(ledgerPath(), { force: true });
  fs.rmSync(statePath(), { force: true });

  // 4. Re-chain the keepers as the new genesis of the ledger. Strip the old
  //    hash: appendRecords recomputes the chain, so `verify-ledger` stays
  //    intact rather than reporting a break at record 0.
  if (keep.length) appendRecords(keep.map(({ h, ...rest }) => rest));

  // 5. Re-derive everything else through the normal scanners.
  const claude = backfill({ root: root || claudeProjectsRoot() });
  let codexResult = null;
  if (codex) {
    const cxRoot = codexRoot || defaultCodexRoot();
    if (cxRoot && fs.existsSync(cxRoot)) {
      const cx = scanCodexDir(cxRoot);
      codexResult = { files: cx.files, added: cx.added.length };
    }
  }

  const after = loadRecords();
  return {
    backup,
    before: before.length,
    after: after.length,
    kept: keep.length,
    transcripts: claude.scanned,
    codex: codexResult,
  };
}
