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

function cardTheme(verdict) {
  if (verdict === "HOLY GOODY TWO-SHOES") {
    return { background: "#FBF7EC", accent: "#C9922A", ink: "#241C10", muted: "#574A32" };
  }
  if (verdict === "YOU KISS YOUR MOTHER WITH THAT MOUTH?") {
    return { background: "#17141C", accent: "#E8623A", ink: "#F3EEE7", muted: "#CFC6BA" };
  }
  return { background: "#F2F0EB", accent: "#5C6470", ink: "#1E252D", muted: "#4A535D" };
}

function cardSvg({ userSwears, kindActs } = {}) {
  const swears = count(userSwears);
  const nice = count(kindActs);
  const scale = Math.max(swears, nice, 1);
  const verdict = cardVerdict({ userSwears: swears, kindActs: nice });
  const theme = cardTheme(verdict);
  const num = (value) => value.toLocaleString("en-US");
  const barWidth = (value) => (MAX_BAR_WIDTH * value) / scale;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="AI Swear Jar: ${num(swears)} swears, ${num(nice)} nice acts. ${verdict}"><rect width="1200" height="675" rx="28" fill="${theme.background}"/><rect width="1200" height="12" fill="${theme.accent}"/><text x="64" y="92" fill="${theme.ink}" font-family="Arial,sans-serif" font-size="32" font-weight="800">AI SWEAR JAR</text><text x="64" y="184" fill="${theme.ink}" font-family="Arial,sans-serif" font-size="34" font-weight="700">I have sworn at AI ${num(swears)} times.</text><rect x="656" y="153" width="480" height="24" rx="12" fill="${theme.ink}" opacity=".14"/><rect data-share-bar="swears" x="656" y="153" width="${barWidth(swears)}" height="24" rx="12" fill="${theme.accent}"/><text x="64" y="278" fill="${theme.ink}" font-family="Arial,sans-serif" font-size="34" font-weight="700">I have been nice to AI ${num(nice)} times.</text><rect x="656" y="247" width="480" height="24" rx="12" fill="${theme.ink}" opacity=".14"/><rect data-share-bar="nice" x="656" y="247" width="${barWidth(nice)}" height="24" rx="12" fill="${theme.accent}"/><text x="64" y="405" fill="${theme.accent}" font-family="Arial,sans-serif" font-size="42" font-weight="900">${verdict}</text><text x="64" y="530" fill="${theme.muted}" font-family="Arial,sans-serif" font-size="28" font-weight="700">Want to know how you measure up?</text><text x="64" y="588" fill="${theme.muted}" font-family="Arial,sans-serif" font-size="24">swearjar.unfocused.ai</text></svg>`;
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
