import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { install, uninstall } from "../src/install.mjs";

function freshSettings(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swear-jar-settings-"));
  const p = path.join(dir, "settings.json");
  if (initial !== undefined) fs.writeFileSync(p, JSON.stringify(initial, null, 2));
  process.env.SWEAR_JAR_CLAUDE_SETTINGS = p;
  return p;
}

test("install wires both hooks into empty settings", () => {
  const p = freshSettings();
  const r = install();
  assert.deepEqual(r.changed.sort(), ["Stop", "UserPromptSubmit"]);
  const s = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.ok(s.hooks.UserPromptSubmit[0].hooks[0].command.includes("swear-jar"));
  assert.ok(s.hooks.Stop[0].hooks[0].command.includes("scan"));
});

test("install preserves existing hooks and is idempotent", () => {
  const existing = {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "node other-hook.mjs" }] },
      ],
    },
    model: "opus",
  };
  const p = freshSettings(existing);
  install();
  const again = install();
  assert.equal(again.changed.length, 0);
  const s = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(s.model, "opus");
  assert.equal(s.hooks.UserPromptSubmit.length, 2);
  assert.equal(
    s.hooks.UserPromptSubmit.filter((e) =>
      e.hooks.some((h) => h.command.includes("swear-jar"))
    ).length,
    1
  );
});

test("uninstall removes only our hooks", () => {
  const p = freshSettings({
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "node other-hook.mjs" }] },
      ],
    },
  });
  install();
  const r = uninstall();
  assert.deepEqual(r.changed.sort(), ["Stop", "UserPromptSubmit"]);
  const s = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(s.hooks.UserPromptSubmit.length, 1);
  assert.ok(s.hooks.UserPromptSubmit[0].hooks[0].command.includes("other-hook"));
  assert.equal(s.hooks.Stop, undefined);
});

test("install backs up existing settings before writing", () => {
  const p = freshSettings({ model: "opus" });
  install();
  const backups = fs
    .readdirSync(path.dirname(p))
    .filter((f) => f.includes(".bak-swear-jar"));
  assert.ok(backups.length >= 1);
});
