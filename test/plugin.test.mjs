// Validates the Claude Code plugin packaging: the manifest and marketplace
// files parse as JSON and every path they reference (hook script, plugin
// source, skill) actually exists on disk. Catches a typo in a hook command or a
// renamed file before it ships a broken plugin.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../", import.meta.url);
const rootPath = (rel) => path.join(ROOT.pathname, rel);
const readJson = (rel) => JSON.parse(fs.readFileSync(rootPath(rel), "utf8"));
const exists = (rel) => fs.existsSync(rootPath(rel));

// Reserved marketplace names Claude Code blocks for official Anthropic use.
const RESERVED_MARKETPLACES = new Set([
  "claude-code-marketplace", "claude-code-plugins", "claude-plugins-official",
  "claude-plugins-community", "claude-community", "anthropic-marketplace",
  "anthropic-plugins", "agent-skills", "anthropic-agent-skills",
  "knowledge-work-plugins", "first-party-plugins",
]);

// Pull every ${CLAUDE_PLUGIN_ROOT}/<relpath> reference out of a command string.
function pluginRootRefs(command) {
  const out = [];
  const re = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s]+)/g;
  let m;
  while ((m = re.exec(command)) !== null) out.push(m[1]);
  return out;
}

// Every string value in a parsed object tree (so ${CLAUDE_PLUGIN_ROOT}
// references are read decoded, not as raw JSON-escaped bytes).
function collectStrings(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const v of node) collectStrings(v, out);
  else if (node && typeof node === "object") for (const v of Object.values(node)) collectStrings(v, out);
  return out;
}

test("plugin.json parses and declares required identity", () => {
  const manifest = readJson(".claude-plugin/plugin.json");
  assert.equal(typeof manifest.name, "string");
  assert.ok(manifest.name.length, "plugin name must be non-empty");
  assert.match(manifest.name, /^[a-z0-9-]+$/, "plugin name is kebab-case");
  // We keep our own code proprietary — never emit an open-source license.
  if (manifest.license !== undefined) {
    assert.equal(manifest.license, "UNLICENSED");
  }
});

test("plugin.json declares the UserPromptSubmit + Stop command hooks", () => {
  const manifest = readJson(".claude-plugin/plugin.json");
  assert.ok(manifest.hooks && typeof manifest.hooks === "object", "hooks object present");
  for (const event of ["UserPromptSubmit", "Stop"]) {
    const groups = manifest.hooks[event];
    assert.ok(Array.isArray(groups) && groups.length, `${event} is a non-empty array`);
    const commands = groups.flatMap((g) => g.hooks || []);
    assert.ok(commands.length, `${event} has at least one hook`);
    for (const h of commands) {
      assert.equal(h.type, "command", `${event} hook is a command hook`);
      assert.match(h.command, /swear-jar\.mjs/, `${event} runs the swear-jar CLI`);
      assert.match(h.command, /\bscan\b/, `${event} runs the scan subcommand`);
      assert.match(h.command, /\$\{CLAUDE_PLUGIN_ROOT\}/, `${event} uses plugin-root var`);
    }
  }
});

test("every ${CLAUDE_PLUGIN_ROOT} path in plugin.json resolves on disk", () => {
  const manifest = readJson(".claude-plugin/plugin.json");
  const refs = collectStrings(manifest).flatMap(pluginRootRefs);
  assert.ok(refs.includes("bin/swear-jar.mjs"), "the hook references bin/swear-jar.mjs");
  for (const rel of refs) {
    assert.ok(exists(rel), `referenced file exists: ${rel}`);
  }
});

test("the bundled skill exists with a description", () => {
  assert.ok(exists("skills/swear-jar/SKILL.md"), "skills/swear-jar/SKILL.md exists");
  const md = fs.readFileSync(rootPath("skills/swear-jar/SKILL.md"), "utf8");
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, "skill has YAML frontmatter");
  assert.match(fm[1], /^description:\s*\S+/m, "frontmatter has a non-empty description");
});

test("marketplace.json parses and lists the plugin correctly", () => {
  const mkt = readJson(".claude-plugin/marketplace.json");
  assert.match(mkt.name, /^[a-z0-9-]+$/, "marketplace name is kebab-case");
  assert.ok(!RESERVED_MARKETPLACES.has(mkt.name), "marketplace name is not reserved");
  assert.ok(mkt.owner && typeof mkt.owner.name === "string" && mkt.owner.name.length,
    "owner.name is present");
  assert.ok(Array.isArray(mkt.plugins) && mkt.plugins.length, "plugins is a non-empty array");

  const manifest = readJson(".claude-plugin/plugin.json");
  const entry = mkt.plugins.find((p) => p.name === manifest.name);
  assert.ok(entry, `marketplace lists the '${manifest.name}' plugin`);
  assert.ok(typeof entry.source === "string" || typeof entry.source === "object",
    "plugin entry has a source");
});

test("marketplace relative source resolves to a plugin dir with a manifest", () => {
  const mkt = readJson(".claude-plugin/marketplace.json");
  for (const entry of mkt.plugins) {
    if (typeof entry.source !== "string") continue; // github/url sources: not local
    assert.ok(entry.source.startsWith("./"), `relative source starts with ./: ${entry.source}`);
    // Sources resolve relative to the marketplace ROOT (the repo root here).
    const manifestRel = path.join(entry.source, ".claude-plugin/plugin.json");
    assert.ok(exists(manifestRel),
      `source '${entry.source}' contains a plugin manifest (${manifestRel})`);
  }
});
