// The canonical public AI Swear Jar artifact. It accepts only the two aggregate
// human counts, so neither source text nor legacy score/money fields can enter
// the card or copied post.

/*__CARD_SVG_START__*/
const MAX_BAR_WIDTH = 480;

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function cardVerdict({ userSwears, kindActs } = {}) {
  const swears = count(userSwears);
  const nice = count(kindActs);
  if (swears === 0 && nice === 0) return "NO SIGNAL";
  if (nice > swears) return "HOLY GOODY TWO-SHOES";
  if (swears > nice) return "YOU KISS YOUR MOTHER WITH THAT MOUTH?";
  return "DEAD EVEN";
}

function verdictAccent(verdict) {
  if (verdict === "HOLY GOODY TWO-SHOES") return "#5fb07a";
  if (verdict === "YOU KISS YOUR MOTHER WITH THAT MOUTH?") return "#e8853a";
  return "#e8e6e1";
}

function cardSvg({ userSwears, kindActs } = {}) {
  const swears = count(userSwears);
  const nice = count(kindActs);
  const scale = Math.max(swears, nice, 1);
  const verdict = cardVerdict({ userSwears: swears, kindActs: nice });
  const accent = verdictAccent(verdict);
  const num = (value) => value.toLocaleString("en-US");
  const barWidth = (value) => (MAX_BAR_WIDTH * value) / scale;
  const verdictText = verdict === "YOU KISS YOUR MOTHER WITH THAT MOUTH?"
    ? `<text data-share-verdict="long" aria-label="${verdict}" x="897" y="540" fill="${accent}" stroke="none" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="21" font-weight="900" letter-spacing="1"><tspan x="897">YOU KISS YOUR MOTHER</tspan><tspan x="897" dy="27">WITH THAT MOUTH?</tspan></text>`
    : `<text data-share-verdict="short" x="897" y="559" fill="${accent}" stroke="none" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="27" font-weight="900" letter-spacing="1">${verdict}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="AI Swear Jar: ${num(swears)} swears, ${num(nice)} nice acts. ${verdict}">
  <defs>
    <radialGradient id="card-depth" cx=".82" cy="0" r=".9"><stop offset="0" stop-color="#1c2830"/><stop offset=".52" stop-color="#0f1216"/><stop offset="1" stop-color="#090b0e"/></radialGradient>
    <radialGradient id="card-spotlight" cx="0" cy="1" r=".74"><stop offset="0" stop-color="#e8853a" stop-opacity=".09"/><stop offset="1" stop-color="#e8853a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="675" rx="28" fill="#0f1216"/>
  <rect width="1200" height="675" rx="28" fill="url(#card-depth)"/>
  <rect width="1200" height="675" rx="28" fill="url(#card-spotlight)"/>
  <rect x="24" y="24" width="1152" height="627" rx="16" fill="none" stroke="#272d37" stroke-width="2"/>
  <text x="64" y="88" fill="#e8e6e1" font-family="Arial,Helvetica,sans-serif" font-size="32" font-weight="800" letter-spacing="2">AI SWEAR JAR</text>
  <line x1="64" y1="116" x2="1136" y2="116" stroke="#272d37" stroke-width="2"/>
  <text x="64" y="166" fill="#8a93a0" font-family="Consolas,monospace" font-size="18" font-weight="700" letter-spacing="2">SWEARS AT AI</text>
  <text data-share-count="swears" x="64" y="280" fill="#e8853a" font-family="Arial,Helvetica,sans-serif" font-size="120" font-weight="800">${num(swears)}</text>
  <text x="64" y="320" fill="#e8e6e1" font-family="Arial,Helvetica,sans-serif" font-size="27" font-weight="700">I have sworn at AI ${num(swears)} times.</text>
  <rect x="656" y="207" width="480" height="28" rx="14" fill="#272d37"/>
  <rect data-share-bar="swears" x="656" y="207" width="${barWidth(swears)}" height="28" rx="14" fill="#e8853a"/>
  <text x="64" y="388" fill="#8a93a0" font-family="Consolas,monospace" font-size="18" font-weight="700" letter-spacing="2">NICE TO AI</text>
  <text data-share-count="nice" x="64" y="502" fill="#5fb07a" font-family="Arial,Helvetica,sans-serif" font-size="120" font-weight="800">${num(nice)}</text>
  <text x="64" y="542" fill="#e8e6e1" font-family="Arial,Helvetica,sans-serif" font-size="27" font-weight="700">I have been nice to AI ${num(nice)} times.</text>
  <rect x="656" y="429" width="480" height="28" rx="14" fill="#272d37"/>
  <rect data-share-bar="nice" x="656" y="429" width="${barWidth(nice)}" height="28" rx="14" fill="#5fb07a"/>
  <g data-share-verdict-stamp="true" transform="rotate(-2 896 553)" fill="#0f1216" stroke="${accent}" stroke-width="3">
    <rect x="658" y="502" width="478" height="90" rx="5"/>
    ${verdictText}
  </g>
  <text x="64" y="610" fill="#8a93a0" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="700">Want to know how you measure up?</text>
  <text x="64" y="635" fill="#8a93a0" font-family="Consolas,monospace" font-size="18">swearjar.unfocused.ai</text>
</svg>`;
}

function cardData(stats = {}) {
  return { userSwears: count(stats.userSwears), kindActs: count(stats.kindActs) };
}

function shareCaption({ userSwears, kindActs } = {}) {
  const swears = count(userSwears).toLocaleString("en-US");
  const nice = count(kindActs).toLocaleString("en-US");
  return `I used the open-source AI Swear Jar and found out I have sworn at AI ${swears} times.\n\nOn the other hand, I have been nice to AI ${nice} times.\n\nWant to know how you measure up?\n\nhttps://swearjar.unfocused.ai`;
}
/*__CARD_SVG_END__*/

export { cardData, cardSvg, cardVerdict, shareCaption };
