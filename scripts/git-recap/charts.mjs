// git-recap — static SVG chart builders.
//
// Charts are computed here in Node and emitted as fully static inline SVG (no
// client-side script), so the rendered HTML is deterministic and screenshots
// cleanly the instant it loads. Every builder returns an <svg> string sized by
// a viewBox, so it scales to whatever box the layout gives it.

/** Abbreviate a count: 900 → "900", 12_300 → "12k", 1_530_000 → "1.5M". */
export function abbr(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
}

/** Round a maximum up to a clean axis top (1/2/5 × 10^k), never below `min`. */
function niceMax(v, min = 1) {
  const val = Math.max(v, min);
  const pow = Math.pow(10, Math.floor(Math.log10(val)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * pow >= val) return step * pow;
  }
  return 10 * pow;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function monthAxis(ticks, cx, y, cls, count) {
  return ticks
    .map(([i, m]) => {
      if (i >= count) return "";
      return `<text x="${cx(i).toFixed(1)}" y="${y}" text-anchor="middle" class="${cls}">${esc(m)}</text>`;
    })
    .join("");
}

/**
 * Combo chart: bars on the left axis + a filled line on the right axis.
 * Defaults model the recap's "commits (bars) + lines added (line)" chart.
 */
export function barLineChart({
  bars,
  line,
  monthTicks = [],
  width = 968,
  height = 258,
  barColor,
  lineColor,
  grid,
  id = "c1",
}) {
  const W = width, H = height;
  const padL = 46, padR = line ? 54 : 18, padT = 26, padB = 30;
  const n = bars.length;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const gap = n > 40 ? 2 : n > 20 ? 4 : 6;
  const bw = Math.max((plotW - gap * (n - 1)) / n, 1);
  const maxB = niceMax(Math.max(0, ...bars));
  const maxL = line ? niceMax(Math.max(0, ...line)) : 1;
  const cx = (i) => padL + i * (bw + gap) + bw / 2;
  const by = (v) => padT + plotH - (v / maxB) * plotH;
  const ly = (v) => padT + plotH - (v / maxL) * plotH;

  let s = `<svg class="viz" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;

  // left gridlines + labels (bars axis)
  for (const gv of [0, maxB / 2, maxB]) {
    const y = by(gv);
    s += `<line x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${grid}" stroke-width="1"/>`;
    s += `<text x="${padL - 7}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="glab" fill="${barColor}">${abbr(gv)}</text>`;
  }
  // right axis labels (line axis)
  if (line) {
    for (const gv of [0, maxL / 2, maxL]) {
      const y = ly(gv);
      s += `<text x="${W - padR + 7}" y="${(y + 4).toFixed(1)}" text-anchor="start" class="glab" fill="${lineColor}">${abbr(gv)}</text>`;
    }
  }
  // bars
  bars.forEach((v, i) => {
    if (v <= 0) return;
    const h = Math.max((v / maxB) * plotH, 2);
    const x = padL + i * (bw + gap);
    const y = padT + plotH - h;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, bw / 2).toFixed(1)}" fill="${barColor}" fill-opacity="0.82"/>`;
  });
  // line + area (right axis)
  if (line) {
    let ld = "";
    let ad = `M${cx(0).toFixed(1)} ${(padT + plotH).toFixed(1)} `;
    line.forEach((v, i) => {
      ld += (i ? " L" : "M") + cx(i).toFixed(1) + " " + ly(v).toFixed(1);
      ad += "L" + cx(i).toFixed(1) + " " + ly(v).toFixed(1) + " ";
    });
    ad += `L${cx(n - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;
    s += `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lineColor}" stop-opacity="0.22"/><stop offset="1" stop-color="${lineColor}" stop-opacity="0"/></linearGradient></defs>`;
    s += `<path d="${ad}" fill="url(#${id}g)"/>`;
    s += `<path d="${ld}" fill="none" stroke="${lineColor}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  // peak bar label
  const peak = bars.indexOf(Math.max(...bars));
  if (bars[peak] > 0) {
    s += `<text x="${cx(peak).toFixed(1)}" y="${(by(bars[peak]) - 7).toFixed(1)}" text-anchor="middle" class="peaklab" fill="${barColor}">${bars[peak].toLocaleString("en-US")}</text>`;
  }
  // baseline + month ticks
  s += `<line x1="${padL}" x2="${W - padR}" y1="${padT + plotH}" y2="${padT + plotH}" stroke="${grid}" stroke-width="1"/>`;
  s += monthAxis(monthTicks, cx, H - padB + 22, "axlab", n);
  s += "</svg>";
  return s;
}

/** Growth area chart (repos-in-flight or cumulative lines), with an end dot. */
export function areaChart({
  values,
  monthTicks = [],
  width = 968,
  height = 188,
  color,
  grid,
  endLabel,
  id = "c2",
}) {
  const W = width, H = height;
  const padL = 46, padR = 18, padT = 20, padB = 30;
  const n = values.length;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxV = niceMax(Math.max(1, ...values));
  const cx = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const cy = (v) => padT + plotH - (v / maxV) * plotH;

  let s = `<svg class="viz" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  s += `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.34"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`;
  s += `<filter id="${id}glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  for (const gv of [0, maxV / 2, maxV]) {
    const y = cy(gv);
    s += `<line x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${grid}" stroke-width="1"/>`;
    s += `<text x="${padL - 7}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="glab" fill="var(--ink3)">${abbr(gv)}</text>`;
  }
  let ld = "";
  let ad = `M${cx(0).toFixed(1)} ${(padT + plotH).toFixed(1)} `;
  values.forEach((v, i) => {
    ld += (i ? " L" : "M") + cx(i).toFixed(1) + " " + cy(v).toFixed(1);
    ad += "L" + cx(i).toFixed(1) + " " + cy(v).toFixed(1) + " ";
  });
  ad += `L${cx(n - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;
  s += `<path d="${ad}" fill="url(#${id}g)"/>`;
  s += `<path d="${ld}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  s += `<circle cx="${cx(n - 1).toFixed(1)}" cy="${cy(values[n - 1]).toFixed(1)}" r="5" fill="${color}" filter="url(#${id}glow)"/>`;
  if (endLabel != null) {
    s += `<text x="${(cx(n - 1) - 4).toFixed(1)}" y="${(cy(values[n - 1]) - 10).toFixed(1)}" text-anchor="end" class="peaklab" fill="${color}">${esc(endLabel)}</text>`;
  }
  s += `<line x1="${padL}" x2="${W - padR}" y1="${padT + plotH}" y2="${padT + plotH}" stroke="${grid}" stroke-width="1"/>`;
  s += monthAxis(monthTicks, cx, H - padB + 22, "axlab", n);
  s += "</svg>";
  return s;
}
