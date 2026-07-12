// Auto-open — the "run the command → the report opens in your face" half of
// monetization-v1.
//
// Two contracts:
//  - Opening is a COURTESY, never a failure: openInBrowser is fire-and-forget —
//    detached, output ignored, every error swallowed. A machine with no opener
//    (headless CI, a bare container) simply doesn't open; the caller already
//    printed the path, which is the guaranteed behavior.
//  - Non-TTY runs NEVER open — mechanically, not by convention. shouldAutoOpen
//    is the single gate (a real terminal, no --no-open, no SWEAR_JAR_NO_OPEN)
//    and Claude skill runs / CI / pipes are non-TTY, so they cannot spawn a
//    browser no matter what flags they pass.
//
// NB: child_process here spawns the OS "open this file" helper on the user's
// own report — a local courtesy, not a network path. scripts/ci/verify.mjs
// check (b) allowlists exactly this file for exactly that token, and still
// scans it for every real network smell (fetch/http/net/sockets).

import { spawn } from "node:child_process";

// The OS command that opens a file/URL with its default handler.
export function openCommandFor(platform = process.platform) {
  if (platform === "darwin") return "open";
  if (platform === "win32") return "start";
  return "xdg-open";
}

// The auto-open decision, pure and unit-testable. Callers pass their stream's
// isTTY and their --no-open flag; both opt-outs beat the TTY.
export function shouldAutoOpen({ isTTY, noOpen = false, env = process.env } = {}) {
  if (noOpen) return false;
  if (env.SWEAR_JAR_NO_OPEN) return false;
  return Boolean(isTTY);
}

// Fire-and-forget open. Never throws, never blocks process exit (detached +
// unref), never reports failure — the path was already printed either way.
export function openInBrowser(target, { platform = process.platform } = {}) {
  try {
    // `start` is a cmd.exe builtin, not an executable — win32 needs a shell.
    const child = spawn(openCommandFor(platform), [target], {
      detached: true,
      stdio: "ignore",
      shell: platform === "win32",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // swallowed by design — opening is a courtesy
  }
}
