import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detect } from "../src/detect.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const ALLOWED_REF = /^https?:\/\/(?:github\.com\/BigLaserCo\/|setupyour\.ai|biglaser\.co)/i;

const read = (name) => fs.readFileSync(path.join(WEB, name), "utf8");
const appHtml = () => read("app-shell.html");
const appCss = () => read("app.css");
const appScript = () => ["app.mjs", "folder-input.mjs", "result-share.mjs"].map(read).join("\n");

function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#\d+;/g, " ");
}

test("public app shell loads only local CSS and JavaScript plus approved human links", () => {
  const html = appHtml();
  const refs = [...html.matchAll(/https?:\/\/[^\s"'`<>()]+/gi)].map((match) => match[0]);
  assert.deepEqual(refs.filter((url) => !ALLOWED_REF.test(url)), []);
  assert.doesNotMatch(html, /["'(\s]\/\/[a-z0-9.-]+\.[a-z]{2,}/i, "no protocol-relative hosts");
  assert.doesNotMatch(html, /<script\s[^>]*\bsrc\s*=\s*["']https?:/i, "no external scripts");
  assert.match(html, /<link\s+rel="stylesheet"\s+href="\.\/app\.css">/);
  assert.match(html, /<script\s+type="module"\s+src="\.\/app\.mjs"><\/script>/);
  assert.doesNotMatch(html, /<img\b[^>]*\bsrc\s*=\s*["']https?:/i, "no external images");
});

test("public app copy is safe, client-side, and free of dormant upload machinery", () => {
  const html = appHtml();
  const script = appScript();
  const { words, coins } = detect(visibleText(html));
  assert.equal(coins, 0, `visible text owes the jar ${coins} coins: ${JSON.stringify(words)}`);
  assert.match(html, /never leave your machine/i);
  assert.match(html, /client-side/i);
  assert.ok(script.includes("./browser-scan.mjs"));
  assert.ok(script.includes("../src/stats.mjs"));
  assert.ok(!script.includes("../funnel/schema.mjs"));
  assert.doesNotMatch(script, /uploadBtn|API_BASE|ACCOUNTS_BASE|buildSubmission|wireUpload/);
});

test("public app pins the unified result, business bridge, and exact share machinery", () => {
  const html = appHtml();
  const script = appScript();
  assert.match(html, /AI Swear Jar/);
  assert.match(html, /How much do you swear at AI\?/);
  assert.match(script, /I have sworn at AI/);
  assert.match(script, /I have been nice to AI/);
  assert.match(script, /cardVerdict\(cardData\(stats\)\)/);
  assert.match(script, /shareCaption\(cardData\(lastStats\)\)/);
  assert.match(html, /Share my result/);
  assert.match(html, /Copy post/);
  assert.match(script, /document\.execCommand\(["']copy["']\)/, "permission-free copy fallback");
  assert.match(html, /Want AI to work better for your business\?\s*<a[^>]*>Visit SetupYourAI\.<\/a>/);
  assert.match(html, /Built in the <a[^>]*>Big Laser workshop\.<\/a>/);
});

test("public app uses the approved Claude visual contract across every scanner state", () => {
  const html = appHtml();
  const css = appCss();
  assert.match(html, /class="[^\"]*eyebrow[^\"]*"[^>]*>AI Swear Jar</);
  assert.match(html, /class="[^\"]*drop[^\"]*"[^>]*id="drop"/);
  assert.match(html, /id="scanView" class="panel scan-panel"/);
  assert.match(html, /id="shareArea" class="panel share-panel"/);
  assert.match(html, /class="bridge" aria-label="About this scanner"/);
  assert.match(css, /--bg:\s*#0f1216;/);
  assert.match(css, /--line:\s*#272d37;/);
  assert.match(css, /--ink:\s*#e8e6e1;/);
  assert.match(css, /--muted:\s*#8a93a0;/);
  assert.match(css, /--ember:\s*#e8853a;/);
  assert.match(css, /--kind:\s*#5fb07a;/);
  assert.match(css, /radial-gradient\(/, "the shared dark field needs subtle warm depth");
  assert.match(css, /font-family:\s*Georgia/, "hero questions should use an editorial face");
  assert.match(css, /\.verdict\s*\{[^}]*border:/s, "verdict should read as a stamped treatment");
  assert.match(css, /\.verdict\s*\{[^}]*text-transform:\s*uppercase/s);
  assert.match(css, /\.scan-panel.*\.metric/s, "progress needs a deliberate visual treatment");
  assert.match(css, /@media \(max-width:\s*600px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test("public app supports all three folder doors and every empty retry path", () => {
  const html = appHtml();
  const script = appScript();
  assert.ok(script.includes("showDirectoryPicker"));
  assert.match(html, /webkitdirectory/i);
  assert.match(script, /webkitGetAsEntry/);
  assert.match(html, /Cmd\+Shift\+\./);
  assert.match(html, /id="retryArea"[^>]*hidden/);
  assert.match(html, /id="retryBtn"[^>]*>Measure another folder</);
  assert.match(script, /\$\("retryArea"\)\.hidden = Boolean\(verdict && verdict\.text !== "NO SIGNAL"\)/);
  assert.match(script, /\$\("retryBtn"\)\.addEventListener\("click", \(\) => show\("pickView"\)\)/);
});

test("browser sharing rasterizes only the canonical card into a PNG", () => {
  const script = appScript();
  assert.match(script, /import \{ cardData, shareCaption \} from "\.\.\/src\/sharecard\.mjs"/);
  assert.match(script, /import \{ cardData, cardSvg, cardVerdict \} from "\.\.\/src\/sharecard\.mjs"/);
  assert.match(script, /cardSvg\(cardData\(stats\)\)/);
  assert.match(script, /shareCaption\(cardData\(lastStats\)\)/);
  assert.doesNotMatch(script, /function (?:canvasFor|shareText)\(/);
  assert.match(script, /\.download = "ai-swear-jar\.png"/);
});
