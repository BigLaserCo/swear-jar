// Installs the collection hooks into ~/.claude/settings.json (merge, never
// clobber; a timestamped backup is written before any change).
//
// Two hooks, one scanner:
//  - UserPromptSubmit: catches the human's swears the moment they're typed,
//    and its stdout (the clink line) is added as context — Claude gets to
//    know it just got sworn at.
//  - Stop: catches the assistant's own replies at turn end, silently.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const MARKER = "swear-jar";

export function settingsPath() {
  return (
    process.env.SWEAR_JAR_CLAUDE_SETTINGS ||
    path.join(os.homedir(), ".claude", "settings.json")
  );
}

export function binPath() {
  return fileURLToPath(new URL("../bin/swear-jar.mjs", import.meta.url));
}

function hookEntry(command) {
  return { hooks: [{ type: "command", command, timeout: 20 }] };
}

function hasOurHook(list) {
  return (list || []).some((entry) =>
    (entry.hooks || []).some(
      (h) => typeof h.command === "string" && h.command.includes(MARKER)
    )
  );
}

export function install() {
  const p = settingsPath();
  let settings = {};
  if (fs.existsSync(p)) {
    settings = JSON.parse(fs.readFileSync(p, "utf8"));
    fs.copyFileSync(p, `${p}.bak-${MARKER}-${Date.now()}`);
  } else {
    fs.mkdirSync(path.dirname(p), { recursive: true });
  }
  const command = `node "${binPath()}" scan`;
  settings.hooks ||= {};
  const changed = [];
  for (const event of ["UserPromptSubmit", "Stop"]) {
    settings.hooks[event] ||= [];
    if (!hasOurHook(settings.hooks[event])) {
      settings.hooks[event].push(hookEntry(command));
      changed.push(event);
    }
  }
  if (changed.length) {
    fs.writeFileSync(p, JSON.stringify(settings, null, 2) + "\n", "utf8");
  }
  return { path: p, changed };
}

export function uninstall() {
  const p = settingsPath();
  if (!fs.existsSync(p)) return { path: p, changed: [] };
  const settings = JSON.parse(fs.readFileSync(p, "utf8"));
  const changed = [];
  for (const event of Object.keys(settings.hooks || {})) {
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event]
      .map((entry) => ({
        ...entry,
        hooks: (entry.hooks || []).filter(
          (h) => !(typeof h.command === "string" && h.command.includes(MARKER))
        ),
      }))
      .filter((entry) => (entry.hooks || []).length > 0);
    if (settings.hooks[event].length !== before) changed.push(event);
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (changed.length) {
    fs.copyFileSync(p, `${p}.bak-${MARKER}-${Date.now()}`);
    fs.writeFileSync(p, JSON.stringify(settings, null, 2) + "\n", "utf8");
  }
  return { path: p, changed };
}
