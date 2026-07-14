import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function customWordsPath() {
  return path.join(os.homedir(), ".swear-jar", "custom-words.json");
}

export function loadCustomWords() {
  try {
    const value = JSON.parse(fs.readFileSync(customWordsPath(), "utf8"));
    return Array.isArray(value) ? value.filter((w) => typeof w === "string") : [];
  } catch {
    return [];
  }
}

function normalize(word) {
  return String(word || "").trim().toLowerCase();
}

export function addCustomWord(word) {
  const value = normalize(word);
  if (!value || value.length > 64 || /[\r\n]/.test(value)) throw new Error("custom words must be 1–64 characters");
  const words = loadCustomWords();
  if (!words.includes(value)) words.push(value);
  fs.mkdirSync(path.dirname(customWordsPath()), { recursive: true });
  fs.writeFileSync(customWordsPath(), JSON.stringify(words.sort()) + "\n", "utf8");
  return words;
}

export function removeCustomWord(word) {
  const value = normalize(word);
  const words = loadCustomWords().filter((w) => w !== value);
  fs.mkdirSync(path.dirname(customWordsPath()), { recursive: true });
  fs.writeFileSync(customWordsPath(), JSON.stringify(words.sort()) + "\n", "utf8");
  return words;
}
