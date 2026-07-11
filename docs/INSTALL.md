# Installing swear-jar

Every path below pulls **zero dependencies** and runs **no install scripts** —
swear-jar is one small Node ESM package (stdlib only), a single local ledger, and
no network calls, ever. Requires **Node ≥ 20**.

After any install, run **`backfill` first** — it retro-scans your entire Claude
Code (and optional Codex) history in one pass and gives you the instant
"you owe $X,XXX" moment. It's resumable and safe to re-run (records dedup by
message id).

---

## a) `npx` — no install, nothing left behind

Run it straight from the registry (after the package is published):

```sh
npx swear-jar backfill        # audit all past sessions right now
npx swear-jar status          # the jar, your rank, uprising odds
```

Or run it **before it's published**, straight from GitHub (needs no npm account
and no build step — the repo just has to be public):

```sh
npx github:BigLaserCo/swear-jar backfill
npx github:BigLaserCo/swear-jar status
```

`npx` downloads the package to its cache, runs it, and pulls no dependencies. To
wire the live session hooks (so new swears get counted going forward), use a
global install (b) or the plugin (c).

## b) Global install — `swear-jar` on your PATH

```sh
npm i -g swear-jar
swear-jar install        # wire the Claude Code hooks (UserPromptSubmit + Stop)
swear-jar backfill       # then audit your history
```

`npm i -g` runs no lifecycle/install scripts and adds no dependencies. `swear-jar
install` edits only your Claude Code hooks config; restart Claude Code (or run
`/hooks`) to pick them up. Check the jar any time with `swear-jar status`.

## c) Claude Code plugin — one marketplace, one install

```
/plugin marketplace add BigLaserCo/swear-jar
/plugin install swear-jar@biglaser
```

The plugin ships the same `bin/` and registers the `UserPromptSubmit` + `Stop`
hooks for you — no separate `swear-jar install` needed. Zero deps, no install
scripts. Then, from a terminal, run the one-time history audit:

```sh
swear-jar backfill       # or: node <plugin-dir>/bin/swear-jar.mjs backfill
```

## d) From a clone — no npm at all

```sh
git clone https://github.com/BigLaserCo/swear-jar.git
cd swear-jar
node bin/swear-jar.mjs install     # wire the hooks
node bin/swear-jar.mjs backfill    # audit your history
node bin/swear-jar.mjs status      # check the jar
```

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
