#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const START = "/*__CARD_SVG_START__*/";
const END = "/*__CARD_SVG_END__*/";
const TARGETS = ["assets/report_template.html", "assets/kindness_template.html"];

function markedBlock(source, label) {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start === -1 || end <= start) throw new Error(`${label} is missing the share-core markers`);
  return source.slice(start + START.length, end).trim();
}

export function syncShareCore(root = ROOT) {
  const canonicalPath = path.join(root, "src/sharecard.mjs");
  const canonical = markedBlock(fs.readFileSync(canonicalPath, "utf8"), "src/sharecard.mjs");

  for (const rel of TARGETS) {
    const targetPath = path.join(root, rel);
    const source = fs.readFileSync(targetPath, "utf8");
    markedBlock(source, rel);
    const start = source.indexOf(START);
    const end = source.indexOf(END) + END.length;
    const next = source.slice(0, start) + `${START}\n${canonical}\n${END}` + source.slice(end);
    if (next !== source) fs.writeFileSync(targetPath, next);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncShareCore();
}
