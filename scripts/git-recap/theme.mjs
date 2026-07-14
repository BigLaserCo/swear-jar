// git-recap — theme + brand tokens.
//
// The default look is the "laser-bed dark, hot-orange heat-ramp" aesthetic, but
// every string and colour here is overridable from the CLI or a --brand-file,
// so the tool ships brand-neutral and any project can restyle it in one place.

export const DEFAULT_THEME = {
  name: "laser",
  colors: {
    bed: "#19120d", // page background (laser-bed dark)
    panel: "#241b14", // stat-tile fill
    edge: "#3d3025", // hairline borders
    ink: "#faf0e6", // primary text
    ink2: "#c6b3a8", // secondary text
    ink3: "#8a7f6a", // muted labels
    red: "#c4241a", // deep accent / borders
    redBr: "#ff5a3c", // bright accent / highlight numbers
    green: "#6fe08c", // bars / positive
    amber: "#ffcf6a", // secondary line (lines-added)
    grid: "rgba(250,240,230,0.08)",
  },
  fonts: {
    display: "Anton", // big headline numerals
    wordmark: "Rye", // brand wordmark
    body: "Oswald", // running text
    mono: "Space Mono", // labels / axes
    // When true the render links Google Fonts (a font DOWNLOAD, not a data
    // upload). Set false for a fully offline render that uses system fallbacks.
    useWebFonts: true,
  },
  brand: {
    wordmark: "GIT RECAP",
    tag: "// commit recap",
    cta: null, // optional call-to-action line (string) shown in a boxed row
    footerLeft: "", // e.g. a site / handle
    footerRight: "", // e.g. "generated with git-recap"
  },
};

// System-font fallback stacks so the render still looks intentional with
// useWebFonts:false (or if the font CDN is unreachable at render time).
const FALLBACK = {
  Anton: "'Arial Narrow', 'Helvetica Neue', Impact, sans-serif",
  Rye: "Georgia, 'Times New Roman', serif",
  Oswald: "'Helvetica Neue', Arial, system-ui, sans-serif",
  "Space Mono": "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

function deepMerge(base, over) {
  if (!over) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    const bv = base?.[k];
    const ov = over[k];
    out[k] = ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object"
      ? deepMerge(bv, ov)
      : ov;
  }
  return out;
}

/** Merge user overrides (from CLI flags / brand file) onto the default theme. */
export function resolveTheme(overrides) {
  return deepMerge(DEFAULT_THEME, overrides || {});
}

/** CSS font-family value for a themed role, with a system fallback stack. */
export function fontStack(theme, role) {
  const name = theme.fonts[role];
  return `'${name}', ${FALLBACK[name] || "sans-serif"}`;
}

/** <head> font <link> markup (empty when web fonts are disabled). */
export function fontLink(theme) {
  if (!theme.fonts.useWebFonts) return "";
  const fams = [theme.fonts.display, theme.fonts.wordmark, theme.fonts.body, theme.fonts.mono]
    .map((f) => {
      if (f === "Oswald") return "Oswald:wght@300;400;600;700";
      if (f === "Space Mono") return "Space+Mono:wght@400;700";
      return f.replace(/ /g, "+");
    })
    .map((f) => `family=${f}`)
    .join("&");
  return (
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    `<link href="https://fonts.googleapis.com/css2?${fams}&display=block" rel="stylesheet">`
  );
}
