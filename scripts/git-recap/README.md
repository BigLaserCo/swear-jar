# git-recap

Turn your local git history into a saveable "coding recap" image — *last 30
days*, *last 6 months*, *last 12 months* — in the laser-bed dark / hot-orange
heat-ramp style, or your own brand.

- **Local & private.** Runs entirely on your machine against your own repos.
  It shells out to `git` and drives a headless browser you already have.
  **Nothing is uploaded and no server is involved.**
- **$0, no paid AI.** Deterministic git stats + a local Chromium screenshot.
- **Data and pixels are decoupled.** Collection emits a plain JSON; rendering
  consumes it. That JSON is the whole interface — collect once, render anywhere,
  or hand-write your own.
- **Zero dependencies.** Node ≥ 20 stdlib only.

Output: social-ready PNGs at **1080×1350** (portrait / `4x5`), **1080×1080**
(square / `1x1`) and **1080×1920** (story / `9x16`), plus the recap JSON.

## Quick start

```sh
# One or more repo paths → images (+ JSON) in the current directory
node scripts/git-recap/cli.mjs ~/code/app ~/code/api --period 12mo --json

# Just my own commits, last 30 days
node scripts/git-recap/cli.mjs ~/code/app --period 30d --me

# Collect only (pipe / inspect the JSON)
node scripts/git-recap/cli.mjs collect ~/code/app --period 6mo -o recap.json

# Render an existing JSON (no git needed)
node scripts/git-recap/cli.mjs render recap.json -o out/
```

Point it at a folder full of repos and it aggregates them, drawing a
"repositories in flight" growth curve; point it at a single repo and it swaps to
a "cumulative lines written" curve and a personal streak stat.

Run `node scripts/git-recap/cli.mjs --help` for the full flag list.

## How it renders (no dependency)

Rasterizing uses a **Chromium-family browser you already have** — Google Chrome,
Chromium, Microsoft Edge or Brave — via its built-in `--screenshot` mode. There
is no bundled binary and no npm dependency. If the tool can't find a browser,
set `RECAP_CHROME` to one:

```sh
RECAP_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node scripts/git-recap/cli.mjs ~/code/app
```

The default look links display web fonts at render time (a font *download*, not
a data upload). Pass `--no-web-fonts` for a fully offline render that uses system
fonts only.

## Branding

The tool ships brand-neutral. Override any string or colour from flags:

```sh
node scripts/git-recap/cli.mjs ~/code/app \
  --wordmark "ACME" --tag "// 2026 in code" \
  --accent "#ff5a3c" --bar-color "#6fe08c" \
  --footer-left "acme.example" --footer-right "made with git-recap"
```

…or from a JSON file deep-merged over the defaults (see `brand.example.json`):

```sh
node scripts/git-recap/cli.mjs ~/code/app --brand-file brand.example.json
```

## The JSON interface

`collect` (and `--json`) emit an object you can render later or generate
yourself. `example-recap.json` is a complete sample. Top-level shape:

| field | meaning |
| --- | --- |
| `period` | `{ key, label, since, until, days }` — the window |
| `filters` | `{ author, includeMerges }` |
| `totals` | `commits`, `linesAdded`, `linesRemoved`, `linesNet`, `linesOfCodeNow`, `repos`, `filesTouched`, `activeDays`, `longestStreakDays`, `avgCommitsPerActiveDay`, `busiestDay` |
| `series` | `grain` (`day`/`week`/`month`), gap-filled `buckets` + `bucketStart`, parallel arrays `commits`, `linesAdded`, `reposActiveCumulative`, `linesAddedCumulative`, and `monthTicks` |
| `perRepo` | per-repo `commits`, `insertions`, `deletions`, `filesTouched`, `first`, `last`, `linesOfCodeNow` |

Anything that produces this shape can drive the renderer.

## Files

| file | role |
| --- | --- |
| `cli.mjs` | argument parsing + orchestration |
| `collect.mjs` | git → recap JSON (the data pipeline) |
| `charts.mjs` | static inline-SVG chart builders |
| `render.mjs` | recap JSON → self-contained HTML |
| `rasterize.mjs` | HTML → PNG via a headless browser |
| `theme.mjs` | default look + brand token merging |

## Notes

- `linesOfCodeNow` counts newlines in tracked text files at `HEAD`, skipping
  binaries and files over 2 MB. Use `--no-loc` to skip it (faster on huge trees).
- Merge commits are excluded by default (they double-count); add `--merges` to
  include them.
- Series granularity auto-selects from the window (day → week → month); override
  with `--bucket`.
