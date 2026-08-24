import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const REPORTS = ["assets/report_template.html", "assets/kindness_template.html"];
const START = "/*__CARD_SVG_START__*/";
const END = "/*__CARD_SVG_END__*/";

function shareCore(rel) {
  const source = read(rel);
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  assert.ok(start !== -1 && end > start, `${rel} contains the canonical share-core markers`);
  return source.slice(start + START.length, end).trim();
}

const EXACT_CAPTION_SOURCE = [
  "I used the open-source AI Swear Jar and found out I have sworn at AI ${swears} times.",
  "On the other hand, I have been nice to AI ${nice} times.",
  "Want to know how you measure up?",
  "https://swearjar.unfocused.ai",
];

test("both report modes use the one exact platform-safe share caption", () => {
  for (const rel of REPORTS) {
    const html = read(rel);
    for (const line of EXACT_CAPTION_SOURCE) {
      assert.ok(html.includes(line), `${rel} is missing exact caption line: ${line}`);
    }
    assert.match(html, /const shareText\s*=\s*shareCaption\(CARD\)/, `${rel} uses the canonical caption`);
    assert.match(html, /copyShareText\(shareText\)/, `${rel} copies the canonical caption`);
    assert.doesNotMatch(html, /const (?:wrappedCaption|kindCaption)\s*=/, `${rel} has no competing legacy caption`);
  }
});

test("every Copy post control has a permission-free clipboard fallback", () => {
  for (const rel of REPORTS) {
    const html = read(rel);
    assert.match(html, /function copyShareText\(/, `${rel} defines the copy helper`);
    assert.match(html, /document\.execCommand\(["']copy["']\)/, `${rel} can copy when Clipboard API permission is unavailable`);
    assert.match(html, /copyShareText\(shareText\)/, `${rel} copies the approved post through the helper`);
  }
});

test("both report modes render and export one unified comparison card", () => {
  for (const rel of REPORTS) {
    const html = read(rel);
    assert.match(html, /const CARD\s*=\s*cardData\(S\)/, `${rel} selects the two canonical human counts`);
    assert.match(html, /cardSvg\(CARD\)/, `${rel} renders the canonical comparison card`);
    assert.doesNotMatch(html, /downloadKindCard|downloadDamageCard/, `${rel} has no cross-mode card export`);
    assert.equal((html.match(/id="downloadCard"/g) || []).length, 1, `${rel} has one SVG download`);
    assert.equal((html.match(/id="downloadCardPng"/g) || []).length, 1, `${rel} has one PNG download`);
  }
});

test("damage mode does not render a competing angel or kindness-card state", () => {
  const html = read("assets/report_template.html");
  assert.doesNotMatch(html, /id="goldstar"|downloadKindCard|kindCardBlob|cardSvg\(CARD\s*,\s*["']kindness["']\)/);
});

test("zero-signal reports hide the entire sharing surface", () => {
  for (const rel of REPORTS) {
    const html = read(rel);
    assert.match(html, /<section class="sec" id="share-sec">/, `${rel} identifies the whole share section`);
    assert.match(html, /if\(!HAS_SHARE_SIGNAL\)\$\('share-sec'\)\.hidden=true;/, `${rel} hides sharing when both counts are zero`);
  }
});

test("both self-contained report templates inline the canonical share core exactly", () => {
  const canonical = shareCore("src/sharecard.mjs");
  for (const rel of REPORTS) assert.equal(shareCore(rel), canonical, `${rel} share core drifted`);
});
