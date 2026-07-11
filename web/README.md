# Swear Jar — the hosted web app

One self-contained page (`web/app.html`) that scans your Claude Code
transcripts **entirely in your browser** and renders the damage report:
dollars owed, you-vs-the-machine, uprising odds + rank, censored greatest
hits. Nothing is installed, and nothing is uploaded.

## How it works

1. You point the page at your transcripts folder (`~/.claude/projects` — or
   all of `~/.claude`). Three doors, best-available first:
   - **`showDirectoryPicker()`** (Chrome/Edge) — native folder picker,
     read-only mode;
   - **drag-and-drop** the folder onto the page (`webkitGetAsEntry` walk);
   - **`<input type="file" webkitdirectory>`** fallback (Firefox/Safari).

   macOS note: `~/.claude` is a hidden folder — press `Cmd+Shift+.` in the
   file picker to reveal hidden folders. The page says this next to the
   buttons.

2. Every `*.jsonl` file under the folder (subfolders included) streams
   through `web/browser-scan.mjs` one file at a time — bounded memory, live
   files/records/coins counters while it runs.

3. The resulting records feed `src/stats.mjs` → the report view. Swears are
   censored by default; a toggle reveals them locally.

Files are read with the browser File API and **never leave the machine**.
The page makes **zero network requests** — no CDN, no fonts, no analytics,
no telemetry. `test/browser-scan.test.mjs` enforces this mechanically (any
non-GitHub `http(s)` reference in `app.html` fails CI).

## The same-files trust story

The page does not port or bundle the scanner — it imports the npm package's
own audited modules **verbatim**, as native ES modules:

| module | job |
| --- | --- |
| `../src/detect.mjs` | the lexicon + coin scoring (the part worth auditing) |
| `../src/odds.mjs` | Robot Uprising Survival Odds™ + ranks |
| `../src/stats.mjs` | pure stats aggregation for the report |
| `../src/version.mjs` | `APP_VERSION` / `RELEASE_HASH` for submission provenance |
| `../funnel/schema.mjs` | leaderboard submission field set + caps |
| `./browser-scan.mjs` | the only browser-specific file |

So what you read on GitHub is byte-for-byte what runs in the tab.

`web/browser-scan.mjs` is the one piece `src/` can't share directly:
`src/scan.mjs` does its line filtering inside a node:fs read loop (byte
offsets, on-disk ledger), so its module can't load in a browser. The browser
layer re-implements only the pure, IO-free parts — JSONL parsing, the
isMeta / isCompactSummary / isApiErrorMessage / isSidechain skips,
injected-block (`<system-reminder>`, `<command-*>`, `<local-command-*>`)
stripping, user|assistant-only, uuid dedup, the clink-line guard — and
`test/browser-scan.test.mjs` pins those mirrors to the real `src/scan.mjs`
exports with cross-checks, so any drift in the audited helpers turns CI red.

## Hosting

Serve this repo's files **as-is** (any static host / CDN) with the repo
layout intact — `app.html` resolves `./browser-scan.mjs`,
`../src/*.mjs`, and `../funnel/schema.mjs` relatively, so `web/`, `src/`,
and `funnel/` must be siblings, exactly like the repo. No build step, no
bundler, no dependencies. Planned home: **biglaser.co**.

Local dev is any static server from the repo root, e.g.:

```sh
npx --yes http-server -p 8080 .   # or python3 -m http.server
# open http://127.0.0.1:8080/web/app.html
```

(A server is needed only because ES-module imports don't run from `file://`.)

## Score upload (not live yet)

The **Upload your score** button ships disabled. `CONFIG` at the top of
`app.html`'s module script holds two deliberate placeholders:

```js
const CONFIG = { API_BASE: null, ACCOUNTS_BASE: null };
```

While either is `null`, the button is a disabled no-op labeled
"log in to get on the board — coming online soon" and the page can make no
network request at all. The payload builder is already wired: it assembles
the `funnel/schema.mjs` field set (`total_coins`, `dollars`,
`swears_per_day`, censored `top_word`, `fbomb_pct`, `active_days`, `agent`,
`app_version`, `release_hash`) and schema-validates it locally. When the
biglaser.co accounts + leaderboard funnel go live, setting the two CONFIG
values is the only change — and even then, only those aggregate numbers are
sent, never transcripts.
