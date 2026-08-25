import { cardData, cardSvg, cardVerdict } from "../src/sharecard.mjs";

const fmt = (number) => Number(number || 0).toLocaleString("en-US");

function verdictFor(stats, hasEligibleHuman) {
  if (!hasEligibleHuman) return null;
  return {
    text: cardVerdict(cardData(stats)),
    tone: stats.kindActs > stats.userSwears ? "kind" : stats.userSwears > stats.kindActs ? "swear" : "neutral",
  };
}

function comparisonMarkup(stats, verdict) {
  const max = Math.max(stats.userSwears, stats.kindActs, 1);
  const swearsWidth = (stats.userSwears / max * 100).toFixed(1);
  const niceWidth = (stats.kindActs / max * 100).toFixed(1);
  return `<p class="verdict">${verdict.text}</p><h2>Your two-count AI history</h2><div class="compare-row"><span class="label">I have sworn at AI</span><div class="track" aria-hidden="true"><div class="fill swear-fill" style="width:${swearsWidth}%"></div></div><span class="count">${fmt(stats.userSwears)}</span></div><div class="compare-row"><span class="label">I have been nice to AI</span><div class="track" aria-hidden="true"><div class="fill kind-fill" style="width:${niceWidth}%"></div></div><span class="count">${fmt(stats.kindActs)}</span></div>`;
}

function pngFor(stats) {
  const source = URL.createObjectURL(new Blob([cardSvg(cardData(stats))], { type: "image/svg+xml;charset=utf-8" }));
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 675;
      canvas.getContext("2d").drawImage(image, 0, 0, 1200, 675);
      URL.revokeObjectURL(source);
      canvas.toBlob(resolve, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      resolve(null);
    };
    image.src = source;
  });
}

function legacyCopyText(value) {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  document.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
  let copied = false;
  try { copied = document.execCommand("copy"); } catch {}
  area.remove();
  return copied;
}

async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}
  return legacyCopyText(value);
}

export { comparisonMarkup, copyText, fmt, pngFor, verdictFor };
