// git-recap — HTML → PNG rasterizer.
//
// Uses a headless Chromium-family browser the user already has (Chrome, Edge,
// Brave, Chromium). No npm dependency, no bundled binary: it shells out to the
// browser's own `--screenshot` mode. `--virtual-time-budget` advances the page
// clock so web fonts and layout settle before the shot is taken.
//
// Everything is local: a temp HTML file on disk, a local browser process, a PNG
// on disk. Nothing leaves the machine (fonts, when enabled, are the one optional
// outbound fetch — disable them with the theme's useWebFonts:false).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Common install locations by platform, plus env overrides. First hit wins.
function candidates() {
  const env = [process.env.RECAP_CHROME, process.env.CHROME_PATH].filter(Boolean);
  if (process.platform === "darwin") {
    return [
      ...env,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  if (process.platform === "win32") {
    const pf = [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env["LOCALAPPDATA"]].filter(Boolean);
    const rel = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "Chromium\\Application\\chrome.exe",
    ];
    return [...env, ...pf.flatMap((p) => rel.map((r) => path.join(p, r)))];
  }
  return [
    ...env,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
    "/snap/bin/chromium",
  ];
}

/** Path to the first usable browser, or null if none is found. */
export function findBrowser() {
  for (const p of candidates()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Rasterize an HTML string to a PNG file.
 * @param {string} html      full HTML document
 * @param {object} o         { width, height, outPath, scale?, browser?, waitMs? }
 * @returns {string} outPath
 */
export function rasterizeHtml(html, o) {
  const { width, height, outPath, scale = 1, waitMs = 2500 } = o;
  const browser = o.browser || findBrowser();
  if (!browser) {
    throw new Error(
      "No Chromium-family browser found. Install Google Chrome, Chromium, Edge, or Brave, " +
        "or set RECAP_CHROME to a browser binary path."
    );
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "git-recap-"));
  const htmlPath = path.join(tmp, "recap.html");
  fs.writeFileSync(htmlPath, html);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });

  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`,
    "--default-background-color=00000000",
    `--virtual-time-budget=${waitMs}`,
    `--screenshot=${path.resolve(outPath)}`,
    `file://${htmlPath}`,
  ];
  try {
    execFileSync(browser, args, { stdio: ["ignore", "ignore", "pipe"], timeout: 60000 });
  } catch (err) {
    // Chrome sometimes exits non-zero while still writing the PNG; only fail if
    // the file is actually missing.
    if (!fs.existsSync(path.resolve(outPath))) {
      throw new Error(`browser screenshot failed: ${err.stderr?.toString() || err.message}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (!fs.existsSync(path.resolve(outPath))) {
    throw new Error("browser did not produce an output image");
  }
  return outPath;
}
