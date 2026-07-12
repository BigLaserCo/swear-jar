# Installing swear-jar

Every path below pulls **zero dependencies** and runs **no install scripts** —
swear-jar is one small Node ESM package (stdlib only), a single local ledger, and
no network calls, ever. Requires **Node ≥ 20**.

After any install, run **`init` first** — the guided first-run wizard. It wires
the hooks, finds and backfills your entire Claude Code (and optional Codex /
dictation) history in one pass, writes your local report, and — in a real
terminal — opens your **wrapped report** on swearjar.unfocused.ai, whose URL
carries only the aggregate numbers (never your words; a disclosure line names
every field first). That's the instant "you owe $X,XXX" moment. The local path
is always printed; `--local` (or `SWEAR_JAR_LOCAL_ONLY=1`) keeps everything on
your machine, and `--no-open` (or `SWEAR_JAR_NO_OPEN=1`) opens nothing and just
prints both. It's resumable and safe to re-run (records dedup by message id).
Prefer to drive it by hand? **`backfill`** is the power-user alternative — it
just retro-scans your history, no wizard.

---

## a) `npx` — no install, nothing left behind

Run it straight from the registry (after the package is published):

```sh
npx swear-jar init            # guided first-run setup + history audit
npx swear-jar status          # the jar, your rank, uprising odds
```

Or run it **before it's published**, straight from GitHub (needs no npm account
and no build step — the repo just has to be public):

```sh
npx github:BigLaserCo/swear-jar init
npx github:BigLaserCo/swear-jar status
```

Power-user alternative: swap `init` for `backfill` to skip the wizard and just
retro-scan your history.

`npx` downloads the package to its cache, runs it, and pulls no dependencies. To
wire the live session hooks (so new swears get counted going forward), use a
global install (b) or the plugin (c).

## b) Global install — `swear-jar` on your PATH

```sh
npm i -g swear-jar
swear-jar init           # guided first-run wizard: wire hooks + audit history
```

`npm i -g` runs no lifecycle/install scripts and adds no dependencies. `init`
wires the Claude Code hooks (`UserPromptSubmit` + `Stop`) and backfills your
history in one pass; restart Claude Code (or run `/hooks`) to pick the hooks up.
Power-user alternative: run `swear-jar install` then `swear-jar backfill` by
hand. Check the jar any time with `swear-jar status`.

## c) Claude Code plugin — one marketplace, one install

```
/plugin marketplace add BigLaserCo/swear-jar
/plugin install swear-jar@biglaser
```

The plugin ships the same `bin/` and registers the `UserPromptSubmit` + `Stop`
hooks for you — no separate `swear-jar install` needed. Zero deps, no install
scripts. Then, from a terminal, run the guided first-run wizard (it detects your
sources and audits your history in one pass):

```sh
swear-jar init           # or: node <plugin-dir>/bin/swear-jar.mjs init
```

Power-user alternative: swap `init` for `backfill` to skip the wizard and just
retro-scan your history.

## d) From a clone — no npm at all

```sh
git clone https://github.com/BigLaserCo/swear-jar.git
cd swear-jar
node bin/swear-jar.mjs init        # guided first-run wizard: wire hooks + audit history
node bin/swear-jar.mjs status      # check the jar
```

Power-user alternative: run `node bin/swear-jar.mjs install` then `node
bin/swear-jar.mjs backfill` by hand instead of the wizard.

Nothing to build, nothing to `npm install` — the source runs as-is on Node ≥ 20.

---

## Uninstall

Remove the hooks (leaves your ledger in `~/.swear-jar/` untouched):

```sh
swear-jar uninstall        # or: node bin/swear-jar.mjs uninstall
```

For a global install, follow up with `npm rm -g swear-jar`. For the plugin, use
`/plugin uninstall swear-jar@biglaser`.

---

## Where your data lives

Everything stays local: one append-only ledger at `~/.swear-jar/ledger.jsonl`
(override with `SWEAR_JAR_HOME`). Only word **counts** are ever written — never
your prompts, transcripts, or any secret that passed through a session.

---

## Tip the founder

The jar takes real money too — empty yours:
<https://swearjar.unfocused.ai/tip.html>
