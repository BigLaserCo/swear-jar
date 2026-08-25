import { scanFiles } from "./browser-scan.mjs";
import { entriesFromDrop, entriesFromFiles, entriesFromHandle } from "./folder-input.mjs";
import { comparisonMarkup, copyText, fmt, pngFor, verdictFor } from "./result-share.mjs";
import { computeStats } from "../src/stats.mjs";
import { cardData, shareCaption } from "../src/sharecard.mjs";

const $ = (id) => document.getElementById(id);
const views = ["pickView", "scanView", "resultView"];
let lastStats;
let lastVerdict;
let lastPng;

function show(id) {
  views.forEach((view) => { $(view).hidden = view !== id; });
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  setTimeout(() => { $("toast").hidden = true; }, 3200);
}

async function copyPost() {
  if (!lastStats) return;
  const copied = await copyText(shareCaption(cardData(lastStats)));
  toast(copied ? "Post copied. Nothing was published automatically." : "Copy failed. Select and copy the post manually.");
}

async function downloadCard() {
  if (!lastPng) return;
  const blob = await lastPng;
  if (!blob) return toast("Card image could not be made. Copy post is still available.");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ai-swear-jar.png";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function shareResult() {
  if (!lastStats || !lastVerdict || !lastPng) return;
  const blob = await lastPng;
  if (!blob) {
    await copyPost();
    return toast("Card image could not be made. The post was copied instead.");
  }
  const text = shareCaption(cardData(lastStats));
  const file = new File([blob], "ai-swear-jar.png", { type: "image/png" });
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
    await copyPost();
    downloadCard();
    return toast("Post copied and card downloaded. Choose where to publish it.");
  }
  try {
    await navigator.share({ text, files: [file] });
    toast("Share sheet closed. Your post was only published if you completed it there.");
  } catch {
    toast("Sharing was cancelled. Nothing was posted.");
  }
}

function render(result) {
  const human = result.records.filter((record) => record.source === "user");
  const stats = computeStats(result.records);
  const verdict = verdictFor(stats, human.length > 0);
  show("resultView");
  lastStats = lastVerdict = lastPng = null;
  $("comparison").hidden = !verdict;
  $("emptyState").hidden = Boolean(verdict);
  $("retryArea").hidden = Boolean(verdict && verdict.text !== "NO SIGNAL");
  $("shareArea").hidden = !verdict || verdict.text === "NO SIGNAL";
  if (!verdict) {
    $("emptyState").innerHTML = "<h2>No eligible Claude Code messages found</h2><p>Pick the Claude Code projects folder containing your own transcript files, then try again.</p>";
    return;
  }
  lastStats = stats;
  lastVerdict = verdict;
  lastPng = pngFor(stats);
  const comparison = $("comparison");
  comparison.className = `comparison ${verdict.tone}`;
  comparison.innerHTML = comparisonMarkup(stats, verdict);
  comparison.setAttribute("aria-label", `I have sworn at AI ${stats.userSwears} times. I have been nice to AI ${stats.kindActs} times. ${verdict.text}`);
  if (verdict.text === "NO SIGNAL") {
    $("emptyState").hidden = false;
    $("emptyState").innerHTML = "<h2>No signal yet</h2><p>We found Claude Code messages, but no swears or kindness acts to compare. Sharing stays off for an empty result.</p>";
  }
}

async function run(entries) {
  if (!entries.length) return toast("No Claude Code .jsonl files found in that folder.");
  show("scanView");
  ["files", "messages", "coins"].forEach((id) => { $(id).textContent = "0"; });
  const result = await scanFiles((async function* () {
    for (const entry of entries) {
      let text = "";
      try { text = await (await entry.file()).text(); } catch {}
      yield { name: entry.name, text };
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  })(), (progress) => {
    $("files").textContent = fmt(progress.files);
    $("messages").textContent = fmt(progress.records);
    $("coins").textContent = fmt(progress.coins);
    $("currentFile").textContent = progress.name;
  });
  render(result);
}

const supportsFs = "showDirectoryPicker" in window;
$("pickBtn").addEventListener("click", async () => {
  if (!supportsFs) return $("dirInput").click();
  try { run(await entriesFromHandle(await window.showDirectoryPicker({ mode: "read" }))); } catch {}
});
$("fallbackBtn").addEventListener("click", () => $("dirInput").click());
$("dirInput").addEventListener("change", (event) => run(entriesFromFiles(event.target.files || [])));
$("drop").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("drop").classList.add("hot");
});
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("hot"));
$("drop").addEventListener("drop", async (event) => {
  event.preventDefault();
  $("drop").classList.remove("hot");
  run(await entriesFromDrop(event.dataTransfer));
});
$("copyBtn").addEventListener("click", copyPost);
$("downloadBtn").addEventListener("click", downloadCard);
$("shareBtn").addEventListener("click", shareResult);
$("againBtn").addEventListener("click", () => show("pickView"));
$("retryBtn").addEventListener("click", () => show("pickView"));
